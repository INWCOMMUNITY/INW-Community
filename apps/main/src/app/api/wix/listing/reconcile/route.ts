import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { reconcileWixListing } from "@/lib/wix/listing-actions";
import { prisma } from "database";

export const dynamic = "force-dynamic";

/**
 * POST /api/wix/listing/reconcile
 * Trigger manual reconciliation of a Wix listing.
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

  const { listingLinkId } = body;
  if (!listingLinkId) {
    return NextResponse.json({ error: "listingLinkId required" }, { status: 400 });
  }

  // Verify ownership
  const link = await prisma.wixListingLink.findUnique({
    where: { id: listingLinkId },
    select: { memberId: true },
  });

  if (!link || link.memberId !== session.user.id) {
    return NextResponse.json({ error: "Listing link not found" }, { status: 404 });
  }

  const result = await reconcileWixListing({ listingLinkId });

  return NextResponse.json({ enqueued: result.enqueued });
}
