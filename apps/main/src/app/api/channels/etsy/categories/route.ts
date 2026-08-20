import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getMemberConnectionContextWithError } from "@/lib/channels/connection";
import { lookupEtsyCategory, searchEtsyCategories } from "@/lib/channels/etsy/taxonomy-search";
import { EtsyApiError } from "@/lib/channels/etsy/client";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/channels/etsy/categories?q=
 * GET /api/channels/etsy/categories?id=
 *
 * Live Etsy seller-taxonomy suggestions for the listing picker.
 * Uses the seller's connected Etsy OAuth token.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getSessionForApi(req);
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
    const idRaw = req.nextUrl.searchParams.get("id")?.trim() ?? "";
    const taxonomyId = idRaw ? Number(idRaw) : NaN;

    if (!q && !Number.isInteger(taxonomyId)) {
      return NextResponse.json({ categories: [] });
    }

    const { ctx, error } = await getMemberConnectionContextWithError(userId, "etsy");
    if (!ctx) {
      return NextResponse.json(
        { error: error ?? "Connect Etsy in Sync Stores to search categories." },
        { status: 503 }
      );
    }

    if (Number.isInteger(taxonomyId) && taxonomyId > 0) {
      const hit = await lookupEtsyCategory(ctx.accessToken, taxonomyId, ctx.id);
      return NextResponse.json({ categories: hit ? [hit] : [] });
    }

    if (q.length < 2) {
      return NextResponse.json({ categories: [] });
    }

    const categories = await searchEtsyCategories(ctx.accessToken, q, ctx.id);
    return NextResponse.json({ categories });
  } catch (e) {
    const errMsg =
      e instanceof EtsyApiError
        ? e.message
        : e instanceof Error
          ? e.message
          : "Etsy category search failed.";
    return NextResponse.json({ error: errMsg }, { status: 502 });
  }
}
