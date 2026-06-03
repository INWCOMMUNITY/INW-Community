import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getMemberConnectionContext } from "@/lib/channels/connection";
import { syncInventoryToChannels } from "@/lib/channels/sync-inventory";
import { isWixConfigured } from "@/lib/channels/wix/config";
import { ensureWixCatalogVersion, wixCatalogApiFromConn } from "@/lib/channels/wix/catalog-api";
import { ensureWixSiteId, remintWixAccessToken, wixSiteIdFromConn } from "@/lib/channels/wix/site";
import { isWixMetasiteContextError } from "@/lib/channels/wix/client";
import { resetCorruptBaselinesForConnection } from "@/lib/channels/reset-corrupt-baselines";
import {
  diagnoseOrderFulfillment,
  diagnoseWixLinks,
  type WixSyncDiagnosis,
} from "@/lib/channels/wix/diagnose-sync";

export const dynamic = "force-dynamic";

function isMetasiteOnLinks(
  rows: { syncError: string | null; syncStatus: string }[]
): boolean {
  return rows.some(
    (l) => l.syncStatus === "error" && isWixMetasiteContextError(new Error(l.syncError ?? ""))
  );
}

/**
 * GET /api/channels/wix/diagnose
 *
 * One-call diagnosis after a failed (or suspected failed) INW → Wix qty sync.
 * Optional query params:
 *   - orderId — focus on items from this storefront order
 *   - storeItemId — focus on one linked item
 *   - repair=1 — run the same push as manual "Test Wix write", then re-diagnose (no new sale needed)
 *   - resetBaseline=1 — reset poisoned syncBaselineQty values to current INW quantity (seller-only)
 *
 * Returns a single top-level `verdict`, `summary`, and `nextStep` plus per-link detail.
 * Does not expose tokens. Sign in as the seller (same as /api/channels/wix/health).
 */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isWixConfigured()) {
    return NextResponse.json({
      ok: false,
      verdict: "NOT_CONNECTED",
      summary: "Wix is not configured on the server.",
      nextStep: "Set WIX_APP_ID and WIX_APP_SECRET in Vercel and redeploy.",
    });
  }

  const ctx = await getMemberConnectionContext(userId, "wix");
  if (!ctx) {
    return NextResponse.json({
      ok: false,
      verdict: "NOT_CONNECTED",
      summary: "No Wix connection for this account.",
      nextStep: "Seller Hub → Sync Stores → Connect Wix.",
    });
  }

  const { searchParams } = new URL(req.url);
  const orderId = searchParams.get("orderId")?.trim() || null;
  const storeItemId = searchParams.get("storeItemId")?.trim() || null;
  const repair = searchParams.get("repair") === "1";
  const resetBaseline = searchParams.get("resetBaseline") === "1";

  await ensureWixSiteId(ctx);

  let baselineReset: { reset: number; linkIds: string[] } | undefined;
  if (resetBaseline) {
    baselineReset = await resetCorruptBaselinesForConnection({
      connectionId: ctx.id,
      memberId: userId,
    });
  }
  const siteId = wixSiteIdFromConn(ctx);
  const catalogApi = (await ensureWixCatalogVersion(ctx)) ?? wixCatalogApiFromConn(ctx);

  let orderBlock: WixSyncDiagnosis["order"] | undefined;
  let storeItemIds: string[] | null = null;

  if (orderId) {
    const order = await prisma.storeOrder.findFirst({
      where: {
        id: orderId,
        sellerId: userId,
      },
      include: { items: { select: { storeItemId: true } } },
    });
    if (!order) {
      return NextResponse.json({
        ok: false,
        verdict: "ORDER_NOT_FOUND",
        summary: `Order ${orderId} not found for this seller.`,
        nextStep: "Use an order id from Seller Hub → Orders, or omit orderId to diagnose all Wix links.",
      });
    }
    const orderDiag = diagnoseOrderFulfillment(order);
    if (orderDiag) {
      return NextResponse.json({
        ok: false,
        ...orderDiag,
        catalogApi,
        siteId: siteId ?? null,
        links: [],
        stripeConnectWebhookHint:
          "Storefront checkout uses PaymentIntents on the seller's Connect account. Stripe must send payment_intent.succeeded to https://www.inwcommunity.com/api/stripe/webhook with STRIPE_CONNECT_WEBHOOK_SECRET set in Vercel.",
      });
    }
    orderBlock = {
      id: order.id,
      status: order.status,
      stripePaymentIntentId: order.stripePaymentIntentId,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
      minutesSinceUpdate: Math.round((Date.now() - order.updatedAt.getTime()) / 60_000),
    };
    storeItemIds = order.items.map((i) => i.storeItemId);
  } else if (storeItemId) {
    storeItemIds = [storeItemId];
  }

  const linkWhere = {
    connectionId: ctx.id,
    provider: "wix" as const,
    syncEnabled: true,
    ...(storeItemIds ? { storeItemId: { in: storeItemIds } } : {}),
    storeItem: { memberId: userId },
  };

  const linkRows = await prisma.channelListingLink.findMany({
    where: linkWhere,
    select: {
      storeItemId: true,
      externalListingId: true,
      syncStatus: true,
      syncError: true,
      lastPushedAt: true,
      lastInboundAt: true,
      syncBaselineQty: true,
      storeItem: {
        select: { title: true, quantity: true, status: true, updatedAt: true, variants: true },
      },
    },
    take: 25,
  });

  if (linkRows.length === 0) {
    const [disabledLinkCount, inwListingCount, focusedItem] = await Promise.all([
      prisma.channelListingLink.count({
        where: { connectionId: ctx.id, provider: "wix", syncEnabled: false },
      }),
      prisma.storeItem.count({ where: { memberId: userId } }),
      storeItemIds?.length === 1
        ? prisma.storeItem.findFirst({
            where: { id: storeItemIds[0], memberId: userId },
            select: { id: true, title: true },
          })
        : Promise.resolve(null),
    ]);

    const disconnectedRecently =
      disabledLinkCount === 0 &&
      inwListingCount > 0 &&
      !storeItemIds;

    let summary = storeItemIds
      ? "No active Wix link for that item (sync disabled or link removed)."
      : "Wix is connected but no listings are linked for sync.";
    let nextStep =
      "Sync Stores → Import existing listings from Wix (select your products and import).";

    if (focusedItem) {
      summary = `INW listing "${focusedItem.title}" exists but is not linked to Wix.`;
      nextStep =
        "Sync Stores → Import → select this product on Wix (same product id) to re-create the link, or link it from My Items if import shows it as already on INW.";
    } else if (disconnectedRecently) {
      summary =
        "Wix is connected but no listing links. Disconnecting Wix removes all links (INW items usually remain).";
      nextStep =
        "Sync Stores → Import existing listings from Wix to re-link. Then run diagnose?resetBaseline=1 and ?repair=1 if needed.";
    }

    return NextResponse.json({
      ok: false,
      verdict: "NO_WIX_LINK",
      summary,
      nextStep,
      connectionId: ctx.id,
      catalogApi,
      siteId: siteId ?? null,
      inwListingCount,
      wixLinksWithSyncDisabled: disabledLinkCount,
      order: orderBlock,
      links: [],
      stripeConnectWebhookHint:
        "After linking, storefront sales need the Connect webhook (payment_intent.succeeded) to decrement INW and push qty to Wix.",
    });
  }

  if (repair && isMetasiteOnLinks(linkRows)) {
    await remintWixAccessToken(ctx);
  }

  if (repair) {
    const repairResults: { storeItemId: string; ok: boolean; error?: string }[] = [];
    for (const row of linkRows) {
      const results = await syncInventoryToChannels(row.storeItemId);
      const wix = results.find((r) => r.provider === "wix");
      repairResults.push({
        storeItemId: row.storeItemId,
        ok: wix?.ok ?? results.length === 0,
        error: wix?.error,
      });
    }
    const refreshed = await prisma.channelListingLink.findMany({
      where: linkWhere,
      select: {
        storeItemId: true,
        externalListingId: true,
        syncStatus: true,
        syncError: true,
        lastPushedAt: true,
        lastInboundAt: true,
        syncBaselineQty: true,
        storeItem: {
          select: { title: true, quantity: true, status: true, updatedAt: true, variants: true },
        },
      },
    });
    const diagnosis = await diagnoseWixLinks(ctx, refreshed, catalogApi, siteId ?? null);
    return NextResponse.json({
      ...diagnosis,
      order: orderBlock,
      repairAttempted: true,
      repairResults,
      baselineReset,
    });
  }

  const diagnosis = await diagnoseWixLinks(ctx, linkRows, catalogApi, siteId ?? null);
  return NextResponse.json({
    ...diagnosis,
    order: orderBlock,
    repairAttempted: false,
    baselineReset,
    howToUse:
      "After a test sale, open this URL again (same browser session). If verdict is BASELINE_CORRUPT, run ?resetBaseline=1 first. If not SYNC_OK, try ?repair=1.",
  });
}
