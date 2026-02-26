/**
 * Feed API - fetches feed posts and posts like/share from NWC backend.
 * Uses API client with auth (Bearer token).
 */

import { apiGet, apiPost } from "@/lib/api";

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
    business: { name: string; slug: string };
  } | null;
  sourceReward?: {
    id: string;
    title: string;
    pointsRequired: number;
    business: { name: string; slug: string };
  } | null;
  sourceStoreItem?: {
    id: string;
    title: string;
    slug: string;
    photos: string[];
    priceCents: number;
  } | null;
  sourcePost?: unknown;
  liked: boolean;
  likeCount: number;
  commentCount: number;
}

export interface FeedResponse {
  posts: FeedPost[];
  nextCursor: string | null;
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
  sharedItemType?: "business" | "coupon" | "reward" | "store_item";
  sharedItemId?: string;
}

export async function createPost(body: CreatePostBody): Promise<{ post?: FeedPost }> {
  return apiPost<{ post?: FeedPost }>("/api/posts", body);
}
