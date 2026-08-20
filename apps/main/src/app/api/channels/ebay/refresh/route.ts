import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { z } from "zod";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getMemberConnectionContext } from "@/lib/channels/connection";
import { enumerateEbayListings } from "@/lib/channels/ebay/trading";
import { resolveEbayLegacyListingId } from "@/lib/channels/ebay/mapping";
import { refreshEbayListingByItemId } from "@/lib/channels/ebay/pull-ebay-updates";

export const dynamic = "force-dynamic";

const RefreshBodySchema = z.object({
  storeItemId: z.string().min(1),
});

/**
 * POST: Refresh a StoreItem from its linked eBay listing via GetItem.
 * Body: { storeItemId: string }
 */
export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof RefreshBodySchema>;
  try {
    body = RefreshBodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { storeItemId } = body;

  const storeItem = await prisma.storeItem.findUnique({
    where: { id: storeItemId },
    select: { id: true, memberId: true, title: true },
  });

  if (!storeItem) {
    return NextResponse.json({ error: "Store item not found" }, { status: 404 });
  }

  if (storeItem.memberId !== userId) {
    return NextResponse.json({ error: "You don't own this item" }, { status: 403 });
  }

  const link = await prisma.channelListingLink.findFirst({
    where: { storeItemId, provider: "ebay" },
    select: { externalListingId: true },
  });

  if (!link) {
    return NextResponse.json({ error: "This item is not linked to eBay" }, { status: 404 });
  }

  const ctx = await getMemberConnectionContext(userId, "ebay");
  if (!ctx) {
    return NextResponse.json({ error: "eBay is not connected" }, { status: 400 });
  }

  let legacyItemId = resolveEbayLegacyListingId(link.externalListingId);

  if (!legacyItemId) {
    const listings = await enumerateEbayListings(ctx.accessToken);
    const match = listings.find((l) => l.title.toLowerCase() === storeItem.title.toLowerCase());
    if (match) legacyItemId = match.listingId;
  }

  if (!legacyItemId) {
    return NextResponse.json(
      { error: "Could not find the eBay listing ID. The listing may have been removed from eBay." },
      { status: 404 }
    );
  }

  const result = await refreshEbayListingByItemId(ctx.accessToken, legacyItemId, { force: true });
  const item = await prisma.storeItem.findUnique({
    where: { id: storeItemId },
    select: {
      title: true,
      description: true,
      photos: true,
      category: true,
      subcategory: true,
      priceCents: true,
      quantity: true,
      ebayCategoryId: true,
      aspects: true,
      condition: true,
      acceptOffers: true,
      minOfferCents: true,
    },
  });

  const changes = result?.changes ?? [];
  const updated = Boolean(result?.updated);

  return NextResponse.json({
    ok: true,
    updated,
    changes,
    item,
    message: updated && changes.length > 0
      ? `Refreshed from eBay: ${changes.join(", ")}`
      : "Already up to date with eBay",
  });
}
