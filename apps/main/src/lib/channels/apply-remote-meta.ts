import { prisma } from "database";
import { resolveInwCategoryFromRemote } from "./category-resolver";
import {
  normalizeVariantsFromProvider,
  sumVariantQuantities,
  type InwVariantAxis,
} from "./variant-sync";
import { sumOptionQuantities } from "@/lib/store-item-variants";
import { clampSaneInventoryQty } from "./inventory-sanity";
import { normalizeListingAspects } from "@/lib/listing-limits";
import type { ChannelProvider, RemoteListingSummary } from "./types";

/** Apply category + subcategory from a remote listing using fuzzy preset matching. */
export async function applyRemoteCategoryToStoreItem(
  storeItemId: string,
  remote: RemoteListingSummary,
  provider: ChannelProvider
): Promise<boolean> {
  const remoteLabel = remote.category?.trim();
  if (!remoteLabel) return false;

  const resolved = resolveInwCategoryFromRemote(remoteLabel, remote.subcategory);
  if (!resolved) return false;

  const item = await prisma.storeItem.findUnique({
    where: { id: storeItemId },
    select: { category: true, subcategory: true, etsyTaxonomyId: true, ebayCategoryId: true },
  });
  if (!item) return false;

  const nextCategory = resolved.category;
  const nextSub = resolved.subcategory;
  const categorySame = (item.category ?? "") === nextCategory;
  const subSame = (item.subcategory ?? "") === (nextSub ?? "");
  if (categorySame && subSame) return false;

  const data: Record<string, unknown> = {
    category: nextCategory,
    subcategory: nextSub,
  };
  if (provider === "etsy" && remote.remoteCategoryId) {
    const tid = Number(remote.remoteCategoryId);
    if (Number.isInteger(tid) && tid > 0) data.etsyTaxonomyId = tid;
  }
  if (provider === "ebay" && remote.remoteCategoryId) {
    const cid = Number(remote.remoteCategoryId);
    if (Number.isInteger(cid) && cid > 0) data.ebayCategoryId = cid;
  }

  await prisma.storeItem.update({ where: { id: storeItemId }, data });
  return true;
}

/** Apply flat shipping cost from remote when known. */
export async function applyRemoteShippingToStoreItem(
  storeItemId: string,
  remote: RemoteListingSummary
): Promise<boolean> {
  if (remote.shippingKnown === false) return false;
  if (remote.shippingCostCents == null || !Number.isFinite(remote.shippingCostCents)) return false;

  const item = await prisma.storeItem.findUnique({
    where: { id: storeItemId },
    select: { shippingCostCents: true },
  });
  if (!item) return false;
  const next = Math.max(0, Math.round(remote.shippingCostCents));
  if (item.shippingCostCents === next) return false;

  await prisma.storeItem.update({
    where: { id: storeItemId },
    data: { shippingCostCents: next },
  });
  return true;
}

/**
 * Write normalized INW variant axes (per-option quantities) to a StoreItem and recompute the
 * aggregate quantity. Shared by the meta reconcile and the Wix inventory webhook fast path.
 */
export async function applyRemoteVariantAxesToStoreItem(
  storeItemId: string,
  axes: InwVariantAxis[] | null
): Promise<boolean> {
  if (!axes || axes.length === 0) return false;

  const item = await prisma.storeItem.findUnique({
    where: { id: storeItemId },
    select: { variants: true, quantity: true, status: true },
  });
  if (!item) return false;

  const rawQty = sumVariantQuantities(axes) || sumOptionQuantities(axes);
  const nextQty = clampSaneInventoryQty(rawQty);
  if (nextQty == null) {
    console.warn("[channels] rejected absurd inbound variant quantity", { storeItemId, rawQty });
    return false;
  }
  const variantsJson = axes as unknown;
  const sameVariants = JSON.stringify(item.variants) === JSON.stringify(variantsJson);
  if (sameVariants && item.quantity === nextQty) return false;

  // Keep status in sync with stock: restock reactivates a sold-out listing; zero stock sells it out.
  const nextStatus =
    nextQty > 0
      ? item.status === "sold_out"
        ? "active"
        : item.status
      : "sold_out";

  await prisma.storeItem.update({
    where: { id: storeItemId },
    data: { variants: variantsJson as object, quantity: nextQty, status: nextStatus },
  });
  return true;
}

/** Pull remote product options into INW variants JSON (per-option quantities). */
export async function applyRemoteVariantsToStoreItem(
  storeItemId: string,
  remote: RemoteListingSummary,
  provider: ChannelProvider
): Promise<boolean> {
  if (remote.variantsKnown === false || !remote.variants) return false;
  const normalized = normalizeVariantsFromProvider(provider, remote.variants);
  return applyRemoteVariantAxesToStoreItem(storeItemId, normalized);
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
