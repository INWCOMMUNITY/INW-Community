import { prisma, Prisma } from "database";
import {
  resolveInwCategoryWithSubcategory,
  resolveInwCategoryFromEbayPath,
  resolveInwCategoryFromEtsyTaxonomy,
  seedCategoryMappingFromImport,
  suggestCategoriesFromContent,
  canonicalizeSubcategory,
  type ResolvedInwCategory,
} from "./category-resolver";
import { STORE_CATEGORIES } from "@/lib/store-categories";
import { splitEbayCategoryPath } from "./ebay-category-aliases";
import {
  normalizeVariantsFromProvider,
  sumVariantQuantities,
  variantsFingerprint,
  type InwVariantAxis,
} from "./variant-sync";
import { syncContentHash, syncMetaHash, SYNC_ECHO_SKEW_MS } from "./sync-baseline";
import type { ChannelProvider, RemoteListingSummary } from "./types";
import {
  listingDescriptionToPlainText,
  sanitizeListingDescription,
} from "./rich-description";

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function uniqueSlug(base: string): string {
  return `${base || "channel-item"}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * @deprecated Prefer sanitizeListingDescription. Kept for call sites that still need
 * a plain-text compare; now preserves line breaks instead of collapsing all whitespace.
 */
export function plainListingDescription(description: string | null | undefined): string | null {
  return listingDescriptionToPlainText(description);
}

/** Canonical import/storage transform: keep bold/breaks/lists; strip font/color. */
export function storeListingDescription(description: string | null | undefined): string | null {
  return sanitizeListingDescription(description);
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
  | { ok: true; storeItemId: string; externalListingId: string; needsCategoryReview: boolean }
  | { ok: false; externalListingId: string; reason: string };

export type ImportCategoryAssignment = {
  category: string;
  subcategory: string | null;
  matchedPreset: boolean;
  score?: number;
  source:
    | "ebay_path"
    | "etsy_taxonomy"
    | "remote_metadata"
    | "title_suggestion"
    | "enhanced";
};

/**
 * Shared category pipeline for channel imports (eBay, Etsy, Wix, etc.).
 * Ensures preset categories, canonical subcategories, and title-based fallbacks.
 */
export async function resolveImportCategory(args: {
  provider: ChannelProvider;
  remoteLabel: string | null;
  remoteSubLabel?: string | null;
  title?: string | null;
  description?: string | null;
  remoteCategoryId?: string | null;
}): Promise<ImportCategoryAssignment | null> {
  const {
    provider,
    remoteLabel,
    remoteSubLabel,
    title,
    description,
    remoteCategoryId,
  } = args;

  let resolvedCat: ResolvedInwCategory | null = null;
  let source: ImportCategoryAssignment["source"] = "remote_metadata";

  if (provider === "ebay" && remoteLabel) {
    resolvedCat = await resolveInwCategoryFromEbayPath(remoteLabel, title);
    source = "ebay_path";
  } else if (provider === "etsy") {
    resolvedCat = await resolveInwCategoryFromEtsyTaxonomy(
      remoteCategoryId ? Number(remoteCategoryId) : null,
      remoteLabel,
      title
    );
    source = "etsy_taxonomy";
  } else {
    resolvedCat = await resolveInwCategoryWithSubcategory(remoteLabel, remoteSubLabel, {
      provider,
      title,
    });
  }

  if (resolvedCat?.category && !resolvedCat.subcategory && (provider === "ebay" || provider === "etsy")) {
    const enhanced = await resolveInwCategoryWithSubcategory(remoteLabel, remoteSubLabel, {
      provider,
      title,
    });
    if (enhanced?.subcategory) {
      resolvedCat = { ...resolvedCat, subcategory: enhanced.subcategory };
      source = "enhanced";
    }
  }

  if (!resolvedCat?.category && title) {
    const suggestions = suggestCategoriesFromContent(title, description);
    if (suggestions.length > 0 && suggestions[0].confidence >= 0.4) {
      resolvedCat = {
        category: suggestions[0].category,
        subcategory: suggestions[0].subcategory,
        matchedPreset: true,
        score: suggestions[0].confidence,
      };
      source = "title_suggestion";
    }
  }

  if (!resolvedCat?.category) return null;

  // Always finish with a valid preset subcategory when the top-level category is known.
  const preset = STORE_CATEGORIES.find((c) => c.label === resolvedCat.category);
  if (preset && !resolvedCat.subcategory) {
    const enhanced = await resolveInwCategoryWithSubcategory(
      remoteLabel ?? resolvedCat.category,
      remoteSubLabel,
      { provider, title }
    );
    if (enhanced?.subcategory) {
      resolvedCat = {
        ...resolvedCat,
        category: enhanced.category,
        subcategory: enhanced.subcategory,
        matchedPreset: true,
        score: enhanced.score ?? resolvedCat.score,
      };
      source = "enhanced";
    } else {
      const otherSub = preset.subcategories.find((s) => s.toLowerCase().startsWith("other "));
      if (otherSub) {
        resolvedCat = { ...resolvedCat, subcategory: otherSub, matchedPreset: true };
        source = "enhanced";
      }
    }
  }

  const canonicalSub = canonicalizeSubcategory(resolvedCat.category, resolvedCat.subcategory);
  if (canonicalSub) {
    resolvedCat = { ...resolvedCat, subcategory: canonicalSub, matchedPreset: true };
  }

  return {
    category: resolvedCat.category,
    subcategory: resolvedCat.subcategory,
    matchedPreset: resolvedCat.matchedPreset,
    score: resolvedCat.score,
    source,
  };
}

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
    include: { storeItem: { select: { memberId: true, category: true } } },
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
    return {
      ok: true,
      storeItemId: existing.storeItemId,
      externalListingId: productId,
      needsCategoryReview: !existing.storeItem.category,
    };
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

  if (!listing.title?.trim()) {
    return { ok: false, externalListingId: productId, reason: "invalid_title" };
  }

  const safePriceCents = Math.max(0, Math.round(Number(listing.priceCents) || 0));
  if (safePriceCents < 1) {
    return { ok: false, externalListingId: productId, reason: "invalid_price" };
  }
  const safePhotos = Array.isArray(listing.photos)
    ? listing.photos.filter((p): p is string => typeof p === "string" && p.length > 0)
    : [];

  let createdStoreItemId: string | null = null;
  try {
    // Check member's sync preferences for shipping sync toggle
    const syncPrefs = await prisma.memberSyncPreferences.findUnique({
      where: { memberId },
      select: { syncShipping: true },
    });
    const shouldSyncShipping = syncPrefs?.syncShipping ?? true;
    
    const remoteCategoryLabel = listing.category?.trim() || null;
    const remoteCategorySubLabel = listing.subcategory?.trim() || null;

    const categoryAssignment = await resolveImportCategory({
      provider,
      remoteLabel: remoteCategoryLabel,
      remoteSubLabel: remoteCategorySubLabel,
      title: listing.title,
      description: listing.description,
      remoteCategoryId: listing.remoteCategoryId,
    });
    const resolvedCat: ResolvedInwCategory | null = categoryAssignment
      ? {
          category: categoryAssignment.category,
          subcategory: categoryAssignment.subcategory,
          matchedPreset: categoryAssignment.matchedPreset,
          score: categoryAssignment.score,
        }
      : null;

    if (categoryAssignment) {
      console.log("[channels] import category assignment", {
        provider,
        externalListingId: productId,
        remoteCategory: remoteCategoryLabel,
        remoteSubcategory: remoteCategorySubLabel,
        assignment: categoryAssignment,
      });
    } else if (listing.title) {
      console.log("[channels] import no category resolved", {
        provider,
        externalListingId: productId,
        title: listing.title.slice(0, 50),
      });
    }

    if (resolvedCat && !resolvedCat.matchedPreset) {
      console.log("[channels] import using custom category (no preset match)", {
        provider,
        externalListingId: productId,
        remoteCategory: listing.category,
        remoteSubcategory: listing.subcategory,
        resolvedCategory: resolvedCat.category,
        resolvedSubcategory: resolvedCat.subcategory,
      });
    }
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
          ? 0
          : Math.max(0, Math.round(Number(listing.quantity) || 0));
    // Only import shipping cost if syncShipping is enabled
    const shippingCents =
      shouldSyncShipping && listing.shippingKnown !== false && listing.shippingCostCents != null
        ? Math.max(0, Math.round(listing.shippingCostCents))
        : null;

    const storeItem = await prisma.storeItem.create({
      data: {
        memberId,
        title: listing.title.slice(0, 200),
        sku: listing.sku?.slice(0, 50) ?? null,
        description: storeListingDescription(listing.description),
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
    const remoteSplit =
      provider === "ebay" && remoteCategoryLabel
        ? splitEbayCategoryPath(remoteCategoryLabel)
        : { label: remoteCategoryLabel ?? "", subcategory: remoteCategorySubLabel };

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
          remoteCategoryLabel: remoteCategoryLabel?.slice(0, 500) ?? null,
          remoteCategorySubLabel:
            (remoteSplit.subcategory ?? remoteCategorySubLabel)?.slice(0, 200) ?? null,
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
    if (remoteCategoryLabel && resolvedCat?.category) {
      void seedCategoryMappingFromImport({
        provider,
        remoteCategory: remoteCategoryLabel,
        remoteSubcategory: remoteSplit.subcategory ?? remoteCategorySubLabel,
        mappedCategory: resolvedCat.category,
        mappedSubcategory: resolvedCat.subcategory,
        confidence: resolvedCat.score,
      });
    }
    
    // Track if item needs category review (no category was assigned)
    const needsCategoryReview = !resolvedCat?.category;
    
    return {
      ok: true,
      storeItemId: storeItem.id,
      externalListingId: productId,
      needsCategoryReview,
    };
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
