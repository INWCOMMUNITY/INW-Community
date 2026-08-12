import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { seedChannelCategoryMappings } from "@/lib/channels/channel-mapping-seed";
import { countChannelCategoryMappings } from "@/lib/channels/channel-category-mapping";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/admin/channel-category-mappings/seed
 * Rebuild channel_category_mapping from alias tables + full Etsy/eBay taxonomy plans.
 */
export async function POST(req: NextRequest) {
  const ok = await requireAdmin(req);
  if (!ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await seedChannelCategoryMappings();
    const counts = {
      ebay: await countChannelCategoryMappings("ebay"),
      etsy: await countChannelCategoryMappings("etsy"),
      wix: await countChannelCategoryMappings("wix"),
      total: result.total,
    };
    return NextResponse.json({ ok: true, ...result, counts });
  } catch (e) {
    console.error("[admin] channel category mapping seed failed", e);
    return NextResponse.json({ error: "Seed failed" }, { status: 500 });
  }
}
