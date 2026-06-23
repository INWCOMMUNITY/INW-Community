import { resolveCanonicalPostIds } from "@/lib/resolve-canonical-post-id";
import { countLegacyFeedReshares, countPostShares } from "@/lib/record-content-share";

/** Total share count per post (all channels + legacy feed reshares). */
export async function getShareCountBySourcePostId(
  postIds: string[]
): Promise<Record<string, number>> {
  if (postIds.length === 0) return {};

  const canonicalMap = await resolveCanonicalPostIds(postIds);
  const canonicalIds = [...new Set(Object.values(canonicalMap))];

  const [eventCounts, legacyCounts] = await Promise.all([
    countPostShares(canonicalIds),
    countLegacyFeedReshares(canonicalIds),
  ]);

  const result: Record<string, number> = {};
  for (const id of postIds) {
    const canonical = canonicalMap[id] ?? id;
    result[id] = Math.max(eventCounts[canonical] ?? 0, legacyCounts[canonical] ?? 0);
  }
  return result;
}
