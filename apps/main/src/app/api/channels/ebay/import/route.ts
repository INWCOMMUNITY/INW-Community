import { NextRequest, NextResponse } from "next/server";
import { prisma, Prisma } from "database";
import { z } from "zod";
import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";
import { getMemberConnectionContext } from "@/lib/channels/connection";
import { getAdapter } from "@/lib/channels/registry";
import { migrateEbayListings } from "@/lib/channels/ebay/trading";
import { normalizeEbayPhotoUrl } from "@/lib/channels/ebay/photos";
import { plainListingDescription } from "@/lib/channels/import-listing";
import { resolveInwCategoryFromRemote } from "@/lib/channels/category-resolver";
import { syncContentHash, syncMetaHash } from "@/lib/channels/sync-baseline";
import { variantsFingerprint } from "@/lib/channels/variant-sync";

export const dynamic = "force-dynamic";

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
function uniqueSlug(base: string): string {
  return `${base || "ebay-item"}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function describeImportError(e: unknown): string {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    const target = Array.isArray(e.meta?.target)
      ? (e.meta?.target as string[]).join(",")
      : typeof e.meta?.target === "string"
        ? e.meta.target
        : undefined;
    const detail = e.message.split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? "";
    return `create_failed: ${e.code}${target ? ` (${target})` : ""} ${detail}`.slice(0, 300);
  }
  if (e instanceof Prisma.PrismaClientValidationError) {
    const detail = e.message.split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? e.message;
    return `create_failed: validation ${detail}`.slice(0, 300);
  }
  if (e instanceof Error) return `create_failed: ${e.message}`.slice(0, 300);
  return `create_failed: ${String(e)}`.slice(0, 300);
}

function autoPostStoreItemToFeed(authorId: string, storeItemId: string): void {
  prisma.post
    .create({
      data: {
        type: "shared_store_item",
        authorId,
        sourceStoreItemId: storeItemId,
      },
    })
    .catch((err) => console.error("[channels] ebay import auto-post failed", err));
}

async function loadRemoteWithLinkState(userId: string) {
  const ctx = await getMemberConnectionContext(userId, "ebay");
  if (!ctx) {
    return { ctx: null, listings: [] as Awaited<ReturnType<ReturnType<typeof getAdapter>["listRemoteListings"]>> };
  }
  const listings = await getAdapter("ebay").listRemoteListings(ctx);

  const linked = await prisma.channelListingLink.findMany({
    where: { provider: "ebay", connectionId: ctx.id },
    select: { externalListingId: true, storeItem: { select: { title: true } } },
  });
  const linkedSkus = new Set(linked.map((l) => l.externalListingId));
  const linkedTitles = new Set(
    linked.map((l) => l.storeItem?.title?.trim().toLowerCase()).filter(Boolean)
  );

  return {
    ctx,
    listings: listings.map((l) => ({
      ...l,
      alreadyLinked:
        linkedSkus.has(l.externalListingId) ||
        linkedTitles.has(l.title.trim().toLowerCase()),
    })),
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
      include: { storeItem: { select: { memberId: true } } },
    });
    if (existing) {
      if (!existing.storeItem) {
        await prisma.channelListingLink.delete({ where: { id: existing.id } }).catch(() => {});
      } else {
        skipped.push({ externalListingId: legacyId, reason: "already_linked" });
        continue;
      }
    }

    const safePriceCents = Math.max(0, Math.round(Number(listing.priceCents) || 0));
    if (safePriceCents < 1) {
      skipped.push({ externalListingId: legacyId, reason: "invalid_price" });
      continue;
    }

    const photos = listing.photos
      .map((u) => normalizeEbayPhotoUrl(u))
      .filter((u): u is string => Boolean(u));
    const resolvedCat = resolveInwCategoryFromRemote(listing.category ?? null, listing.subcategory ?? null);
    const importQty = Math.max(0, Math.round(Number(listing.quantity) || 0));

    let createdStoreItemId: string | null = null;
    try {
      const storeItem = await prisma.storeItem.create({
        data: {
          memberId: userId,
          title: listing.title.slice(0, 200),
          description: plainListingDescription(listing.description),
          photos,
          priceCents: safePriceCents,
          quantity: importQty,
          status: importQty > 0 ? "active" : "sold_out",
          condition: "used",
          listingType: "new",
          acceptOffers: false,
          slug: uniqueSlug(slugify(listing.title)),
          category: resolvedCat?.category ?? listing.category?.slice(0, 200) ?? null,
          subcategory: resolvedCat?.subcategory ?? listing.subcategory?.slice(0, 200) ?? null,
          ...(listing.remoteCategoryId
            ? { ebayCategoryId: Number(listing.remoteCategoryId) || undefined }
            : {}),
        },
      });
      createdStoreItemId = storeItem.id;

      const contentHash = syncContentHash(storeItem);
      const metaHash = syncMetaHash({
        category: storeItem.category,
        subcategory: storeItem.subcategory,
        secondaryCategory: storeItem.secondaryCategory,
        shippingCostCents: storeItem.shippingCostCents,
        variants: storeItem.variants,
      });

      try {
        await prisma.channelListingLink.create({
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
            lastPushedHash: contentHash,
            syncBaselineHash: contentHash,
            syncBaselineMetaHash: metaHash,
            syncBaselineVariantsHash: variantsFingerprint(storeItem.variants),
            syncBaselineQty: storeItem.quantity,
            syncBaselineAt: new Date(),
          },
        });
      } catch (linkErr) {
        await prisma.storeItem.delete({ where: { id: storeItem.id } }).catch(() => {});
        createdStoreItemId = null;
        if (linkErr instanceof Prisma.PrismaClientKnownRequestError && linkErr.code === "P2002") {
          skipped.push({ externalListingId: legacyId, reason: "already_linked" });
          continue;
        }
        throw linkErr;
      }

      autoPostStoreItemToFeed(userId, storeItem.id);
      imported.push({ externalListingId: legacyId, storeItemId: storeItem.id });
    } catch (e) {
      if (createdStoreItemId) {
        await prisma.storeItem.delete({ where: { id: createdStoreItemId } }).catch(() => {});
      }
      const reason = describeImportError(e);
      console.error("[channels] ebay import failed", { externalListingId: legacyId, reason });
      skipped.push({ externalListingId: legacyId, reason });
    }
  }

  return NextResponse.json({ ok: true, imported, skipped });
}
