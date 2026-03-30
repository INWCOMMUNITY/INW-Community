/**
 * Routes guests (no member session) may not open in the mobile app.
 * Align with web guest policy: feed/browse ok; friends, groups, tags, hubs, orders, profile hub not.
 */

const COMMUNITY_SUB_DENY = new Set([
  "groups",
  "tags",
  "my-friends",
  "friend-requests",
  "invites",
  "posts-photos",
  "blogs",
  "my-orders",
]);

const ROOT_DENY = new Set([
  "messages",
  "seller-hub",
  "resale-hub",
  "saved-posts",
  "profile-edit",
  "blocked-members",
  "redeemed-rewards",
  "manage-subscription",
  "sponsor-business",
  "support-request",
]);

function logicalPath(segments: string[]): string[] {
  return segments.filter((s) => !s.startsWith("("));
}

/** True if this navigation should send a guest to login. */
export function shouldBlockGuestMobileRoute(segments: string[]): boolean {
  const s = logicalPath(segments);
  if (s.length === 0) return false;

  if (ROOT_DENY.has(s[0])) return true;
  if (s[0].startsWith("business-hub")) return true;

  if (s[0] === "community" && s[1] === "group") return true;
  if (s[0] === "community" && s[1] && COMMUNITY_SUB_DENY.has(s[1])) return true;

  // Profile tab (hubs / account) — guests use home/community browse only
  if (s[0] === "my-community") return true;

  return false;
}
