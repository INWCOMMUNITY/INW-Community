/**
 * Share utilities for NWC mobile app.
 * URL builder and share API helpers for feed/group sharing.
 */

import { apiPost } from "@/lib/api";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

export type SharedContentType =
  | "post"
  | "blog"
  | "store_item"
  | "business"
  | "coupon"
  | "reward"
  | "event"
  | "photo";

export interface ShareContent {
  type: SharedContentType;
  id: string;
  slug?: string;
}

/** Member badges returned by some share/create APIs (e.g. blog share → Community Writer). */
export interface EarnedBadgePayload {
  slug: string;
  name: string;
  description?: string;
}

/**
 * Build shareable web URL for content.
 */
export function buildShareUrl(content: ShareContent): string {
  switch (content.type) {
    case "post":
      return `${siteBase}/my-community/posts/${content.id}`;
    case "blog":
      return content.slug ? `${siteBase}/blog/${content.slug}` : `${siteBase}/blog`;
    case "store_item":
      return content.slug ? `${siteBase}/storefront/${content.slug}` : siteBase;
    case "business":
      return content.slug ? `${siteBase}/support-local/${content.slug}` : siteBase;
    case "coupon":
      return `${siteBase}/coupons/${content.id}`;
    case "event":
      return content.slug ? `${siteBase}/events/${content.slug}` : `${siteBase}/calendars`;
    case "reward":
      return content.id ? `${siteBase}/rewards#reward-${content.id}` : `${siteBase}/rewards`;
    case "photo":
      return content.id.startsWith("http") ? content.id : `${siteBase}${content.id.startsWith("/") ? "" : "/"}${content.id}`;
    default:
      return siteBase;
  }
}

/** API path by content type for share-to-feed */
const SHARE_API_PATH: Record<Exclude<SharedContentType, "photo">, string> = {
  post: "/api/posts",
  blog: "/api/blogs",
  store_item: "/api/store-items",
  business: "/api/businesses",
  coupon: "/api/coupons",
  reward: "/api/rewards",
  event: "/api/events",
};

/**
 * Share content to feed. Creates a feed post.
 * Photos are not shared to feed via this API.
 */
export async function shareToFeed(
  content: ShareContent,
  text?: string,
  opts?: { groupId?: string | null }
): Promise<{
  post?: unknown;
  earnedBadges?: EarnedBadgePayload[];
  shareCount?: number;
  shareRecorded?: boolean;
}> {
  if (content.type === "photo") {
    throw new Error("Photo sharing to feed not supported");
  }
  const path = SHARE_API_PATH[content.type];
  const groupId = opts?.groupId?.trim() || null;
  return apiPost<{
    post?: unknown;
    earnedBadges?: EarnedBadgePayload[];
    shareCount?: number;
    shareRecorded?: boolean;
  }>(`${path}/${content.id}/share`, {
    ...(text?.trim() ? { content: text.trim() } : {}),
    ...(groupId ? { groupId } : {}),
  });
}

/**
 * Share post to a community group.
 * Only posts support groupId; other types create feed posts without group targeting.
 */
export async function shareToGroup(
  content: ShareContent,
  groupId: string
): Promise<{
  post?: unknown;
  earnedBadges?: EarnedBadgePayload[];
  shareCount?: number;
  shareRecorded?: boolean;
}> {
  if (content.type !== "post") {
    throw new Error("Share to group is only supported for posts");
  }
  return apiPost<{
    post?: unknown;
    earnedBadges?: EarnedBadgePayload[];
    shareCount?: number;
    shareRecorded?: boolean;
  }>(`/api/posts/${content.id}/share`, {
    groupId,
  });
}

export type PostShareChannel = "email" | "sms" | "link_copy" | "external";

/** Record an external post share (copy link, email, SMS, native share sheet). */
export async function recordPostShareEvent(
  postId: string,
  channel: PostShareChannel
): Promise<{ recorded: boolean; shareCount: number }> {
  return apiPost<{ recorded: boolean; shareCount: number }>(
    `/api/posts/${postId}/share-event`,
    { channel }
  );
}
