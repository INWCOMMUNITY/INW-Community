import { ebayGet } from "./client";
import type { EbayTradingListing } from "./trading";

export type EbayInventoryListRow = {
  sku?: string;
  product?: { title?: string; imageUrls?: string[] };
  availability?: { shipToLocationAvailability?: { quantity?: number } };
  packageWeightAndSize?: {
    dimensions?: { height?: number; length?: number; width?: number; unit?: string };
    weight?: { value?: number; unit?: string };
  };
};

type InventoryListResponse = {
  inventoryItems?: EbayInventoryListRow[];
  next?: string;
  total?: number;
};

export async function listInventoryItems(accessToken: string): Promise<EbayInventoryListRow[]> {
  const rows: EbayInventoryListRow[] = [];
  let offset = 0;
  const limit = 100;

  for (let page = 0; page < 20; page += 1) {
    const res = await ebayGet<InventoryListResponse>(
      accessToken,
      `/sell/inventory/v1/inventory_item?limit=${limit}&offset=${offset}`
    );
    rows.push(...(res.inventoryItems ?? []));
    const fetched = res.inventoryItems?.length ?? 0;
    if (fetched < limit) break;
    offset += fetched;
  }

  return rows;
}

export function inventoryRowToTradingListing(row: EbayInventoryListRow): EbayTradingListing | null {
  const sku = row.sku?.trim();
  if (!sku) return null;
  return {
    listingId: sku,
    title: row.product?.title?.trim() || sku,
    priceCents: 0,
    quantity: Math.max(0, row.availability?.shipToLocationAvailability?.quantity ?? 0),
    photos: row.product?.imageUrls ?? [],
    sku,
  };
}

export function mergeInventoryRowsWithTrading(
  tradingRows: EbayTradingListing[],
  inventoryRows: EbayInventoryListRow[]
): EbayTradingListing[] {
  const seenSkus = new Set(
    tradingRows.map((row) => row.sku?.trim()).filter((sku): sku is string => Boolean(sku))
  );
  const merged = [...tradingRows];
  for (const row of inventoryRows) {
    const mapped = inventoryRowToTradingListing(row);
    const sku = mapped?.sku?.trim();
    if (!mapped || !sku || seenSkus.has(sku)) continue;
    seenSkus.add(sku);
    merged.push(mapped);
  }
  return merged;
}
