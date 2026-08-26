export function normalizeStorefrontSearch(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export function hasExactTitleMatch(items: Array<{ title: string }>, query: string): boolean {
  const needle = normalizeStorefrontSearch(query);
  if (!needle) return false;
  return items.some((item) => item.title.toLowerCase().includes(needle.toLowerCase()));
}

export function storefrontCloseMatchNote(
  query: string,
  items: Array<{ title: string }>
): string | null {
  const needle = normalizeStorefrontSearch(query);
  if (!needle || items.length === 0) return null;
  if (hasExactTitleMatch(items, needle)) return null;
  return `No exact matches for "${needle}", these might be close!`;
}
