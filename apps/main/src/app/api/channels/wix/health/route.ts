import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getMemberConnectionContext } from "@/lib/channels/connection";
import { getAdapter } from "@/lib/channels/registry";
import { isWixConfigured } from "@/lib/channels/wix/config";
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

  return NextResponse.json({
    ok: !listError,
    connectionId: ctx.id,
    siteId: siteId ?? null,
    hadSiteIdBeforeResolve: Boolean(siteIdBefore),
    productCount,
    listError,
    hint:
      productCount === 0 && !listError
        ? "Wix connected but no products found. Add products in Wix Stores or check app permissions."
        : listError
          ? "Reconnect Wix in Sync Stores and confirm Stores read + Manage Your App permissions in dev.wix.com."
          : null,
  });
}
