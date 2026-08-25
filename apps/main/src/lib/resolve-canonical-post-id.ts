import { prisma } from "database";

const MAX_DEPTH = 10;

/** Walk shared_post sourcePostId chain to the original post id. */
export async function resolveCanonicalPostId(postId: string): Promise<string> {
  const map = await resolveCanonicalPostIds([postId]);
  return map[postId] ?? postId;
}

/** Batch-resolve canonical ids: load rows in waves, walk chains in memory. */
export async function resolveCanonicalPostIds(postIds: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(postIds.filter(Boolean))];
  if (unique.length === 0) return {};

  const byId = new Map<string, { id: string; type: string; sourcePostId: string | null }>();
  let missing = [...unique];

  for (let wave = 0; wave < MAX_DEPTH && missing.length > 0; wave++) {
    const rows = await prisma.post.findMany({
      where: { id: { in: missing } },
      select: { id: true, type: true, sourcePostId: true },
    });
    const nextMissing: string[] = [];
    for (const row of rows) {
      byId.set(row.id, row);
      if (row.type === "shared_post" && row.sourcePostId && !byId.has(row.sourcePostId)) {
        nextMissing.push(row.sourcePostId);
      }
    }
    missing = [...new Set(nextMissing)];
  }

  const result: Record<string, string> = {};
  for (const id of unique) {
    let currentId = id;
    for (let i = 0; i < MAX_DEPTH; i++) {
      const row = byId.get(currentId);
      if (!row) {
        result[id] = currentId;
        break;
      }
      if (row.type === "shared_post" && row.sourcePostId) {
        currentId = row.sourcePostId;
        continue;
      }
      result[id] = row.id;
      break;
    }
    if (result[id] == null) result[id] = currentId;
  }
  return result;
}
