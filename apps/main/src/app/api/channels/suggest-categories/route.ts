import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { isChannelProvider, type ChannelProvider } from "@/lib/channels/types";
import {
  suggestProviderCategories,
  suggestInwCategoryFromTitle,
} from "@/lib/channels/category-suggest";

export const dynamic = "force-dynamic";

/**
 * GET /api/channels/suggest-categories
 *
 * Suggest provider-specific categories based on item data.
 *
 * Query params:
 * - title: Item title (used for keyword-based suggestions)
 * - category: INW category
 * - subcategory: INW subcategory (optional)
 * - providers: Comma-separated list of providers (ebay,etsy,shopify,wix)
 * - suggestInw: If "true", also suggest INW categories from title
 *
 * Response:
 * {
 *   suggestions: {
 *     ebay: [{ categoryId, categoryPath, confidence }, ...],
 *     etsy: [...],
 *     shopify: [...],
 *     wix: [...]
 *   },
 *   inwSuggestion?: { category, subcategory, confidence }
 * }
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getSessionForApi(req);
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const title = searchParams.get("title") ?? "";
    const category = searchParams.get("category") ?? "";
    const subcategory = searchParams.get("subcategory") ?? null;
    const providersParam = searchParams.get("providers") ?? "";
    const suggestInw = searchParams.get("suggestInw") === "true";

    // Parse providers
    let providers: ChannelProvider[] = [];
    if (providersParam) {
      for (const p of providersParam.split(",")) {
        const trimmed = p.trim().toLowerCase();
        if (isChannelProvider(trimmed)) {
          providers.push(trimmed);
        }
      }
    }

    // If no providers specified, get connected providers for this user
    if (providers.length === 0) {
      const connections = await prisma.channelConnection.findMany({
        where: { memberId: userId, status: { not: "disconnected" } },
        select: { provider: true },
      });
      providers = connections
        .map((c) => c.provider)
        .filter((p): p is ChannelProvider => isChannelProvider(p));
    }

    // Get provider-specific category suggestions
    const suggestions = await suggestProviderCategories(
      {
        title,
        category: category || null,
        subcategory,
      },
      providers
    );

    // Optionally suggest INW category from title
    let inwSuggestion: { category: string; subcategory: string | null; confidence: number } | null =
      null;
    if (suggestInw && title.trim()) {
      inwSuggestion = suggestInwCategoryFromTitle(title);
    }

    return NextResponse.json({
      suggestions,
      ...(inwSuggestion && { inwSuggestion }),
    });
  } catch (e) {
    console.error("[suggest-categories] error:", e);
    return NextResponse.json(
      { error: "Failed to suggest categories", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
