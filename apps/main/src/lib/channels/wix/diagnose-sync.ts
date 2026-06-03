import type { ChannelConnectionContext } from "../types";
import { getAdapter } from "../registry";
import {
  isCorruptBaselineQty,
  MAX_SANE_INVENTORY_QTY,
} from "../inventory-sanity";
import { hasOptionQuantities, sumOptionQuantities } from "@/lib/store-item-variants";
import { fetchWixV1Product, wixV1ProductToVariants } from "./collections";
import { wixSiteIdFromConn } from "./site";

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
  | "WIX_QTY_UNREADABLE"
  | "NOT_CONNECTED"
  | "BASELINE_CORRUPT"
  | "QTY_INFLATION_RISK"
  | "WIX_METASITE_CONTEXT_ERROR";

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
    variants?: unknown;
  };
};

function isMetasiteContextError(syncError: string | null): boolean {
  return Boolean(syncError?.includes("No Metasite Context"));
}

function isQtyInflationRisk(inwQty: number, wixQty: number | null, baselineQty: number | null): boolean {
  if (inwQty > MAX_SANE_INVENTORY_QTY) return true;
  if (isCorruptBaselineQty(baselineQty)) return true;
  if (wixQty != null && wixQty > MAX_SANE_INVENTORY_QTY) return true;
  if (wixQty != null && inwQty > 0 && wixQty >= inwQty * 10 && wixQty > 100) return true;
  return false;
}

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

  if (isMetasiteContextError(syncError)) {
    return {
      verdict: "WIX_METASITE_CONTEXT_ERROR",
      summary: "Wix rejected inventory writes: No Metasite Context in identity.",
      nextStep:
        "Sync Stores → Disconnect Wix → Connect Wix again (refreshes site token). Then run diagnose?resetBaseline=1 and ?repair=1.",
    };
  }

  if (isCorruptBaselineQty(baselineQty)) {
    return {
      verdict: "BASELINE_CORRUPT",
      summary: `Stored baseline quantity (${baselineQty}) is invalid; INW shows ${inwQty}.`,
      nextStep:
        "Run GET /api/channels/wix/diagnose?resetBaseline=1 while signed in, then ?repair=1 after fixing stock in Seller Hub.",
    };
  }

  if (isQtyInflationRisk(inwQty, wixQty, baselineQty)) {
    return {
      verdict: "QTY_INFLATION_RISK",
      summary: `Quantity looks inflated or unsafe (INW ${inwQty}, Wix ${wixQty ?? "unknown"}, baseline ${baselineQty ?? "none"}).`,
      nextStep:
        "Set true per-size stock in Seller Hub, align Wix admin variant stock, run resetBaseline=1, then repair=1. Do not rely on the old 3-minute cron (removed).",
    };
  }

  if (syncStatus === "error" && syncError) {
    return {
      verdict: "PUSH_FAILED",
      summary: `Last Wix push failed: ${syncError.slice(0, 200)}`,
      nextStep:
        "Fix the error on My Items (Wix sync line), or run /api/channels/wix/diagnose?repair=1 while signed in.",
    };
  }

  if (!wixKnown || wixQty == null) {
    if (baselineQty != null && inwQty !== baselineQty) {
      return {
        verdict: "PUSH_NEVER_RAN",
        summary: `INW qty is ${inwQty} but baseline is ${baselineQty}; live Wix stock could not be read.`,
        nextStep:
          "Save the listing in Seller Hub or run ?repair=1 to push. Ensure STRIPE_CONNECT_WEBHOOK_SECRET for post-sale pushes.",
      };
    }
    return {
      verdict: "WIX_QTY_UNREADABLE",
      summary: "Could not read live quantity from Wix (common on Catalog v1).",
      nextStep: "Run diagnose?repair=1 to force a push and read-back.",
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

  if (baselineQty != null && inwQty !== baselineQty && inwQty !== wixQty) {
    const pushedRecently =
      lastPushedAt && Date.now() - lastPushedAt.getTime() < 5 * 60 * 1000;
    if (pushedRecently) {
      return {
        verdict: "WIX_WRITE_NOOP",
        summary: `INW is ${inwQty} (baseline ${baselineQty}) but Wix shows ${wixQty} after a recent push.`,
        nextStep:
          "Check Vercel for [wix] updateInventory errors. Run repair=1; if repair works, fix Connect webhook for automatic post-sale push.",
      };
    }
    return {
      verdict: "PUSH_NEVER_RAN",
      summary: `INW is ${inwQty} after a change (baseline ${baselineQty}) but Wix shows ${wixQty}.`,
      nextStep:
        "Run ?repair=1 or save the listing in Seller Hub. For sales, configure STRIPE_CONNECT_WEBHOOK_SECRET (see stripeConnectWebhookHint).",
    };
  }

  if (baselineQty != null && inwQty === baselineQty && inwQty !== wixQty) {
    return {
      verdict: "PUSH_NEVER_RAN",
      summary: `INW quantity (${inwQty}) matches baseline; Wix still shows ${wixQty}.`,
      nextStep:
        "Confirm the order is paid. Run repair=1 or edit qty in Seller Hub to trigger an event-driven push.",
    };
  }

  if (baselineQty != null && inwQty !== baselineQty && !lastPushedAt) {
    return {
      verdict: "PUSH_NEVER_RAN",
      summary: `INW qty is ${inwQty} (baseline ${baselineQty}) but Wix shows ${wixQty}; no successful push recorded.`,
      nextStep:
        "Storefront sales need payment_intent.succeeded on the Connect webhook. Configure STRIPE_CONNECT_WEBHOOK_SECRET, then run repair=1.",
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
          "Wix may be ignoring the write. Check Vercel logs for [wix] updateInventory. Run repair=1.",
      };
    }
    return {
      verdict: "PUSH_NEVER_RAN",
      summary: `INW is ${inwQty}, Wix is ${wixQty}, baseline is ${baselineQty}.`,
      nextStep:
        "Run repair=1 or save the listing. Event-driven sync only (no background cron).",
    };
  }

  return {
    verdict: "PUSH_NEVER_RAN",
    summary: `INW ${inwQty} vs Wix ${wixQty}; baseline not set yet.`,
    nextStep: "Run repair=1 once to establish baseline, then test one sale.",
  };
}

async function readLiveWixQuantity(
  ctx: ChannelConnectionContext,
  productId: string,
  variants: unknown
): Promise<{ quantity: number; known: boolean }> {
  const siteId = wixSiteIdFromConn(ctx);
  const opts = siteId ? { siteId } : {};
  if (hasOptionQuantities(variants)) {
    const product = await fetchWixV1Product(ctx.accessToken, productId, opts);
    const axes = product ? wixV1ProductToVariants(product) : null;
    if (axes && hasOptionQuantities(axes)) {
      return { quantity: sumOptionQuantities(axes), known: true };
    }
  }
  const adapter = getAdapter("wix");
  if (adapter.fetchProductQuantity) {
    return adapter.fetchProductQuantity(ctx, productId);
  }
  return { quantity: 0, known: false };
}

export async function diagnoseWixLinks(
  ctx: ChannelConnectionContext,
  linkRows: LinkRow[],
  catalogApi: string | null,
  siteId: string | null
): Promise<WixSyncDiagnosis> {
  const links: WixLinkDiagnosis[] = await Promise.all(
    linkRows.map(async (l) => {
      let wixQuantity: number | null = null;
      let wixQuantityKnown = false;
      try {
        const r = await readLiveWixQuantity(ctx, l.externalListingId, l.storeItem.variants);
        wixQuantity = r.quantity;
        wixQuantityKnown = r.known;
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
    "BASELINE_CORRUPT",
    "QTY_INFLATION_RISK",
    "WIX_METASITE_CONTEXT_ERROR",
    "PUSH_FAILED",
    "ORDER_STILL_PENDING",
    "INW_QTY_NOT_DECREMENTED",
    "PUSH_NEVER_RAN",
    "WIX_WRITE_NOOP",
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
