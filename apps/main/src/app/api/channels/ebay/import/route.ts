import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { z } from "zod";
import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";
import { getMemberConnectionContext } from "@/lib/channels/connection";
import { getAdapter } from "@/lib/channels/registry";
import { migrateEbayListings } from "@/lib/channels/ebay/trading";

export const dynamic = "force-dynamic";

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
function uniqueSlug(base: string): string {
  return `${base || "ebay-item"}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function loadRemoteWithLinkState(userId: string) {
  const ctx = await getMemberConnectionContext(userId, "ebay");
  if (!ctx) {
    return { ctx: null, listings: [] as Awaited<ReturnType<ReturnType<typeof getAdapter>["listRemoteListings"]>> };
  }
  const listings = await getAdapter("ebay").listRemoteListings(ctx);
  // Existing links key on the eBay SKU; the preview keys on the legacy listing id, so this flag
  // is best-effort. The POST import dedupes precisely by SKU after migration.
  const linked = await prisma.channelListingLink.findMany({
    where: { provider: "ebay", connectionId: ctx.id },
    select: { externalListingId: true },
  });
  const linkedSet = new Set(linked.map((l) => l.externalListingId));
  return {
    ctx,
    listings: listings.map((l) => ({ ...l, alreadyLinked: linkedSet.has(l.externalListingId) })),
  };
}

/** GET: preview the seller's eBay listings. */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ctx = await getMemberConnectionContext(userId, "ebay");
  if (!ctx) {
    return NextResponse.json({ error: "Connect your eBay account first.", code: "NOT_CONNECTED" }, { status: 400 });
  }
  try {
    const { listings } = await loadRemoteWithLinkState(userId);
    return NextResponse.json({ listings });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not load eBay listings.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

const bodySchema = z.object({
  listingIds: z.array(z.string()).min(1, "Select at least one listing to import."),
});

/**
 * POST: import selected eBay listings. Each listing is migrated to the Inventory model (so unified
 * inventory updates work), then created as a StoreItem and linked by its eBay SKU for ongoing sync.
 */
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

  const ctx = await getMemberConnectionContext(userId, "ebay");
  if (!ctx) {
    return NextResponse.json({ error: "Connect your eBay account first.", code: "NOT_CONNECTED" }, { status: 400 });
  }

  let remote;
  try {
    remote = (await getAdapter("ebay").listRemoteListings(ctx)).filter((l) =>
      body.listingIds.includes(l.externalListingId)
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not load eBay listings.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const imported: { externalListingId: string; storeItemId: string }[] = [];
  const skipped: { externalListingId: string; reason: string }[] = [];

  // Migrate the classic listings to the Inventory model; this yields the SKU we link on.
  let migration: Awaited<ReturnType<typeof migrateEbayListings>>;
  try {
    migration = await migrateEbayListings(
      ctx.accessToken,
      remote.map((l) => l.externalListingId)
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not migrate eBay listings.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  for (const listing of remote) {
    const legacyId = listing.externalListingId;
    const result = migration.get(legacyId);
    if (!result || result.error || !result.sku) {
      skipped.push({ externalListingId: legacyId, reason: result?.error || "migration_failed" });
      continue;
    }
    const sku = result.sku;

    const existing = await prisma.channelListingLink.findUnique({
      where: { provider_externalListingId: { provider: "ebay", externalListingId: sku } },
    });
    if (existing) {
      skipped.push({ externalListingId: legacyId, reason: "already_linked" });
      continue;
    }
    if (listing.priceCents < 1) {
      skipped.push({ externalListingId: legacyId, reason: "invalid_price" });
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
            condition: "used",
            listingType: "new",
            acceptOffers: false,
            slug: uniqueSlug(slugify(listing.title)),
          },
        });
        await tx.channelListingLink.create({
          data: {
            storeItemId: storeItem.id,
            connectionId: ctx.id,
            provider: "ebay",
            externalListingId: sku,
            externalShopId: ctx.externalShopId,
            syncEnabled: true,
            syncStatus: "synced",
            lastPushedAt: new Date(),
            lastInboundAt: new Date(),
          },
        });
        return storeItem;
      });
      imported.push({ externalListingId: legacyId, storeItemId: created.id });
    } catch (e) {
      console.error("[channels] ebay import failed", { externalListingId: legacyId, error: String(e) });
      skipped.push({ externalListingId: legacyId, reason: "create_failed" });
    }
  }

  return NextResponse.json({ ok: true, imported, skipped });
}
