/** Image URLs that belong in a member profile photo grid. */

function stringUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((u): u is string => typeof u === "string" && u.trim().length > 0);
}

type NestedSource = {
  photos?: unknown;
  sourceBlog?: { photos?: unknown } | null;
  sourceStoreItem?: { photos?: unknown } | null;
  sourceEvent?: { photos?: unknown } | null;
  sourceListingCollection?: { previewPhotos?: unknown } | null;
};

/**
 * Prefer the post's own photos; otherwise use the embedded share target
 * (reshared post, blog, listing, event, collection).
 * Accepts loosely typed hydrated feed rows (`Record<string, unknown>`).
 */
export function galleryPhotosFromHydratedPost(post: unknown): string[] {
  if (!post || typeof post !== "object") return [];
  const p = post as {
    photos?: unknown;
    sourceBlog?: { photos?: unknown } | null;
    sourceStoreItem?: { photos?: unknown } | null;
    sourceEvent?: { photos?: unknown } | null;
    sourceListingCollection?: { previewPhotos?: unknown } | null;
    sourcePost?: NestedSource | null;
  };
  const own = stringUrls(p.photos);
  if (own.length) return own;

  const source = p.sourcePost;
  if (source) {
    const nestedOwn = stringUrls(source.photos);
    if (nestedOwn.length) return nestedOwn;
    const nestedBlog = stringUrls(source.sourceBlog?.photos);
    if (nestedBlog.length) return nestedBlog;
    const nestedItem = stringUrls(source.sourceStoreItem?.photos);
    if (nestedItem.length) return nestedItem;
    const nestedEvent = stringUrls(source.sourceEvent?.photos);
    if (nestedEvent.length) return nestedEvent;
    const nestedCol = stringUrls(source.sourceListingCollection?.previewPhotos);
    if (nestedCol.length) return nestedCol;
  }

  const blog = stringUrls(p.sourceBlog?.photos);
  if (blog.length) return blog;
  const item = stringUrls(p.sourceStoreItem?.photos);
  if (item.length) return item;
  const event = stringUrls(p.sourceEvent?.photos);
  if (event.length) return event;
  return stringUrls(p.sourceListingCollection?.previewPhotos);
}
