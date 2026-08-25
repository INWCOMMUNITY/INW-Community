export type FeedBusinessAuthor = {
  id: string;
  name: string;
  slug: string;
  shortDescription: string | null;
  logoUrl: string | null;
};

/** Listing posts and directory shares show the business as the feed author. */
export function feedPostShowsAsBusiness(post: {
  type: string;
  sourceBusiness?: FeedBusinessAuthor | null;
}): FeedBusinessAuthor | null {
  if (!post.sourceBusiness) return null;
  if (
    post.type === "shared_business" ||
    post.type === "shared_store_item" ||
    post.type === "shared_listing_collection"
  ) {
    return post.sourceBusiness;
  }
  return null;
}

export function feedBusinessAuthorHref(type: string, slug: string): string {
  if (type === "shared_store_item" || type === "shared_listing_collection") {
    return `/support-local/sellers/${slug}`;
  }
  return `/support-local/${slug}`;
}
