/**
 * Must match apps/main/src/lib/store-categories.ts slugifyStoreCategory().
 * "Jewelry & Watches" → "jewelry-watches"
 */
export function slugifyStoreCategory(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
