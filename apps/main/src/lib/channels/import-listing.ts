import { prisma, Prisma } from "database";
import { resolveInwCategoryFromRemote } from "./category-resolver";
import {
  normalizeVariantsFromProvider,
  sumVariantQuantities,
  variantsFingerprint,
  type InwVariantAxis,
} from "./variant-sync";
import { syncContentHash, syncMetaHash, SYNC_ECHO_SKEW_MS } from "./sync-baseline";
import type { ChannelProvider, RemoteListingSummary } from "./types";

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function uniqueSlug(base: string): string {
  return `${base || "channel-item"}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Strip HTML from Wix/Etsy descriptions for the INW listing body. */
export function plainListingDescription(description: string | null | undefined): string | null {
  if (!description?.trim()) return null;
  const text = description
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

/** Auto-post so the listing appears on the seller's storefront feed. */
function autoPostStoreItemToFeed(authorId: string, storeItemId: string): void {
  prisma.post
    .create({
      data: {
        type: "shared_store_item",
        authorId,
        sourceStoreItemId: storeItemId,
      },
    })
    .catch((err) => console.error("[channels] inbound auto-post failed", err));
}

export type ImportRemoteListingResult =
  | { ok: true; storeItemId: string; externalListingId: string }
  | { ok: false; externalListingId: string; reason: string };

/**
 * Turn an unknown thrown value into a short, human-readable reason that is safe to return to the
 * import UI. Prisma errors are notoriously vague when swallowed (we only ever logged String(e)),
 * which is exactly why import failures were impossible to diagnose. Surface the code + constraint
 * so a single failed import tells us the real cause instead of forcing another guess-and-deploy.
 */
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

/**
 * If a link already exists for (provider, externalListingId), relink it (same owner) or report
 * already_linked. Returns null when there is no existing link so the caller can create a fresh one.
 * Also self-heals orphaned links whose StoreItem was hard-deleted.
 */
async function resolveExistingLink(args: {
  memberId: string;
  connectionId: string;
  provider: ChannelProvider;
  productId: string;
  externalShopId: string | null;
}): Promise<ImportRemoteListingResult | null> {
  const { memberId, connectionId, provider, productId, externalShopId } = args;
  const existing = await prisma.channelListingLink.findUnique({
    where: { provider_externalListingId: { provider, externalListingId: productId } },
    include: { storeItem: { select: { memberId: true } } },
  });
  if (!existing) return null;

  // Orphaned link (StoreItem gone): drop it and let the caller create a fresh item.
  if (!existing.storeItem) {
    await prisma.channelListingLink.delete({ where: { id: existing.id } }).catch(() => {});
    return null;
  }

  if (existing.storeItem.memberId === memberId) {
    await prisma.channelListingLink.update({
      where: { id: existing.id },
      data: {
        connectionId,
        externalShopId,
        syncEnabled: true,
        syncStatus: "synced",
        syncError: null,
        lastInboundAt: new Date(),
      },
    });
    return { ok: true, storeItemId: existing.storeItemId, externalListingId: productId };
  }
  return { ok: false, externalListingId: productId, reason: "already_linked" };
}

/**
 * Create a StoreItem + channel link from a remote catalog row (Wix/Etsy import path).
 * Skips rows that are already linked or have invalid price.
 *
 * Regression note (June 2026): do NOT wrap the StoreItem + link creates in an interactive
 * `$transaction` — pooled/serverless Postgres can reject interactive transactions, which surfaced
 * only as a generic "create_failed". Create sequentially and clean up the orphan StoreItem if the
 * link create fails. The link create is idempotent: a P2002 collision relinks the existing row
 * instead of failing the whole import.
 */
export async function importRemoteListing(args: {
  memberId: string;
  connectionId: string;
  provider: ChannelProvider;
  listing: RemoteListingSummary;
  externalShopId: string | null;
  postToFeed?: boolean;
}): Promise<ImportRemoteListingResult> {
  const { memberId, connectionId, provider, listing, externalShopId, postToFeed = true } = args;
  const productId = listing.externalListingId;
  if (!productId) {
    return { ok: false, externalListingId: "", reason: "missing_id" };
  }

  const existingResult = await resolveExistingLink({
    memberId,
    connectionId,
    provider,
    productId,
    externalShopId,
  });
  if (existingResult) return existingResult;

  // Defensive field guards: Prisma rejects non-integer priceCents and a null photos array, which
  // previously surfaced only as an opaque create_failed.
  const safePriceCents = Math.max(0, Math.round(Number(listing.priceCents) || 0));
  if (safePriceCents < 1) {
    return { ok: false, externalListingId: productId, reason: "invalid_price" };
  }
  const safePhotos = Array.isArray(listing.photos)
    ? listing.photos.filter((p): p is string => typeof p === "string" && p.length > 0)
    : [];

  let createdStoreItemId: string | null = null;
  try {
    const resolvedCat = resolveInwCategoryFromRemote(listing.category, listing.subcategory);
    const normalizedVariants: InwVariantAxis[] | null =
      listing.variantsKnown === true && Array.isArray(listing.variants)
        ? (listing.variants as InwVariantAxis[])
        : listing.variantsKnown !== false && listing.variants
          ? normalizeVariantsFromProvider(provider, listing.variants)
          : null;
    const importQty =
      normalizedVariants && normalizedVariants.length > 0
        ? sumVariantQuantities(normalizedVariants)
        : listing.quantityKnown === false
          ? 1
          : Math.max(0, Math.round(Number(listing.quantity) || 0));
    const shippingCents =
      listing.shippingKnown !== false && listing.shippingCostCents != null
        ? Math.max(0, Math.round(listing.shippingCostCents))
        : null;

    const storeItem = await prisma.storeItem.create({
      data: {
        memberId,
        title: listing.title.slice(0, 200),
        description: plainListingDescription(listing.description),
        photos: safePhotos,
        priceCents: safePriceCents,
        quantity: importQty,
        status: importQty > 0 ? "active" : "sold_out",
        condition: "used",
        listingType: "new",
        acceptOffers: false,
        slug: uniqueSlug(slugify(listing.title)),
        category: resolvedCat?.category ?? listing.category?.slice(0, 200) ?? null,
        subcategory: resolvedCat?.subcategory ?? listing.subcategory?.slice(0, 200) ?? null,
        shippingCostCents: shippingCents,
        variants: normalizedVariants ? (normalizedVariants as object) : undefined,
        ...(provider === "etsy" && listing.remoteCategoryId
          ? { etsyTaxonomyId: Number(listing.remoteCategoryId) || undefined }
          : {}),
        ...(provider === "ebay" && listing.remoteCategoryId
          ? { ebayCategoryId: Number(listing.remoteCategoryId) || undefined }
          : {}),
      },
    });
    createdStoreItemId = storeItem.id;

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
          connectionId,
          provider,
          externalListingId: productId,
          externalShopId,
          syncEnabled: true,
          syncStatus: "synced",
          lastPushedAt: new Date(),
          lastInboundAt: new Date(),
          syncBaselineHash: syncContentHash(storeItem),
          syncBaselineMetaHash: metaHash,
          syncBaselineVariantsHash: variantsFingerprint(storeItem.variants),
          syncBaselineQty: storeItem.quantity,
          syncBaselineAt: listing.remoteUpdatedAt ?? new Date(),
        },
      });
    } catch (linkErr) {
      // Roll back the orphan StoreItem we just created so a failed link never leaves a stray item.
      await prisma.storeItem.delete({ where: { id: storeItem.id } }).catch(() => {});
      createdStoreItemId = null;
      // A link grabbed this (provider, externalListingId) between our pre-check and now: relink it.
      if (
        linkErr instanceof Prisma.PrismaClientKnownRequestError &&
        linkErr.code === "P2002"
      ) {
        const relinked = await resolveExistingLink({
          memberId,
          connectionId,
          provider,
          productId,
          externalShopId,
        });
        if (relinked) return relinked;
      }
      throw linkErr;
    }

    if (postToFeed) {
      autoPostStoreItemToFeed(memberId, storeItem.id);
    }
    return { ok: true, storeItemId: storeItem.id, externalListingId: productId };
  } catch (e) {
    if (createdStoreItemId) {
      await prisma.storeItem.delete({ where: { id: createdStoreItemId } }).catch(() => {});
    }
    const reason = describeImportError(e);
    console.error("[channels] importRemoteListing failed", {
      provider,
      externalListingId: productId,
      reason,
    });
    return { ok: false, externalListingId: productId, reason };
  }
}
