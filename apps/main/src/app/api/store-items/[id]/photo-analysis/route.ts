import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { analyzePhotos, getPhotoQualitySummary } from "@/lib/photo-quality-analysis";

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
      photos: true,
    },
  });

  if (!item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  if (item.memberId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (item.photos.length === 0) {
    return NextResponse.json({
      storeItemId: item.id,
      photos: [],
      summary: {
        totalPhotos: 0,
        goodPhotos: 0,
        acceptablePhotos: 0,
        poorPhotos: 0,
        overallQuality: "poor",
        topIssues: ["No photos uploaded"],
      },
    });
  }

  // Analyze all photos
  const results = await analyzePhotos(item.photos);
  const summary = getPhotoQualitySummary(results);

  return NextResponse.json({
    storeItemId: item.id,
    photos: results,
    summary,
  });
}
