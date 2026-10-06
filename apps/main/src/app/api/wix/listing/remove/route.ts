import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { removeWixListing } from "@/lib/wix/listing-actions";

export const dynamic = "force-dynamic";

/**
 * POST /api/wix/listing/remove
 * Delete the Wix product and the local mapping. Does not disconnect the shop.
 * Body: { listingLinkId: string }
 */
export async function POST(request: Request): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { listingLinkId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.listingLinkId) {
    return NextResponse.json({ error: "listingLinkId required" }, { status: 400 });
  }

  const result = await removeWixListing({
    listingLinkId: body.listingLinkId,
    memberId: session.user.id,
  });
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 500 });
  }
  return NextResponse.json({ removed: true, listingLinkId: result.listingLinkId });
}
