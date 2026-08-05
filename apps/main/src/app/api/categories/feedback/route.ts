import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionForApi } from "@/lib/mobile-auth";
import { recordCategoryFeedback } from "@/lib/channels/category-resolver";
import type { ChannelProvider } from "@/lib/channels/types";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  provider: z.enum(["etsy", "ebay", "shopify", "wix"]),
  remoteCategory: z.string().min(1),
  remoteSubcategory: z.string().nullable().optional(),
  autoMapped: z.string().min(1),
  autoMappedSubcategory: z.string().nullable().optional(),
  sellerChosen: z.string().min(1),
  sellerChosenSubcategory: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).optional(),
  storeItemId: z.string().optional(),
});

/**
 * POST /api/categories/feedback
 *
 * Record seller feedback on category auto-mapping.
 * Used to improve future auto-mapping accuracy.
 *
 * Request body:
 * {
 *   provider: "etsy" | "ebay" | "shopify" | "wix",
 *   remoteCategory: string,
 *   remoteSubcategory?: string,
 *   autoMapped: string,        // What the system suggested
 *   autoMappedSubcategory?: string,
 *   sellerChosen: string,      // What the seller picked
 *   sellerChosenSubcategory?: string,
 *   confidence?: number,       // Original confidence score
 *   storeItemId?: string
 * }
 *
 * Response:
 * { ok: true }
 */
export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;

  if (!userId) {
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

  await recordCategoryFeedback({
    provider: data.provider as ChannelProvider,
    remoteCategory: data.remoteCategory,
    remoteSubcategory: data.remoteSubcategory ?? null,
    autoMapped: data.autoMapped,
    autoMappedSubcategory: data.autoMappedSubcategory ?? null,
    sellerChosen: data.sellerChosen,
    sellerChosenSubcategory: data.sellerChosenSubcategory ?? null,
    confidence: data.confidence,
    storeItemId: data.storeItemId,
    memberId: userId,
  });

  return NextResponse.json({ ok: true });
}
