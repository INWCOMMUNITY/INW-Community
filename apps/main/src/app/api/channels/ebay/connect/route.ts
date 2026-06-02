import { NextRequest } from "next/server";
import { channelConnectGET, channelConnectPOST } from "@/lib/channels/oauth-routes";

export const dynamic = "force-dynamic";

/** GET: start eBay OAuth (web). Redirects to eBay's consent screen. */
export function GET(req: NextRequest) {
  return channelConnectGET(req, "ebay");
}

/** POST: returns the eBay consent URL for the mobile app (Bearer session). Response: { url }. */
export function POST(req: NextRequest) {
  return channelConnectPOST(req, "ebay");
}
