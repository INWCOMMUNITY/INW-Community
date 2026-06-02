import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { z } from "zod";
import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";
import { getMemberConnectionContext } from "@/lib/channels/connection";
import { getAdapter } from "@/lib/channels/registry";

export const dynamic = "force-dynamic";

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
function uniqueSlug(base: string): string {
  return `${base || "etsy-item"}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function loadRemoteWithLinkState(userId: string) {
  const ctx = await getMemberConnectionContext(userId, "etsy");
  if (!ctx) return { ctx: null, listings: [] as Awaited<ReturnType<ReturnType<typeof getAdapter>["listRemoteListings"]>> };
  const adapter = getAdapter("etsy");
  const listings = await adapter.listRemoteListings(ctx);
  const linked = await prisma.channelListingLink.findMany({
    where: { provider: "etsy", externalListingId: { in: listings.map((l) => l.externalListingId) } },
    select: { externalListingId: true },
  });
  const linkedSet = new Set(linked.map((l) => l.externalListingId));
  return {
    ctx,
    listings: listings.map((l) => ({ ...l, alreadyLinked: linkedSet.has(l.externalListingId) })),
  };
}

/** GET: preview the seller's Etsy listings, flagging ones already linked to INW. */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ctx = await getMemberConnectionContext(userId, "etsy");
  if (!ctx) {
    return NextResponse.json({ error: "Connect your Etsy shop first.", code: "NOT_CONNECTED" }, { status: 400 });
  }
  try {
    const { listings } = await loadRemoteWithLinkState(userId);
    return NextResponse.json({ listings });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not load Etsy listings.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

const bodySchema = z.object({
  listingIds: z.array(z.string()).min(1, "Select at least one listing to import."),
});

/** POST: import selected Etsy listings as StoreItems and link them for ongoing sync. */
export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const canList = await memberHasStorefrontListingAccess(userId);
  if (!canList) {
    return NextResponse.json({ error: "Seller plan required to import listings." }, { status: 403 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Invalid input";
    return NextResponse.json({ error: String(msg) }, { status: 400 });
  }

  const ctx = await getMemberConnectionContext(userId, "etsy");
  if (!ctx) {
    return NextResponse.json({ error: "Connect your Etsy shop first.", code: "NOT_CONNECTED" }, { status: 400 });
  }

  let remote;
  try {
    remote = (await getAdapter("etsy").listRemoteListings(ctx)).filter((l) =>
      body.listingIds.includes(l.externalListingId)
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not load Etsy listings.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const imported: { externalListingId: string; storeItemId: string }[] = [];
  const skipped: { externalListingId: string; reason: string }[] = [];

  for (const listing of remote) {
    const existing = await prisma.channelListingLink.findUnique({
      where: {
        provider_externalListingId: { provider: "etsy", externalListingId: listing.externalListingId },
      },
    });
    if (existing) {
      skipped.push({ externalListingId: listing.externalListingId, reason: "already_linked" });
      continue;
    }
    if (listing.priceCents < 1) {
      skipped.push({ externalListingId: listing.externalListingId, reason: "invalid_price" });
      continue;
    }

    try {
      const created = await prisma.$transaction(async (tx) => {
        const storeItem = await tx.storeItem.create({
          data: {
            memberId: userId,
            title: listing.title.slice(0, 200),
            description: listing.description,
            photos: listing.photos,
            priceCents: listing.priceCents,
            quantity: Math.max(0, listing.quantity),
            status: listing.quantity > 0 ? "active" : "sold_out",
            condition: "new",
            listingType: "new",
            acceptOffers: false,
            // Etsy is the origin; keep the listing's identity for future re-pushes.
            etsyWhoMade: "i_did",
            etsyWhenMade: "made_to_order",
            slug: uniqueSlug(slugify(listing.title)),
          },
        });
        await tx.channelListingLink.create({
          data: {
            storeItemId: storeItem.id,
            connectionId: ctx.id,
            provider: "etsy",
            externalListingId: listing.externalListingId,
            externalShopId: ctx.externalShopId,
            syncEnabled: true,
            syncStatus: "synced",
            lastPushedAt: new Date(),
            lastInboundAt: new Date(),
          },
        });
        return storeItem;
      });
      imported.push({ externalListingId: listing.externalListingId, storeItemId: created.id });
    } catch (e) {
      console.error("[channels] etsy import failed", {
        externalListingId: listing.externalListingId,
        error: String(e),
      });
      skipped.push({ externalListingId: listing.externalListingId, reason: "create_failed" });
    }
  }

  return NextResponse.json({ ok: true, imported, skipped });
}
