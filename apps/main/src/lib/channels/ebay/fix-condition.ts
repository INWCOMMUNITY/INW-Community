import { prisma } from "database";
import { getMemberConnectionContext } from "../connection";
import { updateStoreItemOnChannels } from "../outbound";
import type { ChannelSyncResult } from "../types";
import {
  fetchEbayCategoryConditions,
  inwConditionFromEbayEnum,
  presentEbayConditionChoices,
  type EbayConditionPresentation,
} from "./conditions";
import { describeEbayThrownError } from "./errors";

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
