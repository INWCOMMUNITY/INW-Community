import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { unsyncChannelListingByExternalId } from "@/lib/channels/unsync-listing";

export const dynamic = "force-dynamic";

/**
 * DELETE: Unsync an Etsy listing from INW.
 *
 * Query params:
 *   - listingId: Etsy listing_id
 *   - removeFromINW: If "true", also delete the StoreItem from INW. Otherwise, only remove the link.
 */
export async function DELETE(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const listingId = searchParams.get("listingId");
  const removeFromINW = searchParams.get("removeFromINW") === "true";

  if (!listingId) {
    return NextResponse.json({ error: "Listing ID is required" }, { status: 400 });
  }

  const result = await unsyncChannelListingByExternalId({
    userId,
    provider: "etsy",
    externalListingId: listingId,
    removeFromINW,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  console.log("[etsy] unsync completed", {
    userId,
    listingId,
    removeFromINW,
    storeItemId: result.storeItemId,
  });

  return NextResponse.json({
    ok: true,
    message: result.message,
    removed: result.removed,
    storeItemId: result.storeItemId,
  });
}
