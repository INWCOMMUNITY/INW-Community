/**
 * Paths guests (no session) may hit on the main web app.
 * Used by middleware (redirect) and my-community layout (minimal shell vs sign-in gate).
 */

/** URL prefixes guests must not access — redirect to login with callbackUrl. */
const GUEST_DENY_PREFIXES = [
  "/community-groups",
  "/seller-hub",
  "/business-hub",
  "/resale-hub",
  "/sponsor-hub",
  "/admin",
] as const;

export function isGuestAllowedMyCommunityPath(pathname: string): boolean {
  const p = pathname.split("?")[0] ?? pathname;
  if (p === "/my-community/feed" || p.startsWith("/my-community/feed/")) return true;
  if (p === "/my-community/local-events" || p.startsWith("/my-community/local-events/"))
    return true;
  if (p === "/my-community/rewards" || p.startsWith("/my-community/rewards/")) return true;
  return false;
}

export function shouldRedirectGuestFromPath(pathname: string): boolean {
  const p = pathname.split("?")[0] ?? pathname;
  if (p.startsWith("/api/")) return false;
  for (const prefix of GUEST_DENY_PREFIXES) {
    if (p === prefix || p.startsWith(`${prefix}/`)) return true;
  }
  if (p === "/my-community" || p.startsWith("/my-community/")) {
    return !isGuestAllowedMyCommunityPath(p);
  }
  return false;
}
