/**
 * Syncio method 2: copy the join-key string. Never unsync/delete listings to "fix" SKUs.
 */

import { prisma } from "database";
import { isGeneratedVariantOfItemId } from "@/lib/listing-sku";
import { findConflictingMemberSku } from "@/lib/listing-sku-db";
import {
  normalizeVariantMatrix,
  skuSelectionKey,
  stampSkuCodes,
} from "@/lib/listing-variant-matrix";
import {
  adoptPinnedEbaySku,
  isJoinKeySku,
  resolvePublishSku,
  SkuIdentityError,
} from "./sku-identity";
import { getMemberConnectionContextWithError } from "./connection";
import { hydrateLinkSkus } from "./sku-audit-live";
import { syncStoreItemSelect, toSyncStoreItem } from "./store-item";
import { matchInwSkuRow, matchRemoteRow } from "./variant-match";
import { isChannelProvider, type ChannelProvider } from "./types";
import { etsyGet, etsyJson, setEtsyConnectionContext } from "./etsy/client";
import { etsyInventoryPutBody, etsyInventoryWritePath, etsyProductOptionMap } from "./etsy/variants";
import { fetchWixV1Product, wixVariantChoiceMap } from "./wix/collections";
import { setWixConnectionContext, wixJson } from "./wix/client";
import { wixInventoryRequestOpts } from "./wix/site";

export type { SuggestedRepair } from "./sku-repair-suggest";
export { suggestedSkuRepairs } from "./sku-repair-suggest";

export type SkuRepairKind = "adopt_pin" | "clear_leftover_parent" | "assign_canonical" | "rewrite_remote";

export type SkuRepairRequest = {
  storeItemId: string;
  kind: SkuRepairKind;
  sku?: string;
  comboKey?: string | null;
  provider?: ChannelProvider;
};

export type SkuRepairResult = { ok: true; message: string } | { ok: false; error: string };

async function loadOwnedItem(memberId: string, storeItemId: string) {
  return prisma.storeItem.findFirst({
    where: { id: storeItemId, memberId },
    select: syncStoreItemSelect,
  });
}

async function adoptPin(memberId: string, storeItemId: string): Promise<SkuRepairResult> {
  const item = await loadOwnedItem(memberId, storeItemId);
  if (!item) return { ok: false, error: "Listing not found." };
  const link = await prisma.channelListingLink.findFirst({
    where: { storeItemId, provider: "ebay" },
    select: { externalListingId: true, linkOrigin: true },
  });
  if (!link) return { ok: false, error: "No eBay listing is linked." };
  const { ctx, error } = await getMemberConnectionContextWithError(memberId, "ebay");
  if (!ctx) return { ok: false, error: error ?? "eBay is not connected." };
  const hydrated = await hydrateLinkSkus({
    ctx,
    provider: "ebay",
    externalListingId: link.externalListingId,
    item: toSyncStoreItem(item),
    linkOrigin: link.linkOrigin,
  });
  if (hydrated.error) return { ok: false, error: hydrated.error };
  const matrix = normalizeVariantMatrix(item.variants);
  if (matrix && matrix.skus.length > 0) {
    const updates: { options: Record<string, string>; sku: string }[] = [];
    for (const row of matrix.skus) {
      const hit = matchRemoteRow(hydrated.rows, row, {
        allowPositional: matrix.skus.length === 1 && hydrated.rows.length === 1,
      });
      const pin = adoptPinnedEbaySku({
        localSku: row.sku,
        remoteSku: hit.row?.sku ?? null,
        itemId: item.id,
      });
      if (!pin) continue;
      const conflict = await findConflictingMemberSku({
        memberId,
        sku: pin,
        excludeItemId: item.id,
      });
      if (conflict) {
        return { ok: false, error: `SKU ${pin} is already used on another listing.` };
      }
      updates.push({ options: row.options, sku: pin });
    }
    if (updates.length === 0) {
      return { ok: false, error: "No blank INW combo SKUs to adopt from eBay." };
    }
    const next = stampSkuCodes(matrix, updates);
    await prisma.storeItem.update({
      where: { id: item.id },
      data: { variants: next as object },
    });
    return { ok: true, message: `Adopted ${updates.length} eBay SKU(s) onto INW combinations.` };
  }
  const remoteSku =
    hydrated.rows.length === 1
      ? hydrated.rows[0]?.sku ?? null
      : hydrated.rows.find((r) => isJoinKeySku(r.sku))?.sku ?? hydrated.rows[0]?.sku ?? null;
  const pin = adoptPinnedEbaySku({ localSku: item.sku, remoteSku, itemId: item.id });
  if (!pin) return { ok: false, error: "INW already has a SKU, or eBay has no pin-able Custom Label." };
  const conflict = await findConflictingMemberSku({ memberId, sku: pin, excludeItemId: item.id });
  if (conflict) return { ok: false, error: `SKU ${pin} is already used on another listing.` };
  await prisma.storeItem.update({ where: { id: item.id }, data: { sku: pin } });
  return { ok: true, message: `Adopted eBay SKU ${pin} onto INW.` };
}

async function clearLeftoverParent(memberId: string, storeItemId: string): Promise<SkuRepairResult> {
  const item = await loadOwnedItem(memberId, storeItemId);
  if (!item) return { ok: false, error: "Listing not found." };
  const sku = item.sku?.trim() ?? "";
  if (!sku || !isGeneratedVariantOfItemId(sku, item.id)) {
    return { ok: false, error: "Parent SKU is not an item-id leftover." };
  }
  await prisma.storeItem.update({ where: { id: item.id }, data: { sku: null } });
  return { ok: true, message: "Cleared leftover parent SKU on INW. It was not pushed to eBay." };
}

async function assignCanonical(
  memberId: string,
  storeItemId: string,
  rawSku: string | undefined,
  comboKey: string | null | undefined
): Promise<SkuRepairResult> {
  const item = await loadOwnedItem(memberId, storeItemId);
  if (!item) return { ok: false, error: "Listing not found." };
  let sku: string;
  try {
    sku = resolvePublishSku({ sku: rawSku, itemId: item.id });
  } catch (e) {
    return { ok: false, error: e instanceof SkuIdentityError ? e.message : String(e) };
  }
  const conflict = await findConflictingMemberSku({
    memberId,
    sku,
    excludeItemId: item.id,
  });
  if (conflict) return { ok: false, error: "You already have another listing with this SKU." };

  const matrix = normalizeVariantMatrix(item.variants);
  if (comboKey && matrix) {
    const hit = matrix.skus.find((s) => skuSelectionKey(s.options) === comboKey);
    if (!hit) return { ok: false, error: "Combination not found." };
    if (matrix.skus.some((s) => s !== hit && s.sku?.trim().toLowerCase() === sku.toLowerCase())) {
      return { ok: false, error: "Duplicate SKU on another combination." };
    }
    const next = stampSkuCodes(matrix, [{ options: hit.options, sku }]);
    await prisma.storeItem.update({
      where: { id: item.id },
      data: { variants: next as object },
    });
    return { ok: true, message: `Assigned SKU ${sku} to that combination.` };
  }

  await prisma.storeItem.update({ where: { id: item.id }, data: { sku } });
  return { ok: true, message: `Assigned SKU ${sku} on INW.` };
}

async function rewriteEtsy(memberId: string, storeItemId: string): Promise<SkuRepairResult> {
  const item = await loadOwnedItem(memberId, storeItemId);
  if (!item) return { ok: false, error: "Listing not found." };
  const link = await prisma.channelListingLink.findFirst({
    where: { storeItemId, provider: "etsy" },
    select: { externalListingId: true },
  });
  if (!link) return { ok: false, error: "No Etsy listing is linked." };
  const { ctx, error } = await getMemberConnectionContextWithError(memberId, "etsy");
  if (!ctx) return { ok: false, error: error ?? "Etsy is not connected." };
  setEtsyConnectionContext(ctx.id);
  const inv = await etsyGet<{
    products?: {
      sku?: string;
      property_values?: {
        property_id?: number;
        property_name?: string;
        scale_id?: number | null;
        value_ids?: number[];
        values?: string[];
      }[];
      offerings?: Record<string, unknown>[];
    }[];
    price_on_property?: number[];
    quantity_on_property?: number[];
    sku_on_property?: number[];
    readiness_state_on_property?: number[];
  }>(ctx.accessToken, `/listings/${link.externalListingId}/inventory`);
  const products = inv.products ?? [];
  if (products.length === 0) return { ok: false, error: "Etsy inventory is empty." };
  const matrix = normalizeVariantMatrix(item.variants);
  let wrote = 0;
  try {
    const nextProducts = products.map((product) => {
      const options = etsyProductOptionMap(product);
      let sku = product.sku?.trim() || "";
      if (matrix && matrix.skus.length > 0) {
        const { row, quality } = matchInwSkuRow(matrix, { sku: product.sku, options });
        if (row?.sku?.trim() && quality !== "none") {
          sku = resolvePublishSku({
            sku: row.sku,
            itemId: item.id,
            channel: "etsy",
          });
          wrote += 1;
        }
      } else if (item.sku?.trim()) {
        sku = resolvePublishSku({ sku: item.sku, itemId: item.id, channel: "etsy" });
        wrote += 1;
      }
      const property_values = (product.property_values ?? []).map((pv) => ({
        property_id: pv.property_id,
        property_name: pv.property_name || "Option",
        value_ids: pv.value_ids ?? [],
        values: pv.values ?? [],
        ...(pv.scale_id != null ? { scale_id: pv.scale_id } : {}),
      }));
      const offerings = (product.offerings ?? []).map((o) => {
        const copy = { ...o };
        delete (copy as { offering_id?: unknown }).offering_id;
        return copy;
      });
      return { ...(sku ? { sku } : {}), property_values, offerings };
    });
    if (wrote === 0) return { ok: false, error: "No INW SKUs to copy onto Etsy." };
    await etsyJson(
      ctx.accessToken,
      etsyInventoryWritePath(link.externalListingId),
      "PUT",
      etsyInventoryPutBody(inv, nextProducts)
    );
    return { ok: true, message: `Copied ${wrote} SKU(s) onto Etsy without recreating the listing.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function rewriteWix(memberId: string, storeItemId: string): Promise<SkuRepairResult> {
  const item = await loadOwnedItem(memberId, storeItemId);
  if (!item) return { ok: false, error: "Listing not found." };
  const link = await prisma.channelListingLink.findFirst({
    where: { storeItemId, provider: "wix" },
    select: { externalListingId: true },
  });
  if (!link) return { ok: false, error: "No Wix product is linked." };
  const { ctx, error } = await getMemberConnectionContextWithError(memberId, "wix");
  if (!ctx) return { ok: false, error: error ?? "Wix is not connected." };
  setWixConnectionContext(ctx.id);
  const attempts = wixInventoryRequestOpts(ctx);
  const opts = attempts[0];
  if (!opts) return { ok: false, error: "Wix site is not configured." };
  try {
    const product = await fetchWixV1Product(ctx.accessToken, link.externalListingId, opts);
    if (!product?.variants?.length) return { ok: false, error: "Wix product has no variants to PATCH." };
    const matrix = normalizeVariantMatrix(item.variants);
    const variants: { variantIds?: string[]; choices?: Record<string, string>; sku: string }[] = [];
    for (const row of product.variants) {
      if (!row.id) continue;
      const choices = wixVariantChoiceMap(row);
      const remoteSku = row.sku ?? row.variant?.sku ?? null;
      let sku: string | null = null;
      if (matrix && matrix.skus.length > 0) {
        const hit = matchInwSkuRow(matrix, { sku: remoteSku, options: choices });
        sku = hit.row?.sku?.trim() || null;
      } else {
        sku = item.sku?.trim() || null;
      }
      if (!sku) continue;
      sku = resolvePublishSku({ sku, itemId: item.id, channel: "wix" });
      if (Object.keys(choices).length > 0) {
        variants.push({ choices, sku });
      } else {
        variants.push({ variantIds: [row.id], sku });
      }
    }
    if (variants.length === 0) return { ok: false, error: "No INW SKUs to copy onto Wix variants." };
    await wixJson(
      ctx.accessToken,
      `/stores/v1/products/${encodeURIComponent(link.externalListingId)}/variants`,
      "PATCH",
      { variants },
      opts
    );
    return {
      ok: true,
      message: `Copied ${variants.length} SKU(s) onto Wix variants without recreating the product.`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function rewriteRemote(
  memberId: string,
  storeItemId: string,
  provider: ChannelProvider | undefined
): Promise<SkuRepairResult> {
  if (provider === "etsy") return rewriteEtsy(memberId, storeItemId);
  if (provider === "wix") return rewriteWix(memberId, storeItemId);
  if (provider === "shopify") {
    return { ok: false, error: "Shopify SKU rewrite waits until Shopify is connected." };
  }
  if (provider === "ebay") {
    return { ok: false, error: "Do not rename live eBay Inventory SKUs. Adopt the pin onto INW instead." };
  }
  return { ok: false, error: "Choose Etsy or Wix to rewrite the SKU field." };
}

export async function applySkuRepair(memberId: string, req: SkuRepairRequest): Promise<SkuRepairResult> {
  const storeItemId = req.storeItemId?.trim();
  if (!storeItemId) return { ok: false, error: "storeItemId is required." };
  switch (req.kind) {
    case "adopt_pin":
      return adoptPin(memberId, storeItemId);
    case "clear_leftover_parent":
      return clearLeftoverParent(memberId, storeItemId);
    case "assign_canonical":
      return assignCanonical(memberId, storeItemId, req.sku, req.comboKey);
    case "rewrite_remote":
      return rewriteRemote(memberId, storeItemId, req.provider);
    default:
      return { ok: false, error: "Unknown repair action." };
  }
}

export function parseSkuRepairRequest(raw: unknown): SkuRepairRequest | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "Invalid body." };
  const body = raw as Record<string, unknown>;
  const storeItemId = typeof body.storeItemId === "string" ? body.storeItemId.trim() : "";
  if (!storeItemId) return { error: "storeItemId is required." };
  const kind = body.kind;
  if (
    kind !== "adopt_pin" &&
    kind !== "clear_leftover_parent" &&
    kind !== "assign_canonical" &&
    kind !== "rewrite_remote"
  ) {
    return { error: "Unknown repair action." };
  }
  const providerRaw = typeof body.provider === "string" ? body.provider.trim() : "";
  const provider = isChannelProvider(providerRaw) ? providerRaw : undefined;
  return {
    storeItemId,
    kind,
    sku: typeof body.sku === "string" ? body.sku : undefined,
    comboKey: typeof body.comboKey === "string" ? body.comboKey : body.comboKey === null ? null : undefined,
    provider,
  };
}
