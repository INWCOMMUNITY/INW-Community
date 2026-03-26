/**
 * Feed API - fetches feed posts and posts like/share from NWC backend.
 * Uses API client with auth (Bearer token).
 */

import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";

export interface FeedPost {
  id: string;
  type: string;
  content: string | null;
  photos: string[];
  videos?: string[];
  tags?: { id: string; name: string; slug: string }[];
  createdAt: string;
  author: {
    id: string;
    firstName: string;
    lastName: string;
    profilePhotoUrl: string | null;
  };
  sourceBlog?: {
    id: string;
    slug: string;
    title: string;
    body: string;
    photos: string[];
    member: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null };
    category: { name: string; slug: string };
    blogTags?: { tag: { id: string; name: string; slug: string } }[];
  } | null;
  sourceBusiness?: {
    id: string;
    name: string;
    slug: string;
    shortDescription: string | null;
    logoUrl: string | null;
  } | null;
  sourceCoupon?: {
    id: string;
    name: string;
    discount: string;
    code: string;
    business: { id: string; name: string; slug: string };
  } | null;
  sourceReward?: {
    id: string;
    title: string;
    pointsRequired: number;
    business: { id: string; name: string; slug: string };
  } | null;
  sourceStoreItem?: {
    id: string;
    title: string;
    slug: string;
    photos: string[];
    priceCents: number;
  } | null;
  sourcePost?: unknown;
  sourceGroup?: { id: string; name: string; slug: string } | null;
  /** Present on API payloads for group posts; used when editing. */
  groupId?: string | null;
  liked: boolean;
  likeCount: number;
  commentCount: number;
}

export interface FeedResponse {
  posts: FeedPost[];
  nextCursor: string | null;
}

/** True if this post (including nested shared_post sources) promotes a business the viewer owns. */
export function postTouchesViewerManagedBusinesses(post: FeedPost, businessIds: string[]): boolean {
  if (!businessIds.length) return false;
  const set = new Set(businessIds);
  const walk = (p: FeedPost): boolean => {
    if (p.sourceBusiness?.id && set.has(p.sourceBusiness.id)) return true;
    if (p.sourceCoupon?.business?.id && set.has(p.sourceCoupon.business.id)) return true;
    if (p.sourceReward?.business?.id && set.has(p.sourceReward.business.id)) return true;
    const sp = p.sourcePost;
    if (sp && typeof sp === "object" && sp !== null && "id" in sp) {
      return walk(sp as FeedPost);
    }
    return false;
  };
  return walk(post);
}

export async function fetchFeed(cursor?: string): Promise<FeedResponse> {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  const data = await apiGet<FeedResponse>(`/api/feed?${params}`);
  return {
    posts: data.posts ?? [],
    nextCursor: data.nextCursor ?? null,
  };
}

/** Single post (optional auth; 404 if viewer cannot see it; public posts work without a token). */
export async function fetchPostById(id: string): Promise<FeedPost> {
  const data = await apiGet<{ post: FeedPost }>(`/api/posts/${encodeURIComponent(id)}`);
  const post = data?.post;
  if (!post?.id) {
    throw { error: "Post not found" } as { error: string };
  }
  return post;
}

/** Fetch feed for a single group (posts directly in that group). Requires membership. */
export async function fetchGroupFeed(
  groupSlug: string,
  cursor?: string
): Promise<FeedResponse> {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  const data = await apiGet<FeedResponse>(
    `/api/groups/${encodeURIComponent(groupSlug)}/feed?${params}`
  );
  return {
    posts: data.posts ?? [],
    nextCursor: data.nextCursor ?? null,
  };
}

/** Business Hub: posts authored as your businesses (shared_business). Requires Business Hub access. */
export async function fetchBusinessHubBusinessPosts(cursor?: string): Promise<FeedResponse> {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  const data = await apiGet<FeedResponse>(`/api/business-hub/business-posts?${params}`);
  return {
    posts: data.posts ?? [],
    nextCursor: data.nextCursor ?? null,
  };
}

/** Feed of posts that reference this business listing or its coupons/rewards. */
export async function fetchBusinessFeed(businessId: string, cursor?: string): Promise<FeedResponse> {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  const data = await apiGet<FeedResponse>(
    `/api/businesses/${encodeURIComponent(businessId)}/feed?${params}`
  );
  return {
    posts: data.posts ?? [],
    nextCursor: data.nextCursor ?? null,
  };
}

export async function toggleLike(postId: string): Promise<{ liked: boolean }> {
  return apiPost<{ liked: boolean }>(`/api/posts/${postId}/like`, {});
}

export interface FeedComment {
  id: string;
  content: string;
  photos?: string[];
  parentId?: string | null;
  parentAuthorName?: string | null;
  likeCount?: number;
  liked?: boolean;
  createdAt: string;
  member: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    profilePhotoUrl: string | null;
  };
}

export async function fetchComments(postId: string): Promise<{ comments: FeedComment[] }> {
  return apiGet<{ comments: FeedComment[] }>(`/api/posts/${postId}/comments`);
}

export async function createComment(
  postId: string,
  content: string,
  photos?: string[],
  parentId?: string
): Promise<FeedComment> {
  const body: { content: string; photos?: string[]; parentId?: string } = {
    content: content.trim() || " ",
    ...(photos && photos.length > 0 && { photos }),
    ...(parentId && { parentId }),
  };
  return apiPost<FeedComment>(`/api/posts/${postId}/comments`, body);
}

export async function likeComment(
  postId: string,
  commentId: string
): Promise<{ liked: boolean }> {
  return apiPost<{ liked: boolean }>(
    `/api/posts/${postId}/comments/${commentId}/like`,
    {}
  );
}

export async function sharePost(
  postId: string,
  body?: { content?: string | null; groupId?: string | null }
): Promise<{ post?: FeedPost }> {
  return apiPost<{ post?: FeedPost }>(`/api/posts/${postId}/share`, body ?? {});
}

export interface CreatePostBody {
  content?: string | null;
  photos?: string[];
  videos?: string[];
  tags?: string[];
  taggedMemberIds?: string[];
  /** When set, create this post as a group post (must be a member). */
  groupId?: string | null;
  sharedItemType?: "business" | "coupon" | "reward" | "store_item";
  sharedItemId?: string;
}

export async function createPost(body: CreatePostBody): Promise<{ post?: FeedPost }> {
  return apiPost<{ post?: FeedPost }>("/api/posts", body);
}

export interface UpdatePostBody {
  content?: string | null;
  photos?: string[];
  videos?: string[];
  tags?: string[];
  taggedMemberIds?: string[];
}

export async function updatePost(
  postId: string,
  body: UpdatePostBody
): Promise<{ post?: FeedPost }> {
  return apiPatch<{ post?: FeedPost }>(`/api/posts/${postId}`, body);
}

export async function deletePost(postId: string): Promise<void> {
  await apiDelete(`/api/posts/${postId}`);
}
