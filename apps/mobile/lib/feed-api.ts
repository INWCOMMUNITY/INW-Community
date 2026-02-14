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

/** Example feed posts for demo when the real feed is empty. */
export const EXAMPLE_FEED_POSTS: FeedPost[] = [
  {
    id: "example-1",
    type: "post",
    content:
      "Excited to share that our community has grown so much this year! Thank you for supporting local businesses in Eastern Washington and North Idaho. 🙌",
    photos: [],
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    author: {
      id: "ex-author-1",
      firstName: "Sarah",
      lastName: "Johnson",
      profilePhotoUrl: null,
    },
    liked: false,
    likeCount: 12,
    commentCount: 3,
  },
  {
    id: "example-2",
    type: "shared_blog",
    content: null,
    photos: [],
    createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    author: {
      id: "ex-author-2",
      firstName: "Mike",
      lastName: "Chen",
      profilePhotoUrl: null,
    },
    sourceBlog: {
      id: "ex-blog-1",
      slug: "local-farmers-market-highlights",
      title: "Local Farmers Market Highlights",
      body: "Check out the best produce and crafts from our weekly market. Fresh berries, handmade soaps, and more!",
      photos: [],
      member: {
        id: "ex-m",
        firstName: "NWC",
        lastName: "Team",
        profilePhotoUrl: null,
      },
      category: { name: "Community", slug: "community" },
    },
    liked: false,
    likeCount: 8,
    commentCount: 1,
  },
  {
    id: "example-3",
    type: "shared_business",
    content: null,
    photos: [],
    createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    author: {
      id: "ex-author-3",
      firstName: "Emily",
      lastName: "Davis",
      profilePhotoUrl: null,
    },
    sourceBusiness: {
      id: "ex-biz-1",
      name: "Berry Bay Smoothies",
      slug: "berry-bay-smoothies",
      shortDescription: "Fresh smoothies and acai bowls made with local ingredients.",
      logoUrl: null,
    },
    liked: false,
    likeCount: 5,
    commentCount: 0,
  },
  {
    id: "example-4",
    type: "shared_coupon",
    content: null,
    photos: [],
    createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    author: {
      id: "ex-author-4",
      firstName: "Chris",
      lastName: "Williams",
      profilePhotoUrl: null,
    },
    sourceCoupon: {
      id: "ex-coupon-1",
      name: "15% Off First Order",
      discount: "15% off",
      code: "WELCOME15",
      business: { name: "Berry Bay Smoothies", slug: "berry-bay-smoothies" },
    },
    liked: false,
    likeCount: 22,
    commentCount: 4,
  },
  {
    id: "example-5",
    type: "shared_store_item",
    content: null,
    photos: [],
    createdAt: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(),
    author: {
      id: "ex-author-5",
      firstName: "Jordan",
      lastName: "Lee",
      profilePhotoUrl: null,
    },
    sourceStoreItem: {
      id: "ex-item-1",
      title: "Handmade Wooden Bowl",
      slug: "handmade-wooden-bowl",
      photos: [],
      priceCents: 4500,
    },
    liked: false,
    likeCount: 7,
    commentCount: 2,
  },
];

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
}

export async function createPost(body: CreatePostBody): Promise<{ post?: FeedPost }> {
  return apiPost<{ post?: FeedPost }>("/api/posts", body);
}
