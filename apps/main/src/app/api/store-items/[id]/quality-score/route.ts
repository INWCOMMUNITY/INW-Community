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
      category: true,
      subcategory: true,
      condition: true,
      shippingCostCents: true,
      shippingDisabled: true,
      localDeliveryAvailable: true,
      inStorePickupAvailable: true,
      variants: true,
      aspects: true,
      etsyWhoMade: true,
      etsyWhenMade: true,
      etsyIsSupply: true,
      ebayCategoryId: true,
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
  const checkChannels = searchParams.get("checkChannels") === "true";

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

  // Fetch member's channel connections if checking channel readiness
  let memberConnections;
  if (checkChannels) {
    const connections = await prisma.channelConnection.findMany({
      where: { memberId: session.user.id },
      select: {
        provider: true,
        status: true,
        etsyShippingProfileId: true,
        config: true,
      },
    });
    memberConnections = connections;
  }

  // Calculate quality score
  const score = await calculateQualityScore(
    {
      title: item.title,
      description: item.description,
      photos: item.photos,
      priceCents: item.priceCents,
      quantity: item.quantity,
      category: item.category,
      subcategory: item.subcategory,
      condition: item.condition,
      shippingCostCents: item.shippingCostCents,
      shippingDisabled: item.shippingDisabled,
      localDeliveryAvailable: item.localDeliveryAvailable,
      inStorePickupAvailable: item.inStorePickupAvailable,
      variants: item.variants as unknown[] | null,
      aspects: item.aspects,
      etsyWhoMade: item.etsyWhoMade,
      etsyWhenMade: item.etsyWhenMade,
      etsyIsSupply: item.etsyIsSupply,
      ebayCategoryId: item.ebayCategoryId,
    },
    {
      photoAnalysis,
      checkChannelReadiness: checkChannels,
      memberConnections,
    }
  );

  const summary = getQualityIssueSummary(score);

  return NextResponse.json({
    storeItemId: item.id,
    ...score,
    topIssues: summary,
  });
}
