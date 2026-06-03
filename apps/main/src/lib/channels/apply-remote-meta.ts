import { prisma } from "database";
import { resolveInwCategoryFromRemote } from "./category-resolver";
import { normalizeVariantsFromProvider, sumVariantQuantities } from "./variant-sync";
import { sumOptionQuantities } from "@/lib/store-item-variants";
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

/** Pull remote product options into INW variants JSON (per-option quantities). */
export async function applyRemoteVariantsToStoreItem(
  storeItemId: string,
  remote: RemoteListingSummary,
  provider: ChannelProvider
): Promise<boolean> {
  if (remote.variantsKnown === false || !remote.variants) return false;

  const normalized = normalizeVariantsFromProvider(provider, remote.variants);
  if (!normalized || normalized.length === 0) return false;

  const item = await prisma.storeItem.findUnique({
    where: { id: storeItemId },
    select: { variants: true, quantity: true },
  });
  if (!item) return false;

  const nextQty = sumVariantQuantities(normalized) || sumOptionQuantities(normalized);
  const variantsJson = normalized as unknown;
  const sameVariants = JSON.stringify(item.variants) === JSON.stringify(variantsJson);
  if (sameVariants && item.quantity === nextQty) return false;

  await prisma.storeItem.update({
    where: { id: storeItemId },
    data: { variants: variantsJson as object, quantity: nextQty },
  });
  return true;
}

/** Apply all remote meta fields (category, shipping, variants). */
export async function applyRemoteMetaToStoreItem(
  storeItemId: string,
  remote: RemoteListingSummary,
  provider: ChannelProvider
): Promise<{ category: boolean; shipping: boolean; variants: boolean }> {
  const [category, shipping, variants] = await Promise.all([
    applyRemoteCategoryToStoreItem(storeItemId, remote, provider),
    applyRemoteShippingToStoreItem(storeItemId, remote),
    applyRemoteVariantsToStoreItem(storeItemId, remote, provider),
  ]);
  return { category, shipping, variants };
}
