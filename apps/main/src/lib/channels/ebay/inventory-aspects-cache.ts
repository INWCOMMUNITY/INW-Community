/**
 * Fetch and cache live eBay inventory_item product.aspects on a channel link.
 */

import { prisma, Prisma } from "database";
import { ebayGetInventoryItem } from "./client";
import { extractEbayInventoryAspects } from "./listing-origin";

export async function fetchEbayInventoryAspectsForSku(
  accessToken: string,
  sku: string
): Promise<Record<string, string[]> | null> {
  try {
    const item = await ebayGetInventoryItem(accessToken, sku);
    return extractEbayInventoryAspects(item as Record<string, unknown>);
  } catch {
    return null;
  }
}

export async function cacheEbayInventoryAspectsOnLink(
  linkId: string,
  aspects: Record<string, string[]> | null
): Promise<void> {
  await prisma.channelListingLink.update({
    where: { id: linkId },
    data: {
      ebayInventoryAspects:
        aspects && Object.keys(aspects).length > 0
          ? (aspects as Prisma.InputJsonValue)
          : Prisma.JsonNull,
    },
  });
}

export async function fetchAndCacheEbayInventoryAspects(
  accessToken: string,
  linkId: string,
  sku: string
): Promise<Record<string, string[]> | null> {
  const aspects = await fetchEbayInventoryAspectsForSku(accessToken, sku);
  if (aspects) {
    await cacheEbayInventoryAspectsOnLink(linkId, aspects);
  }
  return aspects;
}
