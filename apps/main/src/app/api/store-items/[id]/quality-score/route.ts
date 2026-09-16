import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { calculateQualityScore, getQualityIssueSummary } from "@/lib/listing-quality-score";
import { analyzePhotos } from "@/lib/photo-quality-analysis";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Fetch the store item
  const item = await prisma.storeItem.findUnique({
    where: { id },
    select: {
      id: true,
      memberId: true,
      title: true,
      description: true,
      photos: true,
      priceCents: true,
      quantity: true,
      inventoryTracking: true,
      category: true,
      subcategory: true,
      condition: true,
      shippingCostCents: true,
      shippingDisabled: true,
      localDeliveryAvailable: true,
      inStorePickupAvailable: true,
      variants: true,
      aspects: true,
    },
  });

  if (!item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  if (item.memberId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const analyzePhotosParam = searchParams.get("analyzePhotos") !== "false";

  // Analyze photos if requested (default: true)
  let photoAnalysis;
  if (analyzePhotosParam && item.photos.length > 0) {
    try {
      photoAnalysis = await analyzePhotos(item.photos);
    } catch (e) {
      console.error("[quality-score] Photo analysis error:", e);
      photoAnalysis = undefined;
    }
  }

  // Calculate quality score
  const score = await calculateQualityScore(
    {
      title: item.title,
      description: item.description,
      photos: item.photos,
      priceCents: item.priceCents,
      quantity: item.quantity,
      inventoryTracking: item.inventoryTracking,
      category: item.category,
      subcategory: item.subcategory,
      condition: item.condition,
      shippingCostCents: item.shippingCostCents,
      shippingDisabled: item.shippingDisabled,
      localDeliveryAvailable: item.localDeliveryAvailable,
      inStorePickupAvailable: item.inStorePickupAvailable,
      variants: item.variants,
      aspects: item.aspects,
    },
    {
      photoAnalysis,
    }
  );

  const summary = getQualityIssueSummary(score);

  return NextResponse.json({
    storeItemId: item.id,
    ...score,
    topIssues: summary,
  });
}
