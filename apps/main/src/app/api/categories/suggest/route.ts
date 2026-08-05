import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionForApi } from "@/lib/mobile-auth";
import {
  suggestCategoriesFromContent,
  resolveInwCategoryWithLearning,
  type CategorySuggestion,
} from "@/lib/channels/category-resolver";
import type { ChannelProvider } from "@/lib/channels/types";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().nullable().optional(),
  provider: z.enum(["etsy", "ebay", "shopify", "wix"]).optional(),
  remoteCategory: z.string().nullable().optional(),
  remoteSubcategory: z.string().nullable().optional(),
});

/**
 * POST /api/categories/suggest
 *
 * Suggest INW categories based on listing content.
 *
 * Request body:
 * {
 *   title: string,           // Required: listing title
 *   description?: string,    // Optional: listing description
 *   provider?: string,       // Optional: channel provider for remote mapping
 *   remoteCategory?: string, // Optional: remote category to map
 *   remoteSubcategory?: string
 * }
 *
 * Response:
 * {
 *   suggestions: [
 *     { category, subcategory, confidence, matchedKeywords },
 *     ...
 *   ],
 *   remoteMapped?: { category, subcategory, confidence }  // When remoteCategory provided
 * }
 */
export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let data: z.infer<typeof bodySchema>;
  try {
    const body = await req.json();
    data = bodySchema.parse(body);
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Invalid input";
    return NextResponse.json({ error: String(msg) }, { status: 400 });
  }

  const { title, description, provider, remoteCategory, remoteSubcategory } = data;

  // Get ML-style suggestions from content
  const suggestions = suggestCategoriesFromContent(title, description);

  // If remote category provided, also try to map it
  let remoteMapped: CategorySuggestion | null = null;
  if (remoteCategory && provider) {
    const resolved = await resolveInwCategoryWithLearning(
      remoteCategory,
      remoteSubcategory,
      { provider: provider as ChannelProvider }
    );
    if (resolved) {
      remoteMapped = {
        category: resolved.category,
        subcategory: resolved.subcategory,
        confidence: resolved.score ?? 0.5,
      };
    }
  }

  return NextResponse.json({
    suggestions,
    remoteMapped,
  });
}
