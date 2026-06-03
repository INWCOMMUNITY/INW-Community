import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getMemberConnectionContext } from "@/lib/channels/connection";
import { getAdapter } from "@/lib/channels/registry";
import { isWixConfigured } from "@/lib/channels/wix/config";
import { ensureWixCatalogVersion, wixCatalogApiFromConn } from "@/lib/channels/wix/catalog-api";
import { ensureWixSiteId, wixSiteIdFromConn } from "@/lib/channels/wix/site";
import { WixApiError } from "@/lib/channels/wix/client";

export const dynamic = "force-dynamic";

/**
 * GET: quick Wix connection diagnostic for the signed-in seller (mobile / support).
 * Does not expose tokens. Use after connect or when sync seems dead.
 */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isWixConfigured()) {
    return NextResponse.json({
      ok: false,
      code: "NOT_CONFIGURED",
      message: "Wix is not configured on the server (WIX_APP_ID / WIX_APP_SECRET).",
    });
  }

  const ctx = await getMemberConnectionContext(userId, "wix");
  if (!ctx) {
    return NextResponse.json({
      ok: false,
      code: "NOT_CONNECTED",
      message: "No Wix connection. Use Sync Stores → Connect Wix.",
    });
  }

  const siteIdBefore = wixSiteIdFromConn(ctx);
  const siteId = (await ensureWixSiteId(ctx)) ?? siteIdBefore;
  const catalogApi = (await ensureWixCatalogVersion(ctx)) ?? wixCatalogApiFromConn(ctx);
  const catalogVersion =
    typeof ctx.config?.catalogVersion === "string" ? ctx.config.catalogVersion : null;
  let productCount = 0;
  let listError: string | null = null;

  try {
    const listings = await getAdapter("wix").listRemoteListings(ctx);
    productCount = listings.length;
  } catch (e) {
    listError =
      e instanceof WixApiError
        ? e.message
        : e instanceof Error
          ? e.message
          : "Could not list Wix products.";
  }

  const linkedCount = await prisma.channelListingLink.count({
    where: { connectionId: ctx.id, provider: "wix", syncEnabled: true },
  });
  const errorLinks = await prisma.channelListingLink.findMany({
    where: { connectionId: ctx.id, provider: "wix", syncStatus: "error" },
    select: {
      storeItemId: true,
      externalListingId: true,
      syncError: true,
      storeItem: { select: { title: true } },
    },
    take: 5,
  });

  // Per-link diagnostic: compares INW qty, the agreed baseline, and the LIVE Wix qty so a single
  // call after a test sale shows whether (a) the sale decremented INW, (b) the push ran/advanced
  // the baseline, and (c) Wix actually reflects it. INW != Wix with INW == baseline => push never
  // ran; INW != baseline => cron backstop should push next pass.
  const allLinks = await prisma.channelListingLink.findMany({
    where: { connectionId: ctx.id, provider: "wix", syncEnabled: true },
    select: {
      storeItemId: true,
      externalListingId: true,
      syncStatus: true,
      syncError: true,
      lastPushedAt: true,
      lastInboundAt: true,
      syncBaselineQty: true,
      storeItem: { select: { title: true, quantity: true, status: true, updatedAt: true } },
    },
    take: 25,
  });
  const adapter = getAdapter("wix");
  const links = await Promise.all(
    allLinks.map(async (l) => {
      let wixQuantity: number | null = null;
      let wixQuantityKnown = false;
      try {
        if (adapter.fetchProductQuantity) {
          const r = await adapter.fetchProductQuantity(ctx, l.externalListingId);
          wixQuantity = r.quantity;
          wixQuantityKnown = r.known;
        }
      } catch {
        /* read is best-effort */
      }
      const inwQty = l.storeItem.quantity;
      const baselineQty = l.syncBaselineQty;
      return {
        title: l.storeItem.title,
        productId: l.externalListingId,
        inwQuantity: inwQty,
        inwStatus: l.storeItem.status,
        baselineQuantity: baselineQty,
        wixQuantity,
        wixQuantityKnown,
        inwMatchesWix: wixQuantityKnown ? wixQuantity === inwQty : null,
        inwChangedSinceBaseline: baselineQty != null ? inwQty !== baselineQty : null,
        syncStatus: l.syncStatus,
        syncError: l.syncError,
        lastPushedAt: l.lastPushedAt,
        lastInboundAt: l.lastInboundAt,
        itemUpdatedAt: l.storeItem.updatedAt,
      };
    })
  );

  return NextResponse.json({
    ok: !listError,
    connectionId: ctx.id,
    siteId: siteId ?? null,
    hadSiteIdBeforeResolve: Boolean(siteIdBefore),
    catalogApi,
    catalogVersion,
    productCount,
    linkedCount,
    syncErrors: errorLinks.map((l) => ({
      storeItemId: l.storeItemId,
      title: l.storeItem.title,
      productId: l.externalListingId,
      error: l.syncError,
    })),
    links,
    listError,
    hint:
      linkedCount === 0
        ? "No INW items linked to Wix — use Import existing listings."
        : productCount === 0 && !listError
          ? "Wix connected but no products found. Add products in Wix Stores or check app permissions."
          : listError
            ? "Reconnect Wix in Sync Stores and confirm Stores read + Manage Your App permissions in dev.wix.com."
            : null,
  });
}
