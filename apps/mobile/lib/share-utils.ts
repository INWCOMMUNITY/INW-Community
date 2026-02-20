/**
 * Share utilities for NWC mobile app.
 * URL builder and share API helpers for feed/group sharing.
 */

import { apiPost } from "@/lib/api";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

export type SharedContentType =
  | "post"
  | "blog"
  | "store_item"
  | "business"
  | "coupon"
  | "reward"
  | "photo";

export interface ShareContent {
  type: SharedContentType;
  id: string;
  slug?: string;
  /** For store_item: "new" = storefront, "resale" = resale */
  listingType?: "new" | "resale";
}

/**
 * Build shareable web URL for content.
 */
export function buildShareUrl(content: ShareContent): string {
  switch (content.type) {
    case "post":
      return content.slug ? `${siteBase}/posts/${content.slug}` : `${siteBase}/`;
    case "blog":
      return content.slug ? `${siteBase}/blog/${content.slug}` : `${siteBase}/blog`;
    case "store_item":
      const path = content.listingType === "resale" ? "resale" : "storefront";
      return content.slug ? `${siteBase}/${path}/${content.slug}` : siteBase;
    case "business":
      return content.slug ? `${siteBase}/support-local/${content.slug}` : siteBase;
    case "coupon":
      return `${siteBase}/coupons/${content.id}`;
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
};

/**
 * Share content to feed. Creates a feed post.
 * Photos are not shared to feed via this API.
 */
export async function shareToFeed(
  content: ShareContent,
  text?: string
): Promise<{ post?: unknown }> {
  if (content.type === "photo") {
    throw new Error("Photo sharing to feed not supported");
  }
  const path = SHARE_API_PATH[content.type];
  return apiPost<{ post?: unknown }>(`${path}/${content.id}/share`, {
    ...(text?.trim() ? { content: text.trim() } : {}),
  });
}

/**
 * Share post to a community group.
 * Only posts support groupId; other types create feed posts without group targeting.
 */
export async function shareToGroup(
  content: ShareContent,
  groupId: string
): Promise<{ post?: unknown }> {
  if (content.type !== "post") {
    throw new Error("Share to group is only supported for posts");
  }
  return apiPost<{ post?: unknown }>(`/api/posts/${content.id}/share`, {
    groupId,
  });
}
