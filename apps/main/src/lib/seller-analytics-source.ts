import type { NextRequest } from "next/server";

/** Detect whether a request originated from the INW mobile app. */
export function getSellerAnalyticsSource(req: NextRequest): "mobile" | "web" {
  const ua = req.headers.get("user-agent") ?? "";
  if (/INWCommunity\/\d/i.test(ua) || /com\.northwestcommunity\.app/i.test(ua)) {
    return "mobile";
  }
  return "web";
}
