import { prisma } from "database";
import { resolveEbayInventorySku } from "./ebay/listing-origin";
import { resolveEbayLegacyListingId } from "./ebay/mapping";
import type { ChannelProvider, RemoteSale } from "./types";

export type SaleLinkLookup = Pick<RemoteSale, "externalListingId" | "sku" | "legacyItemId">;

/**
 * IDs that may appear on ChannelListingLink.externalListingId or StoreItem.id
 * for the same eBay (or other) sale line.
 */
export function saleLinkCandidateIds(sale: SaleLinkLookup): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const add = (raw?: string | null) => {
    const trimmed = raw?.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push(trimmed);

    const legacy = resolveEbayLegacyListingId(trimmed);
    if (legacy && !seen.has(legacy)) {
      seen.add(legacy);
      out.push(legacy);
    }

    const inventorySku = resolveEbayInventorySku(trimmed);
    if (inventorySku && !seen.has(inventorySku)) {
      seen.add(inventorySku);
      out.push(inventorySku);
    }
  };

  add(sale.externalListingId);
  add(sale.sku);
  add(sale.legacyItemId);
  return out;
}

export function ebayFulfillmentLineToSale(
  orderId: string | undefined,
  li: {
    lineItemId?: string;
    sku?: string;
    legacyItemId?: string;
    quantity?: number;
  }
): RemoteSale | null {
  const sku = li.sku?.trim() || null;
  const legacyItemId = li.legacyItemId?.trim() || null;
  if (!sku && !legacyItemId) return null;
  return {
    externalEventId: `order:${orderId}:line:${li.lineItemId}`,
    externalListingId: sku || legacyItemId!,
    quantitySold: Math.max(1, li.quantity ?? 1),
    sku,
    legacyItemId,
  };
}

export async function findChannelLinkForSale(
  provider: ChannelProvider,
  sale: SaleLinkLookup
) {
  const ids = saleLinkCandidateIds(sale);
  if (ids.length === 0) return null;
  return prisma.channelListingLink.findFirst({
    where: {
      provider,
      OR: [{ externalListingId: { in: ids } }, { storeItemId: { in: ids } }],
    },
  });
}
