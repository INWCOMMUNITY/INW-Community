/**
 * Returns true if a feed post has meaningful content to render (hides empty / orphaned shares).
 */

import { isCouponActiveByExpiresAt } from "@/lib/coupon-expiration";

export type FeedPostLike = {
  type: string;
  content: string | null;
  photos: string[];
  videos: string[];
  links: unknown;
  sourceBlogId: string | null;
  sourcePostId: string | null;
  sourceBusinessId: string | null;
  sourceCouponId: string | null;
  sourceRewardId: string | null;
  sourceStoreItemId: string | null;
  sourceBlog?: unknown;
  sourcePost?: unknown;
  sourceBusiness?: unknown;
  sourceCoupon?: unknown;
  sourceReward?: unknown;
  sourceStoreItem?: unknown;
};

function hasLinks(links: unknown): boolean {
  if (!links || !Array.isArray(links)) return false;
  return (links as unknown[]).some((l) => l != null && typeof l === "object" && Object.keys(l as object).length > 0);
}

export function isFeedPostRenderable(p: FeedPostLike): boolean {
  const text = (p.content ?? "").trim();
  const hasMedia = (p.photos?.length ?? 0) > 0 || (p.videos?.length ?? 0) > 0;
  if (text || hasMedia || hasLinks(p.links)) return true;

  if (p.type === "shared_blog" || p.sourceBlogId) {
    return Boolean(p.sourceBlog);
  }
  if (p.type === "shared_post" || p.sourcePostId) {
    return Boolean(p.sourcePost);
  }
  if (p.type === "shared_business" || p.sourceBusinessId) {
    return Boolean(p.sourceBusiness);
  }
  if (p.type === "shared_coupon" || p.sourceCouponId) {
    const c = p.sourceCoupon;
    if (!c || typeof c !== "object") return false;
    const raw = (c as { expiresAt?: Date | string | null }).expiresAt;
    if (raw == null) return isCouponActiveByExpiresAt(null);
    const exp = raw instanceof Date ? raw : new Date(raw as string);
    if (Number.isNaN(exp.getTime())) return false;
    return isCouponActiveByExpiresAt(exp);
  }
  if (p.type === "shared_reward" || p.sourceRewardId) {
    return Boolean(p.sourceReward);
  }
  if (p.type === "shared_store_item" || p.sourceStoreItemId) {
    return Boolean(p.sourceStoreItem);
  }

  return false;
}
