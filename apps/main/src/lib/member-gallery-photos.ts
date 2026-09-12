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
 */
export function galleryPhotosFromHydratedPost(post: {
  photos?: unknown;
  sourceBlog?: { photos?: unknown } | null;
  sourceStoreItem?: { photos?: unknown } | null;
  sourceEvent?: { photos?: unknown } | null;
  sourceListingCollection?: { previewPhotos?: unknown } | null;
  sourcePost?: NestedSource | null;
}): string[] {
  const own = stringUrls(post.photos);
  if (own.length) return own;

  const source = post.sourcePost;
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

  const blog = stringUrls(post.sourceBlog?.photos);
  if (blog.length) return blog;
  const item = stringUrls(post.sourceStoreItem?.photos);
  if (item.length) return item;
  const event = stringUrls(post.sourceEvent?.photos);
  if (event.length) return event;
  return stringUrls(post.sourceListingCollection?.previewPhotos);
}
