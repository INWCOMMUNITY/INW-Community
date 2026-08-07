export type SharedContentType =
  | "post"
  | "blog"
  | "store_item"
  | "business"
  | "storefront"
  | "coupon"
  | "reward"
  | "event"
  | "photo";

export interface ShareContent {
  type: SharedContentType;
  id: string;
  slug?: string;
}

export function buildShareUrl(content: ShareContent, origin?: string): string {
  const siteBase =
    origin ??
    (typeof window !== "undefined" ? window.location.origin : "https://www.inwcommunity.com");
  switch (content.type) {
    case "post":
      return `${siteBase}/my-community/posts/${content.id}`;
    case "blog":
      return content.slug ? `${siteBase}/blog/${content.slug}` : `${siteBase}/blog`;
    case "store_item":
      return content.slug ? `${siteBase}/storefront/${content.slug}` : siteBase;
    case "business":
      return content.slug ? `${siteBase}/support-local/${content.slug}` : siteBase;
    case "storefront":
      return content.slug ? `${siteBase}/seller/${content.slug}` : siteBase;
    case "coupon":
      return `${siteBase}/coupons/${content.id}`;
    case "event":
      return content.slug ? `${siteBase}/events/${content.slug}` : `${siteBase}/calendars`;
    case "reward":
      return content.id ? `${siteBase}/rewards#reward-${content.id}` : `${siteBase}/rewards`;
    case "photo":
      return content.id.startsWith("http")
        ? content.id
        : `${siteBase}${content.id.startsWith("/") ? "" : "/"}${content.id}`;
    default:
      return siteBase;
  }
}

const SHARE_API_PATH: Record<Exclude<SharedContentType, "photo" | "storefront">, string> = {
  post: "/api/posts",
  blog: "/api/blogs",
  store_item: "/api/store-items",
  business: "/api/businesses",
  coupon: "/api/coupons",
  reward: "/api/rewards",
  event: "/api/events",
};

export async function shareToFeed(
  content: ShareContent,
  text?: string,
  opts?: { groupId?: string | null }
): Promise<{
  post?: unknown;
  shareCount?: number;
  shareRecorded?: boolean;
}> {
  if (content.type === "photo") {
    throw new Error("Photo sharing to feed not supported");
  }
  if (content.type === "storefront") {
    throw new Error("Use business type for storefront shares");
  }
  const path = SHARE_API_PATH[content.type];
  const groupId = opts?.groupId?.trim() || null;
  const res = await fetch(`${path}/${content.id}/share`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(text?.trim() ? { content: text.trim() } : {}),
      ...(groupId ? { groupId } : {}),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Share failed");
  return data;
}

export async function shareToGroup(
  content: ShareContent,
  groupId: string
): Promise<{ post?: unknown; shareCount?: number; shareRecorded?: boolean }> {
  if (content.type !== "post") {
    throw new Error("Share to group is only supported for posts");
  }
  const res = await fetch(`/api/posts/${content.id}/share`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ groupId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Share failed");
  return data;
}

export type PostShareChannel = "email" | "sms" | "link_copy" | "external";

export async function recordPostShareEvent(
  postId: string,
  channel: PostShareChannel
): Promise<{ recorded: boolean; shareCount: number }> {
  const res = await fetch(`/api/posts/${postId}/share-event`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channel }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Failed to record share");
  return data as { recorded: boolean; shareCount: number };
}

export function nextShareCountAfterShare(
  current: number | undefined,
  opts?: { recorded?: boolean; shareCount?: number }
): number | null {
  if (opts?.shareCount != null) return opts.shareCount;
  if (opts?.recorded === true) return (current ?? 0) + 1;
  return null;
}
