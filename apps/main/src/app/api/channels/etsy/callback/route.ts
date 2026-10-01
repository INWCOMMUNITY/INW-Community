import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Legacy Etsy portal callback path (pre V2 `/api/etsy/oauth/callback`).
 * Preserve query and bounce to the canonical handler so the browser-binding
 * cookie (Path=/api/etsy/oauth/callback) is sent on the second hop.
 */
export async function GET(req: NextRequest) {
  const target = new URL("/api/etsy/oauth/callback", req.nextUrl.origin);
  target.search = req.nextUrl.search;
  console.info("ETSY_OAUTH_LEGACY_CALLBACK_REDIRECT", {
    from: req.nextUrl.pathname,
    to: target.pathname,
    hasCode: req.nextUrl.searchParams.has("code"),
    hasState: req.nextUrl.searchParams.has("state"),
  });
  return NextResponse.redirect(target, 307);
}
