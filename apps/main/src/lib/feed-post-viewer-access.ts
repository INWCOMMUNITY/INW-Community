/**
 * Whether the authenticated viewer may see a feed-shaped post payload
 * (aligned with /api/feed authenticated branch).
 */
export function canViewerSeeFeedItem(
  p: {
    type: string;
    author?: { id?: string; privacyLevel?: string | null } | null;
    groupId?: string | null;
    sourcePost?: {
      author?: { id?: string; privacyLevel?: string | null } | null;
      groupId?: string | null;
    } | null;
  },
  viewerId: string,
  viewerFriendIdSet: Set<string>,
  viewerGroupIdSet: Set<string>
): boolean {
  if (!p.author?.id) return false;

  if (p.type === "shared_post") {
    const sourcePost = p.sourcePost;
    if (!sourcePost?.author?.id) return false;

    const sourceAuthorId = sourcePost.author.id;
    const sourcePrivacyLevel = sourcePost.author.privacyLevel ?? "public";
    const sourceGroupId = sourcePost.groupId ?? null;

    if (sourceGroupId && viewerGroupIdSet.has(sourceGroupId)) return true;
    if (sourcePrivacyLevel === "public") return true;
    if (sourcePrivacyLevel === "friends_only") {
      return sourceAuthorId === viewerId || viewerFriendIdSet.has(sourceAuthorId);
    }
    if (sourcePrivacyLevel === "completely_private") {
      return sourceAuthorId === viewerId;
    }
    return false;
  }

  const postGroupId = p.groupId ?? null;
  if (postGroupId && viewerGroupIdSet.has(postGroupId)) return true;

  const authorId = p.author.id;
  const privacyLevel = p.author.privacyLevel ?? "public";

  if (privacyLevel === "public") return true;
  if (privacyLevel === "friends_only") {
    return authorId === viewerId || viewerFriendIdSet.has(authorId);
  }
  if (privacyLevel === "completely_private") {
    return authorId === viewerId;
  }
  return false;
}

/**
 * Matches /api/feed when there is no session: public authors only, no group posts,
 * and shared_post items only when the embedded source author is public.
 */
export function canUnauthenticatedViewerSeeFeedItem(p: {
  type: string;
  author?: { privacyLevel?: string | null } | null;
  groupId?: string | null;
  sourcePost?: { author?: { privacyLevel?: string | null } | null } | null;
}): boolean {
  if (!p.author) return false;
  const outer = p.author.privacyLevel ?? "public";
  if (outer !== "public") return false;
  if (p.groupId) return false;
  if (p.type === "shared_post") {
    const srcAuth = p.sourcePost?.author;
    if (!srcAuth) return false;
    const srcLevel = srcAuth.privacyLevel ?? "public";
    if (srcLevel !== "public") return false;
  }
  return true;
}
