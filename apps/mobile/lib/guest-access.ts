/**
 * Routes guests (no member session) may not open in the mobile app.
 * Align with web guest policy: feed/browse ok; Profile tab shows a sign-in prompt; friends, groups, tags,
 * standalone hubs/orders routes, etc. stay gated.
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
  "share-inw-community",
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

  // Profile tab (my-community): guests stay on the tab and see the sign-in prompt there.
  // Do not redirect here — competing GuestRouteGuard replace() vs tab navigation has caused Android crashes.

  return false;
}
