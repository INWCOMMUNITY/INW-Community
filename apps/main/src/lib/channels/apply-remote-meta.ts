import { prisma } from "database";
import { resolveImportCategory } from "./import-listing";
import {
  matrixForStorage,
  remoteVariantMatrixIsWeaker,
  sumVariantQuantities,
  type InwVariantAxis,
} from "./variant-sync";
import { sumOptionQuantities } from "@/lib/store-item-variants";
import { clampSaneInventoryQty } from "./inventory-sanity";
import { normalizeListingAspects } from "@/lib/listing-limits";
import type { ChannelProvider, RemoteListingSummary } from "./types";
import {
  isMadeToOrderTracking,
  mergeIncomingVariantMatrixPreservingUnknownPrices,
  minSkuPriceCents,
  serializeVariantMatrix,
} from "@/lib/listing-variant-matrix";

/** Apply category + subcategory from a remote listing using the shared import resolver. */
export async function applyRemoteCategoryToStoreItem(
  storeItemId: string,
  remote: RemoteListingSummary,
  provider: ChannelProvider
): Promise<boolean> {
  const item = await prisma.storeItem.findUnique({
    where: { id: storeItemId },
    select: { title: true, category: true, subcategory: true, etsyTaxonomyId: true, ebayCategoryId: true },
  });
  if (!item) return false;

  const remoteCategoryId =
    remote.remoteCategoryId?.trim() ||
    (provider === "etsy" && item.etsyTaxonomyId != null ? String(item.etsyTaxonomyId) : null) ||
    (provider === "ebay" && item.ebayCategoryId != null ? String(item.ebayCategoryId) : null);

  const assignment = await resolveImportCategory({
    provider,
    remoteLabel: remote.category?.trim() || null,
    remoteSubLabel: remote.subcategory?.trim() || null,
    title: item.title,
    description: remote.description,
    remoteCategoryId,
  });
  if (!assignment?.category) return false;

  const nextCategory = assignment.category;
  const nextSub = assignment.subcategory;
  const categorySame = (item.category ?? "") === nextCategory;
  const subSame = (item.subcategory ?? "") === (nextSub ?? "");

  const data: Record<string, unknown> = {};
  if (!categorySame || !subSame) {
    data.category = nextCategory;
    data.subcategory = nextSub;
  }
  if (provider === "etsy" && remote.remoteCategoryId) {
    const tid = Number(remote.remoteCategoryId);
    if (Number.isInteger(tid) && tid > 0 && item.etsyTaxonomyId !== tid) {
      data.etsyTaxonomyId = tid;
    }
  }
  if (provider === "ebay" && remote.remoteCategoryId) {
    const cid = Number(remote.remoteCategoryId);
    if (Number.isInteger(cid) && cid > 0 && item.ebayCategoryId !== cid) {
      data.ebayCategoryId = cid;
    }
  }

  if (Object.keys(data).length === 0) return false;

  await prisma.storeItem.update({ where: { id: storeItemId }, data });
  return true;
}

/** Apply flat shipping cost from remote when known and syncShipping is enabled. */
export async function applyRemoteShippingToStoreItem(
  storeItemId: string,
  remote: RemoteListingSummary,
  memberId?: string
): Promise<boolean> {
  if (remote.shippingKnown === false) return false;
  if (remote.shippingCostCents == null || !Number.isFinite(remote.shippingCostCents)) return false;

  const item = await prisma.storeItem.findUnique({
    where: { id: storeItemId },
    select: { shippingCostCents: true, memberId: true },
  });
  if (!item) return false;
  
  // Check member's sync preferences for shipping sync toggle
  const effectiveMemberId = memberId ?? item.memberId;
  const syncPrefs = await prisma.memberSyncPreferences.findUnique({
    where: { memberId: effectiveMemberId },
    select: { syncShipping: true },
  });
  if (syncPrefs && !syncPrefs.syncShipping) {
    // Shipping sync is disabled, skip
    return false;
  }
  
  const next = Math.max(0, Math.round(remote.shippingCostCents));
  if (item.shippingCostCents === next) return false;

  await prisma.storeItem.update({
    where: { id: storeItemId },
    data: { shippingCostCents: next },
  });
  return true;
}

/**
 * Write normalized INW variant matrix to a StoreItem and recompute the aggregate quantity.
 * Shared by the meta reconcile and the Wix inventory webhook fast path.
 */
export async function applyRemoteVariantAxesToStoreItem(
  storeItemId: string,
  axes: InwVariantAxis[] | null | unknown
): Promise<boolean> {
  const stored = matrixForStorage(axes, { itemId: storeItemId });
  if (!stored || stored.axes.length === 0) return false;

  const item = await prisma.storeItem.findUnique({
    where: { id: storeItemId },
    select: { variants: true, quantity: true, status: true, inventoryTracking: true, priceCents: true },
  });
  if (!item) return false;

  if (remoteVariantMatrixIsWeaker(item.variants, stored)) {
    console.warn("[channels] skip inbound variants; remote matrix is weaker than INW", {
      storeItemId,
      remoteAxes: stored.axes.map((a) => a.name),
      remoteSkuCount: stored.skus.length,
    });
    return false;
  }

  const merged = mergeIncomingVariantMatrixPreservingUnknownPrices(item.variants, stored);
  const matrix = serializeVariantMatrix(merged);

  const madeToOrder = isMadeToOrderTracking(item.inventoryTracking);
  const rawQty = sumVariantQuantities(matrix) || sumOptionQuantities(matrix);
  const nextQty = madeToOrder ? item.quantity : clampSaneInventoryQty(rawQty);
  if (!madeToOrder && nextQty == null) {
    console.warn("[channels] rejected absurd inbound variant quantity", { storeItemId, rawQty });
    return false;
  }

  const listingPrice = minSkuPriceCents(matrix, item.priceCents);
  const nextListingPrice =
    listingPrice > 0 && listingPrice !== item.priceCents ? listingPrice : null;

  if (madeToOrder && rawQty === 0) {
    // Keep MTO listings from being sold out by a channel placeholder of 0.
    const variantsJson = matrix as unknown;
    const sameVariants = JSON.stringify(item.variants) === JSON.stringify(variantsJson);
    if (sameVariants && nextListingPrice == null) return false;
    await prisma.storeItem.update({
      where: { id: storeItemId },
      data: {
        variants: variantsJson as object,
        ...(nextListingPrice != null ? { priceCents: nextListingPrice } : {}),
      },
    });
    return true;
  }

  const variantsJson = matrix as unknown;
  const sameVariants = JSON.stringify(item.variants) === JSON.stringify(variantsJson);
  if (sameVariants && item.quantity === nextQty && nextListingPrice == null) return false;

  const qty = nextQty ?? item.quantity;
  const nextStatus = madeToOrder
    ? item.status
    : qty > 0
      ? item.status === "sold_out"
        ? "active"
        : item.status
      : "sold_out";

  await prisma.storeItem.update({
    where: { id: storeItemId },
    data: {
      variants: variantsJson as object,
      quantity: qty,
      status: nextStatus,
      ...(nextListingPrice != null ? { priceCents: nextListingPrice } : {}),
    },
  });
  return true;
}

/** Pull remote product options into INW variants JSON (per-combination quantities). */
export async function applyRemoteVariantsToStoreItem(
  storeItemId: string,
  remote: RemoteListingSummary,
  _provider: ChannelProvider
): Promise<boolean> {
  if (remote.variantsKnown === false || !remote.variants) return false;
  return applyRemoteVariantAxesToStoreItem(storeItemId, remote.variants);
}

/** Apply remote item specifics (aspects) to a StoreItem when the channel provided them. */
export async function applyRemoteAspectsToStoreItem(
  storeItemId: string,
  remote: RemoteListingSummary
): Promise<boolean> {
  if (remote.aspectsKnown === false) return false;
  if (!Array.isArray(remote.aspects) || remote.aspects.length === 0) return false;

  const next = normalizeListingAspects(remote.aspects);
  if (next.length === 0) return false;

  const item = await prisma.storeItem.findUnique({
    where: { id: storeItemId },
    select: { aspects: true },
  });
  if (!item) return false;

  const current = normalizeListingAspects(item.aspects);
  if (JSON.stringify(current) === JSON.stringify(next)) return false;

  await prisma.storeItem.update({
    where: { id: storeItemId },
    data: { aspects: next as object },
  });
  return true;
}

/** Apply all remote meta fields (category, shipping, variants, aspects). */
export async function applyRemoteMetaToStoreItem(
  storeItemId: string,
  remote: RemoteListingSummary,
  provider: ChannelProvider
): Promise<{ category: boolean; shipping: boolean; variants: boolean; aspects: boolean }> {
  const [category, shipping, variants, aspects] = await Promise.all([
    applyRemoteCategoryToStoreItem(storeItemId, remote, provider),
    applyRemoteShippingToStoreItem(storeItemId, remote),
    applyRemoteVariantsToStoreItem(storeItemId, remote, provider),
    applyRemoteAspectsToStoreItem(storeItemId, remote),
  ]);
  return { category, shipping, variants, aspects };
}
