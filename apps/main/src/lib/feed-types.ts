export type FeedFilterId = "all" | "friends" | "groups" | "businesses" | "trending";

export const FEED_FILTERS: { id: FeedFilterId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "friends", label: "Friends" },
  { id: "groups", label: "Groups" },
  { id: "businesses", label: "Businesses" },
  { id: "trending", label: "Trending" },
];

export function parseFeedFilterId(value: string | null | undefined): FeedFilterId {
  if (value && FEED_FILTERS.some((f) => f.id === value)) {
    return value as FeedFilterId;
  }
  return "all";
}

export type FeedPostAuthor = {
  id: string;
  firstName: string;
  lastName: string;
  profilePhotoUrl: string | null;
};

export type FeedPostPoll = {
  question: string;
  options: { id: string; label: string; voteCount: number }[];
  totalVotes: number;
  myVote?: string;
};

export type CommunityFeedPost = {
  id: string;
  type: string;
  content: string | null;
  photos: string[];
  videos?: string[];
  tags?: { id: string; name: string; slug: string }[];
  createdAt: string;
  updatedAt?: string;
  groupId?: string | null;
  author: FeedPostAuthor;
  isFollowingAuthor?: boolean;
  sourceBlog?: {
    id: string;
    slug: string;
    title: string;
    body: string;
    photos: string[];
    member: FeedPostAuthor;
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
  sourceEvent?: {
    id: string;
    slug: string;
    title: string;
    date: string;
    time: string | null;
    endTime: string | null;
    location: string | null;
    city: string | null;
    photos: string[];
  } | null;
  sourcePost?: CommunityFeedPost | null;
  sourceGroup?: { id: string; name: string; slug: string } | null;
  taggedBusinesses?: {
    id: string;
    name: string;
    slug: string;
    shortDescription: string | null;
    logoUrl: string | null;
  }[];
  liked: boolean;
  likeCount: number;
  commentCount: number;
  shareCount?: number;
  poll?: FeedPostPoll | null;
};

export async function fetchFeedPage(
  cursor?: string,
  filter: FeedFilterId = "all"
): Promise<{ posts: CommunityFeedPost[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  if (filter !== "all") params.set("filter", filter);
  const res = await fetch(`/api/feed?${params}`, { credentials: "include" });
  const data = await res.json().catch(() => ({}));
  return {
    posts: Array.isArray(data.posts) ? data.posts : [],
    nextCursor: data.nextCursor ?? null,
  };
}

export async function fetchGroupFeedPage(
  slug: string,
  cursor?: string
): Promise<{ posts: CommunityFeedPost[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  const res = await fetch(`/api/groups/${encodeURIComponent(slug)}/feed?${params}`, {
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error("Could not load posts");
  }
  const data = await res.json().catch(() => ({}));
  return {
    posts: Array.isArray(data.posts) ? data.posts : [],
    nextCursor: typeof data.nextCursor === "string" ? data.nextCursor : null,
  };
}

export async function fetchNewPostCountSince(since: string): Promise<number> {
  const res = await fetch(`/api/feed/count-since?since=${encodeURIComponent(since)}`, {
    credentials: "include",
  });
  const data = await res.json().catch(() => ({}));
  return typeof data.count === "number" ? data.count : 0;
}
