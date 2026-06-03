import type { ChannelConnectionContext } from "../types";
import { getAdapter } from "../registry";

/** Machine-readable result — stable for logs, support, and future UI. */
export type WixSyncVerdictCode =
  | "SYNC_OK"
  | "NO_WIX_LINK"
  | "ORDER_STILL_PENDING"
  | "ORDER_NOT_FOUND"
  | "INW_QTY_NOT_DECREMENTED"
  | "PUSH_NEVER_RAN"
  | "PUSH_FAILED"
  | "WIX_WRITE_NOOP"
  | "CRON_BACKSTOP_PENDING"
  | "WIX_QTY_UNREADABLE"
  | "NOT_CONNECTED";

export type WixLinkDiagnosis = {
  storeItemId: string;
  title: string;
  productId: string;
  inwQuantity: number;
  inwStatus: string;
  baselineQuantity: number | null;
  wixQuantity: number | null;
  wixQuantityKnown: boolean;
  syncStatus: string;
  syncError: string | null;
  lastPushedAt: string | null;
  lastInboundAt: string | null;
  itemUpdatedAt: string;
  verdict: WixSyncVerdictCode;
  summary: string;
  nextStep: string;
};

export type WixSyncDiagnosis = {
  ok: boolean;
  verdict: WixSyncVerdictCode;
  summary: string;
  nextStep: string;
  catalogApi: string | null;
  siteId: string | null;
  order?: {
    id: string;
    status: string;
    stripePaymentIntentId: string | null;
    createdAt: string;
    updatedAt: string;
    minutesSinceUpdate: number;
  };
  links: WixLinkDiagnosis[];
  stripeConnectWebhookHint: string;
};

type LinkRow = {
  storeItemId: string;
  externalListingId: string;
  syncStatus: string;
  syncError: string | null;
  lastPushedAt: Date | null;
  lastInboundAt: Date | null;
  syncBaselineQty: number | null;
  storeItem: {
    title: string;
    quantity: number;
    status: string;
    updatedAt: Date;
  };
};

function verdictForLinkState(args: {
  inwQty: number;
  baselineQty: number | null;
  wixQty: number | null;
  wixKnown: boolean;
  syncStatus: string;
  syncError: string | null;
  lastPushedAt: Date | null;
}): Pick<WixLinkDiagnosis, "verdict" | "summary" | "nextStep"> {
  const { inwQty, baselineQty, wixQty, wixKnown, syncStatus, syncError, lastPushedAt } = args;

  if (syncStatus === "error" && syncError) {
    return {
      verdict: "PUSH_FAILED",
      summary: `Last Wix push failed: ${syncError.slice(0, 200)}`,
      nextStep:
        "Fix the error on My Items (Wix sync line), or run POST /api/channels/wix/diagnose?repair=1 while signed in to retry the push.",
    };
  }

  if (!wixKnown || wixQty == null) {
    if (baselineQty != null && inwQty !== baselineQty) {
      return {
        verdict: "CRON_BACKSTOP_PENDING",
        summary: `INW qty is ${inwQty} but baseline is still ${baselineQty}; Wix live stock could not be read.`,
        nextStep:
          "Wait up to 3 minutes for the channel cron, then reload this diagnose URL. If still stale, run repair=1 or Test Wix write in Sync Stores.",
      };
    }
    return {
      verdict: "WIX_QTY_UNREADABLE",
      summary: "Could not read live quantity from Wix (common on Catalog v1).",
      nextStep:
        "Use POST /api/channels/wix/diagnose?repair=1 to force a push and read-back, or Test Wix write (qty push) in Sync Stores.",
    };
  }

  if (inwQty === wixQty) {
    const baselineAligned = baselineQty == null || baselineQty === inwQty;
    if (baselineAligned) {
      return {
        verdict: "SYNC_OK",
        summary: `INW and Wix both show quantity ${inwQty}.`,
        nextStep: "No action needed.",
      };
    }
    return {
      verdict: "SYNC_OK",
      summary: `INW and Wix both show ${inwQty}; baseline (${baselineQty}) will align on next successful push.`,
      nextStep: "Optional: run repair=1 to refresh the baseline.",
    };
  }

  // INW != Wix — sale path usually decrements INW but baseline stays at pre-sale qty until a successful push
  if (baselineQty != null && inwQty !== baselineQty && inwQty !== wixQty) {
    const pushedRecently =
      lastPushedAt && Date.now() - lastPushedAt.getTime() < 5 * 60 * 1000;
    if (pushedRecently) {
      return {
        verdict: "WIX_WRITE_NOOP",
        summary: `INW is ${inwQty} (baseline still ${baselineQty}) but Wix shows ${wixQty} after a recent push.`,
        nextStep:
          "The push ran but Wix did not apply stock. Check Vercel for [wix] updateInventory errors. Run repair=1; if repair works, auto post-sale push is not firing — fix Connect webhook.",
      };
    }
    return {
      verdict: "CRON_BACKSTOP_PENDING",
      summary: `INW is ${inwQty} after sale (baseline ${baselineQty}) but Wix still shows ${wixQty}.`,
      nextStep:
        "Wait 3 minutes and reload diagnose. If unchanged, run ?repair=1 (no new purchase). If repair works, configure STRIPE_CONNECT_WEBHOOK_SECRET so sales trigger push automatically.",
    };
  }

  if (baselineQty != null && inwQty === baselineQty && inwQty !== wixQty) {
    return {
      verdict: "PUSH_NEVER_RAN",
      summary: `INW quantity (${inwQty}) matches the old baseline; the sale may not have decremented inventory. Wix shows ${wixQty}.`,
      nextStep:
        "Confirm the order is paid in Seller Hub. If still pending, fix Stripe Connect webhook (stripeConnectWebhookHint).",
    };
  }

  if (baselineQty != null && inwQty !== baselineQty && !lastPushedAt) {
    return {
      verdict: "PUSH_NEVER_RAN",
      summary: `INW qty is ${inwQty} (baseline ${baselineQty}) but Wix shows ${wixQty}; no successful push recorded (lastPushedAt empty).`,
      nextStep:
        "Storefront sales need payment_intent.succeeded on the Connect webhook. Configure STRIPE_CONNECT_WEBHOOK_SECRET, then run repair=1 or wait for the 3-minute cron.",
    };
  }

  if (baselineQty != null && inwQty !== baselineQty) {
    const pushedRecently =
      lastPushedAt && Date.now() - lastPushedAt.getTime() < 5 * 60 * 1000;
    if (pushedRecently && inwQty !== wixQty) {
      return {
        verdict: "WIX_WRITE_NOOP",
        summary: `A push ran recently but Wix still shows ${wixQty} while INW shows ${inwQty}.`,
        nextStep:
          "Wix may be ignoring the write (inventory tracking off, wrong variant IDs). Check Vercel logs for [wix] updateInventory. Run repair=1 and paste this JSON if it persists.",
      };
    }
    return {
      verdict: "CRON_BACKSTOP_PENDING",
      summary: `INW is ${inwQty}, Wix is ${wixQty}, baseline is ${baselineQty}. Backstop should push INW → Wix within ~3 minutes.`,
      nextStep:
        "Wait 3 minutes and reload diagnose. If unchanged, run repair=1. If repair works but sales do not, fix Connect webhook (stripeConnectWebhookHint).",
    };
  }

  return {
    verdict: "PUSH_NEVER_RAN",
    summary: `INW ${inwQty} vs Wix ${wixQty}; baseline not set yet.`,
    nextStep: "Run repair=1 once to establish baseline, then test one sale.",
  };
}

export async function diagnoseWixLinks(
  ctx: ChannelConnectionContext,
  linkRows: LinkRow[],
  catalogApi: string | null,
  siteId: string | null
): Promise<WixSyncDiagnosis> {
  const adapter = getAdapter("wix");
  const links: WixLinkDiagnosis[] = await Promise.all(
    linkRows.map(async (l) => {
      let wixQuantity: number | null = null;
      let wixQuantityKnown = false;
      try {
        if (adapter.fetchProductQuantity) {
          const r = await adapter.fetchProductQuantity(ctx, l.externalListingId);
          wixQuantity = r.quantity;
          wixQuantityKnown = r.known;
        }
      } catch {
        /* best-effort */
      }
      const inwQty = l.storeItem.quantity;
      const verdictParts = verdictForLinkState({
        inwQty,
        baselineQty: l.syncBaselineQty,
        wixQty: wixQuantity,
        wixKnown: wixQuantityKnown,
        syncStatus: l.syncStatus,
        syncError: l.syncError,
        lastPushedAt: l.lastPushedAt,
      });
      return {
        storeItemId: l.storeItemId,
        title: l.storeItem.title,
        productId: l.externalListingId,
        inwQuantity: inwQty,
        inwStatus: l.storeItem.status,
        baselineQuantity: l.syncBaselineQty,
        wixQuantity,
        wixQuantityKnown,
        syncStatus: l.syncStatus,
        syncError: l.syncError,
        lastPushedAt: l.lastPushedAt?.toISOString() ?? null,
        lastInboundAt: l.lastInboundAt?.toISOString() ?? null,
        itemUpdatedAt: l.storeItem.updatedAt.toISOString(),
        ...verdictParts,
      };
    })
  );

  const priority: WixSyncVerdictCode[] = [
    "PUSH_FAILED",
    "ORDER_STILL_PENDING",
    "INW_QTY_NOT_DECREMENTED",
    "PUSH_NEVER_RAN",
    "WIX_WRITE_NOOP",
    "CRON_BACKSTOP_PENDING",
    "WIX_QTY_UNREADABLE",
    "SYNC_OK",
  ];
  let top = links[0];
  for (const code of priority) {
    const found = links.find((x) => x.verdict === code);
    if (found) {
      top = found;
      break;
    }
  }

  const ok = links.length > 0 && links.every((l) => l.verdict === "SYNC_OK");

  return {
    ok,
    verdict: top?.verdict ?? "NO_WIX_LINK",
    summary: top?.summary ?? "No linked items to diagnose.",
    nextStep: top?.nextStep ?? "Import a Wix product in Sync Stores.",
    catalogApi,
    siteId,
    links,
    stripeConnectWebhookHint:
      "Storefront checkout charges the seller's Stripe Connect account. In Stripe Dashboard → Developers → Webhooks, add an endpoint for **Events on connected accounts** pointing to https://www.inwcommunity.com/api/stripe/webhook with payment_intent.succeeded enabled. Put that signing secret in Vercel as STRIPE_CONNECT_WEBHOOK_SECRET (separate from STRIPE_WEBHOOK_SECRET). Without it, orders can stay pending and Wix never updates after an INW sale.",
  };
}

export function diagnoseOrderFulfillment(order: {
  id: string;
  status: string;
  stripePaymentIntentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): Pick<WixSyncDiagnosis, "verdict" | "summary" | "nextStep" | "order"> | null {
  if (order.status === "pending") {
    const minutes = Math.round((Date.now() - order.updatedAt.getTime()) / 60_000);
    return {
      verdict: "ORDER_STILL_PENDING",
      summary: `Order ${order.id.slice(-6)} is still pending after ${minutes} minute(s). INW never fulfilled the sale.`,
      nextStep:
        "Payment may have succeeded in Stripe but our server did not receive payment_intent.succeeded on the Connect webhook. Configure STRIPE_CONNECT_WEBHOOK_SECRET (see stripeConnectWebhookHint), then mark/fix the order or retry fulfillment.",
      order: {
        id: order.id,
        status: order.status,
        stripePaymentIntentId: order.stripePaymentIntentId,
        createdAt: order.createdAt.toISOString(),
        updatedAt: order.updatedAt.toISOString(),
        minutesSinceUpdate: minutes,
      },
    };
  }
  return null;
}
