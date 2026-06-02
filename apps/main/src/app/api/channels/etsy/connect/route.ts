import { NextRequest } from "next/server";
import { channelConnectGET, channelConnectPOST } from "@/lib/channels/oauth-routes";

export const dynamic = "force-dynamic";

/** GET: start Etsy OAuth (web). Redirects to Etsy's consent screen. */
export function GET(req: NextRequest) {
  return channelConnectGET(req, "etsy");
}

/** POST: returns the Etsy consent URL for the mobile app (Bearer session). Response: { url }. */
export function POST(req: NextRequest) {
  return channelConnectPOST(req, "etsy");
}
