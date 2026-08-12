/**
 * eBay US marketplace category reference (top-level + known leaf paths with IDs).
 * Sources: https://www.ebay.com/n/all-categories and outbound INW→eBay mappings.
 */

import {
  listEbayCategoryReferenceEntriesFromSuggest,
  type EbayCategoryReferenceEntry,
} from "./category-suggest";

export type { EbayCategoryReferenceEntry };

/**
 * eBay US top-level categories from https://www.ebay.com/n/all-categories
 * (category IDs are stable eBay US marketplace identifiers).
 */
export const EBAY_US_TOP_LEVEL_CATEGORIES: EbayCategoryReferenceEntry[] = [
  { id: "20081", path: "Antiques" },
  { id: "550", path: "Art" },
  { id: "2984", path: "Baby" },
  { id: "267", path: "Books" },
  { id: "12576", path: "Business & Industrial" },
  { id: "625", path: "Cameras & Photo" },
  { id: "15032", path: "Cell Phones & Accessories" },
  { id: "11450", path: "Clothing, Shoes & Accessories" },
  { id: "11116", path: "Coins & Paper Money" },
  { id: "1", path: "Collectibles" },
  { id: "58058", path: "Computers/Tablets & Networking" },
  { id: "293", path: "Consumer Electronics" },
  { id: "14339", path: "Crafts" },
  { id: "237", path: "Dolls & Bears" },
  { id: "45100", path: "Entertainment Memorabilia" },
  { id: "99", path: "Everything Else" },
  { id: "172008", path: "Gift Cards & Coupons" },
  { id: "26395", path: "Health & Beauty" },
  { id: "11700", path: "Home & Garden" },
  { id: "281", path: "Jewelry & Watches" },
  { id: "11232", path: "Movies & TV" },
  { id: "11233", path: "Music" },
  { id: "619", path: "Musical Instruments & Gear" },
  { id: "1281", path: "Pet Supplies" },
  { id: "870", path: "Pottery & Glass" },
  { id: "316", path: "Specialty Services" },
  { id: "888", path: "Sporting Goods" },
  { id: "64482", path: "Sports Mem, Cards & Fan Shop" },
  { id: "260", path: "Stamps" },
  { id: "1305", path: "Tickets & Experiences" },
  { id: "220", path: "Toys & Hobbies" },
  { id: "3252", path: "Travel" },
  { id: "1249", path: "Video Games & Consoles" },
  { id: "6000", path: "eBay Motors" },
];

/** All bundled eBay reference rows (top-level + outbound paths), deduped by id. */
export function listEbayCategoryReferenceEntries(): EbayCategoryReferenceEntry[] {
  const byId = new Map<string, EbayCategoryReferenceEntry>();
  for (const row of [...EBAY_US_TOP_LEVEL_CATEGORIES, ...listEbayCategoryReferenceEntriesFromSuggest()]) {
    if (!byId.has(row.id)) byId.set(row.id, row);
  }
  return Array.from(byId.values());
}
