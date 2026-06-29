import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

export const dynamic = "force-dynamic";

/**
 * DELETE: Unsync an eBay listing from INW.
 * This removes the channelListingLink but keeps the StoreItem.
 * The listing can then be re-imported if desired.
 *
 * Query params:
 *   - listingId: The legacy eBay listing ID (ItemID) to unsync
 */
export async function DELETE(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const legacyId = searchParams.get("listingId");

  if (!legacyId) {
    return NextResponse.json({ error: "Listing ID is required" }, { status: 400 });
  }

  // Find the link by provider and listing ID, regardless of which connection created it.
  // This allows unsync to work even if the user reconnected eBay (new connection ID).
  const link = await prisma.channelListingLink.findFirst({
    where: {
      provider: "ebay",
      OR: [
        { externalListingId: legacyId },
        { externalListingId: `inw${legacyId}` },
      ],
    },
    include: {
      storeItem: { select: { id: true, memberId: true, title: true } },
    },
  });

  if (!link) {
    return NextResponse.json(
      { error: "Listing not found or not linked to your account." },
      { status: 404 }
    );
  }

  // Verify ownership
  if (link.storeItem?.memberId !== userId) {
    return NextResponse.json(
      { error: "You don't have permission to unsync this listing." },
      { status: 403 }
    );
  }

  // Delete the link (keeps the StoreItem intact)
  await prisma.channelListingLink.delete({ where: { id: link.id } });

  console.log("[ebay] unsync completed", {
    userId,
    legacyId,
    linkId: link.id,
    storeItemId: link.storeItemId,
    storeItemTitle: link.storeItem?.title,
  });

  return NextResponse.json({
    ok: true,
    message: `Unsynced "${link.storeItem?.title ?? legacyId}" from eBay.`,
    storeItemId: link.storeItemId,
  });
}
