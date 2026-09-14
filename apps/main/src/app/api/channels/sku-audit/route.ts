import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { isChannelProvider, type ChannelProvider } from "@/lib/channels/types";
import { runSkuAudit } from "@/lib/channels/sku-audit-run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/channels/sku-audit
 *
 * Read-only SKU identity report. Default is INW catalog only.
 *   live=1 — GET each linked listing's SKUs (no writes)
 *   provider — ebay | etsy | shopify | wix (live hydrate filter)
 *   storeItemId — one listing (OC3PL TEST-001)
 */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const live = searchParams.get("live") === "1";
  const storeItemId = searchParams.get("storeItemId")?.trim() || null;
  const providerRaw = searchParams.get("provider")?.trim() ?? "";
  const provider: ChannelProvider | null = isChannelProvider(providerRaw) ? providerRaw : null;

  const report = await runSkuAudit({
    memberId: userId,
    live,
    provider,
    storeItemId,
  });

  return NextResponse.json({ ok: true, ...report });
}
