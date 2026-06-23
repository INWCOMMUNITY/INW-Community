import { prisma } from "database";

const MAX_DEPTH = 10;

/** Walk shared_post sourcePostId chain to the original post id. */
export async function resolveCanonicalPostId(postId: string): Promise<string> {
  let currentId = postId;
  for (let i = 0; i < MAX_DEPTH; i++) {
    const row = await prisma.post.findUnique({
      where: { id: currentId },
      select: { id: true, type: true, sourcePostId: true },
    });
    if (!row) return currentId;
    if (row.type === "shared_post" && row.sourcePostId) {
      currentId = row.sourcePostId;
      continue;
    }
    return row.id;
  }
  return currentId;
}

/** Batch-resolve canonical ids for many posts. */
export async function resolveCanonicalPostIds(postIds: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(postIds.filter(Boolean))];
  if (unique.length === 0) return {};

  const entries = await Promise.all(
    unique.map(async (id) => [id, await resolveCanonicalPostId(id)] as const)
  );
  return Object.fromEntries(entries);
}
