import { prisma } from "database";

export type SharedPostPreview = {
  id: string;
  contentSnippet: string;
  coverPhotoUrl: string | null;
  authorName: string;
};

function snippet(text: string | null | undefined, max = 120): string {
  const t = (text ?? "").trim();
  if (!t) return "";
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

function formatAuthorName(firstName: string, lastName: string): string {
  return `${firstName ?? ""} ${lastName ?? ""}`.trim() || "Community member";
}

/** Batch-load preview data for shared posts in chat threads. */
export async function loadSharedPostPreviewMap(
  postIds: string[]
): Promise<Record<string, SharedPostPreview>> {
  const unique = [...new Set(postIds.filter(Boolean))];
  if (unique.length === 0) return {};

  const posts = await prisma.post.findMany({
    where: { id: { in: unique } },
    select: {
      id: true,
      type: true,
      content: true,
      photos: true,
      videos: true,
      sourcePostId: true,
      author: { select: { firstName: true, lastName: true } },
    },
  });

  const sourceIds = posts
    .filter((p) => p.type === "shared_post" && p.sourcePostId)
    .map((p) => p.sourcePostId!);
  const sources =
    sourceIds.length > 0
      ? await prisma.post.findMany({
          where: { id: { in: [...new Set(sourceIds)] } },
          select: {
            id: true,
            content: true,
            photos: true,
            videos: true,
            author: { select: { firstName: true, lastName: true } },
          },
        })
      : [];
  const sourceMap = Object.fromEntries(sources.map((s) => [s.id, s]));

  const map: Record<string, SharedPostPreview> = {};
  for (const p of posts) {
    const source = p.sourcePostId ? sourceMap[p.sourcePostId] : null;
    const content = p.content?.trim() || source?.content?.trim() || "";
    const photos = p.photos.length > 0 ? p.photos : source?.photos ?? [];
    const videos = p.videos.length > 0 ? p.videos : source?.videos ?? [];
    const coverPhotoUrl = photos[0] ?? videos[0] ?? null;
    map[p.id] = {
      id: p.id,
      contentSnippet: snippet(content) || "Shared post",
      coverPhotoUrl,
      authorName: formatAuthorName(p.author.firstName, p.author.lastName),
    };
  }
  return map;
}

export async function loadSharedPostPreview(postId: string): Promise<SharedPostPreview | null> {
  const map = await loadSharedPostPreviewMap([postId]);
  return map[postId] ?? null;
}
