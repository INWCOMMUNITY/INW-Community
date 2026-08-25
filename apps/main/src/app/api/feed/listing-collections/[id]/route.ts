import { NextRequest, NextResponse } from "next/server";
import { getListingFeedCollectionById } from "@/lib/listing-feed-collection";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const collection = await getListingFeedCollectionById(id);
  if (!collection) {
    return NextResponse.json({ error: "Collection not found." }, { status: 404 });
  }
  return NextResponse.json(collection);
}
