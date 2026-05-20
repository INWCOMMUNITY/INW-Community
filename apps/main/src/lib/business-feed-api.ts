/**
 * Business listing feed — posts that reference this business or its coupons/rewards.
 */

export interface BusinessFeedPost {
  id: string;
  type: string;
  content: string | null;
  photos: string[];
  videos?: string[];
  tags?: { id: string; name: string; slug: string }[];
  createdAt: string;
  groupId?: string | null;
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

export interface BusinessFeedResponse {
  posts: BusinessFeedPost[];
  nextCursor: string | null;
}

export async function fetchBusinessFeed(
  businessId: string,
  cursor?: string
): Promise<BusinessFeedResponse> {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  const res = await fetch(
    `/api/businesses/${encodeURIComponent(businessId)}/feed?${params}`,
    { credentials: "include" }
  );
  if (!res.ok) {
    throw new Error("Failed to load business feed");
  }
  const data = await res.json();
  return {
    posts: Array.isArray(data.posts) ? data.posts : [],
    nextCursor: data.nextCursor ?? null,
  };
}

export async function toggleBusinessFeedLike(postId: string): Promise<{ liked: boolean }> {
  const res = await fetch(`/api/posts/${encodeURIComponent(postId)}/like`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Like failed");
  return res.json();
}
