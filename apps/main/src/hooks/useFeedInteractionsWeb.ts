"use client";

import type { CommunityFeedPost } from "@/lib/feed-types";

/** Shared POST body for web feed like / reaction toggles. */
export async function postFeedLike(
  postId: string
): Promise<{ liked: boolean } | null> {
  const res = await fetch(`/api/posts/${postId}/like`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) return null;
  return res.json();
}

export function applyOptimisticLike(
  post: CommunityFeedPost,
  nextLiked: boolean
): Pick<CommunityFeedPost, "liked" | "likeCount"> {
  return {
    liked: nextLiked,
    likeCount: post.likeCount + (nextLiked ? 1 : -1),
  };
}

export function applyLikeApiResult(
  post: CommunityFeedPost,
  beforeLiked: boolean,
  apiLiked: boolean
): Pick<CommunityFeedPost, "liked" | "likeCount"> {
  const base = beforeLiked ? post.likeCount - 1 : post.likeCount;
  return {
    liked: apiLiked,
    likeCount: apiLiked ? base + 1 : base,
  };
}
