import {
  EBAY_API_BASE,
  EBAY_TRADING_COMPAT_LEVEL,
  EBAY_TRADING_SITE_ID,
} from "./config";
import { ebayJson } from "./client";

/** A classic (Trading API) eBay listing enumerated for import preview. */
export type EbayTradingListing = {
  listingId: string;
  title: string;
  priceCents: number;
  quantity: number;
  photos: string[];
};

const TRADING_ENDPOINT = `${EBAY_API_BASE}/ws/api.dll`;

function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1].trim() : null;
}

function allTags(block: string, name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) out.push(m[1].trim());
  return out;
}

function buildGetMyeBaySellingXml(pageNumber: number): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ActiveList>
    <Include>true</Include>
    <Pagination>
      <EntriesPerPage>100</EntriesPerPage>
      <PageNumber>${pageNumber}</PageNumber>
    </Pagination>
  </ActiveList>
</GetMyeBaySellingRequest>`;
}

async function callTrading(accessToken: string, callName: string, xml: string): Promise<string> {
  const res = await fetch(TRADING_ENDPOINT, {
    method: "POST",
    headers: {
      "X-EBAY-API-CALL-NAME": callName,
      "X-EBAY-API-SITEID": EBAY_TRADING_SITE_ID,
      "X-EBAY-API-COMPATIBILITY-LEVEL": EBAY_TRADING_COMPAT_LEVEL,
      "X-EBAY-API-IAF-TOKEN": accessToken,
      "Content-Type": "text/xml",
    },
    body: xml,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`eBay Trading ${callName} failed (${res.status}).`);
  }
  return text;
}

/** Enumerate the seller's active classic listings via Trading API GetMyeBaySelling. */
export async function enumerateEbayListings(accessToken: string): Promise<EbayTradingListing[]> {
  const out: EbayTradingListing[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const xml = await callTrading(accessToken, "GetMyeBaySelling", buildGetMyeBaySellingXml(page));
    const activeList = tag(xml, "ActiveList") ?? "";
    const itemArray = tag(activeList, "ItemArray") ?? "";
    const items = allTags(itemArray, "Item");
    if (items.length === 0) break;
    for (const item of items) {
      const listingId = tag(item, "ItemID");
      if (!listingId) continue;
      const title = tag(item, "Title") ?? "eBay listing";
      const sellingStatus = tag(item, "SellingStatus") ?? "";
      const priceStr = tag(sellingStatus, "CurrentPrice") ?? tag(item, "CurrentPrice") ?? "0";
      const priceCents = Math.round((Number(priceStr) || 0) * 100);
      const qtyStr = tag(item, "QuantityAvailable") ?? tag(item, "Quantity") ?? "0";
      const quantity = Math.max(0, Number(qtyStr) || 0);
      const pics = tag(item, "PictureDetails") ?? "";
      const photos = allTags(pics, "PictureURL").map((u) =>
        u.replace(/&amp;/g, "&").trim()
      );
      out.push({ listingId, title, priceCents, quantity, photos });
    }
    // Stop early if this page was not full (no further pages).
    if (items.length < 100) break;
  }
  return out;
}

type MigrateResponse = {
  responses?: {
    listingId?: string;
    statusCode?: number;
    inventoryItems?: { sku?: string }[];
    offers?: { offerId?: string }[];
    errors?: { message?: string; longMessage?: string }[];
  }[];
};

export type MigrationResult = { sku?: string; offerId?: string; error?: string };

/**
 * Bring classic listings under the Inventory model so unified inventory updates work.
 * Returns a map listingId -> { sku, offerId } (or an error reason).
 */
export async function migrateEbayListings(
  accessToken: string,
  listingIds: string[]
): Promise<Map<string, MigrationResult>> {
  const result = new Map<string, MigrationResult>();
  // bulk_migrate_listing accepts up to 5 listings per call.
  for (let i = 0; i < listingIds.length; i += 5) {
    const batch = listingIds.slice(i, i + 5);
    let res: MigrateResponse;
    try {
      res = await ebayJson<MigrateResponse>(
        accessToken,
        "/sell/inventory/v1/bulk_migrate_listing",
        "POST",
        { requests: batch.map((listingId) => ({ listingId })) }
      );
    } catch (e) {
      for (const id of batch) result.set(id, { error: String(e).slice(0, 200) });
      continue;
    }
    for (const r of res.responses ?? []) {
      if (!r.listingId) continue;
      const ok = r.statusCode != null && r.statusCode >= 200 && r.statusCode < 300;
      if (!ok) {
        const err = r.errors?.[0]?.longMessage || r.errors?.[0]?.message || "migration_failed";
        result.set(r.listingId, { error: err });
        continue;
      }
      result.set(r.listingId, {
        sku: r.inventoryItems?.[0]?.sku,
        offerId: r.offers?.[0]?.offerId,
      });
    }
    for (const id of batch) if (!result.has(id)) result.set(id, { error: "no_response" });
  }
  return result;
}
