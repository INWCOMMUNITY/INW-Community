/** Hydrated shape for tagged / embedded businesses in feed JSON. */
export type FeedBusinessEmbed = {
  id: string;
  name: string;
  slug: string;
  shortDescription: string | null;
  logoUrl: string | null;
};

export function collectTaggedBusinessIdsFromPosts(
  items: { taggedBusinessIds?: string[] | null }[]
): string[] {
  return [...new Set(items.flatMap((p) => p.taggedBusinessIds ?? []))];
}

/** Merge source_* business IDs with tagged-business IDs for one batched lookup. */
export function mergePostBusinessLookupIds(sourceBusinessIds: string[], taggedIds: string[]): string[] {
  return [...new Set([...sourceBusinessIds, ...taggedIds])];
}

export function taggedBusinessesFromIds(
  ids: string[] | null | undefined,
  businessMap: Record<string, FeedBusinessEmbed | undefined>
): FeedBusinessEmbed[] {
  return (ids ?? []).map((id) => businessMap[id]).filter((b): b is FeedBusinessEmbed => b != null);
}
