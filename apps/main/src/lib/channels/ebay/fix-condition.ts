import { prisma } from "database";
import { getMemberConnectionContext } from "../connection";
import { updateStoreItemOnChannels } from "../outbound";
import type { ChannelSyncResult, SyncStoreItem } from "../types";
import {
  fetchEbayCategoryConditions,
  inwConditionFromEbayEnum,
  presentEbayConditionChoices,
  resolveEbaySyncCondition,
  type EbayConditionPresentation,
} from "./conditions";
import { describeEbayThrownError } from "./errors";
import { resolveEbayLegacyListingId } from "./mapping";
import { fetchEbayItemDetails } from "./trading";

export type EbayConditionFixContext = {
  storeItem: {
    id: string;
    title: string;
    photos: string[];
    condition: string;
    ebayCategoryId: number | null;
    ebayConditionEnum: string | null;
  };
  categoryId: string | null;
  presentation: EbayConditionPresentation;
};

/** Load listing + allowed eBay conditions for the in-app condition picker. */
export async function getEbayConditionFixContext(
  memberId: string,
  storeItemId: string
): Promise<EbayConditionFixContext | null> {
  const item = await prisma.storeItem.findFirst({
    where: { id: storeItemId, memberId },
    select: {
      id: true,
      title: true,
      photos: true,
      condition: true,
      ebayCategoryId: true,
      ebayConditionEnum: true,
    },
  });
  if (!item) return null;

  const conn = await getMemberConnectionContext(memberId, "ebay");
  if (!conn) return null;

  const categoryId = item.ebayCategoryId != null ? String(item.ebayCategoryId) : null;
  let presentation: EbayConditionPresentation;
  try {
    const choices = categoryId ? await fetchEbayCategoryConditions(conn.accessToken, categoryId) : [];
    presentation = presentEbayConditionChoices(choices);
  } catch (e) {
    console.warn("[ebay] getEbayConditionFixContext metadata failed", {
      storeItemId,
      categoryId,
      error: describeEbayThrownError(e),
    });
    presentation = presentEbayConditionChoices([]);
  }

  return {
    storeItem: item,
    categoryId,
    presentation,
  };
}

/** Save seller's condition choice and retry eBay sync from INW. */
export async function applyEbayConditionFix(args: {
  memberId: string;
  storeItemId: string;
  ebayConditionEnum: string;
}): Promise<{ ok: boolean; channelSync: ChannelSyncResult[]; error?: string }> {
  const enumVal = args.ebayConditionEnum.trim().toUpperCase();
  if (!enumVal) {
    return { ok: false, channelSync: [], error: "Condition is required." };
  }

  const item = await prisma.storeItem.findFirst({
    where: { id: args.storeItemId, memberId: args.memberId },
    select: { id: true },
  });
  if (!item) {
    return { ok: false, channelSync: [], error: "Listing not found." };
  }

  const inwCondition = inwConditionFromEbayEnum(enumVal);

  await prisma.storeItem.update({
    where: { id: args.storeItemId },
    data: {
      ebayConditionEnum: enumVal,
      condition: inwCondition,
    },
  });

  await prisma.channelListingLink.updateMany({
    where: { storeItemId: args.storeItemId, provider: "ebay", syncStatus: "error" },
    data: { syncStatus: "pending", syncError: null },
  });

  const channelSync = await updateStoreItemOnChannels(args.storeItemId, { skipProviders: ["etsy", "wix", "shopify"] });
  const ebayResult = channelSync.find((r) => r.provider === "ebay");
  if (ebayResult && !ebayResult.ok) {
    return { ok: false, channelSync, error: ebayResult.error ?? "eBay sync failed after updating condition." };
  }

  return { ok: true, channelSync };
}

/** Persist seller/category-resolved eBay condition on the StoreItem. */
export async function persistEbayConditionEnum(
  storeItemId: string,
  ebayConditionEnum: string
): Promise<void> {
  const enumVal = ebayConditionEnum.trim().toUpperCase();
  await prisma.storeItem.update({
    where: { id: storeItemId },
    data: {
      ebayConditionEnum: enumVal,
      condition: inwConditionFromEbayEnum(enumVal),
    },
  });
}

/**
 * For imported listings missing ebayConditionEnum, read ConditionID from the live eBay listing.
 */
export async function enrichSyncItemConditionFromEbay(
  accessToken: string,
  externalListingId: string | undefined,
  item: SyncStoreItem
): Promise<SyncStoreItem> {
  if (item.ebayConditionEnum?.trim()) return item;

  const legacyId =
    resolveEbayLegacyListingId(externalListingId ?? "") ??
    resolveEbayLegacyListingId(item.sku ?? "");
  if (!legacyId) return item;

  try {
    const details = await fetchEbayItemDetails(accessToken, legacyId);
    if (!details.conditionEnum) return item;
    return {
      ...item,
      ebayConditionEnum: details.conditionEnum,
      condition: details.condition ?? item.condition,
    };
  } catch (e) {
    console.warn("[ebay] enrichSyncItemConditionFromEbay failed", {
      storeItemId: item.id,
      legacyId,
      error: describeEbayThrownError(e),
    });
    return item;
  }
}

/** Resolve + persist a category-valid Inventory condition enum before push. */
export async function prepareEbaySyncCondition(args: {
  accessToken: string;
  storeItemId: string;
  item: SyncStoreItem;
  categoryId: string | null;
}): Promise<{ item: SyncStoreItem; conditionEnum: string; autoCorrected: boolean; persisted: boolean }> {
  const { conditionEnum, autoCorrected } = await resolveEbaySyncCondition(
    args.accessToken,
    args.item,
    args.categoryId
  );
  const nextItem: SyncStoreItem =
    conditionEnum !== args.item.ebayConditionEnum?.trim().toUpperCase()
      ? { ...args.item, ebayConditionEnum: conditionEnum }
      : args.item;

  const shouldPersist =
    autoCorrected ||
    (nextItem.ebayConditionEnum &&
      nextItem.ebayConditionEnum !== args.item.ebayConditionEnum?.trim().toUpperCase());

  if (shouldPersist) {
    await persistEbayConditionEnum(args.storeItemId, conditionEnum);
  }

  return { item: nextItem, conditionEnum, autoCorrected, persisted: !!shouldPersist };
}
