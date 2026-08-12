import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { countChannelCategoryMappings } from "@/lib/channels/channel-category-mapping";
import {
  findChannelAccessToken,
  syncEbayCategoryTreeMappings,
  syncEtsyTaxonomyMappings,
} from "@/lib/channels/marketplace-taxonomy-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/admin/channel-category-mappings/sync
 * Pull full eBay/Etsy taxonomy trees via marketplace APIs and upsert INW mappings.
 * Query: ?provider=ebay|etsy|all (default all)
 */
export async function POST(req: NextRequest) {
  const ok = await requireAdmin(req);
  if (!ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const provider = req.nextUrl.searchParams.get("provider") ?? "all";
  const results: Record<string, unknown> = {};

  try {
    if (provider === "ebay" || provider === "all") {
      const token = await findChannelAccessToken("ebay");
      if (!token) {
        results.ebay = { error: "No active eBay connection with access token" };
      } else {
        results.ebay = await syncEbayCategoryTreeMappings(token);
      }
    }

    if (provider === "etsy" || provider === "all") {
      const token = await findChannelAccessToken("etsy");
      if (!token) {
        results.etsy = { error: "No active Etsy connection with access token" };
      } else {
        results.etsy = await syncEtsyTaxonomyMappings(token);
      }
    }

    const counts = {
      ebay: await countChannelCategoryMappings("ebay"),
      etsy: await countChannelCategoryMappings("etsy"),
      wix: await countChannelCategoryMappings("wix"),
    };

    return NextResponse.json({ ok: true, results, counts });
  } catch (e) {
    console.error("[admin] channel category mapping sync failed", e);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
