import { NextRequest } from "next/server";
import { channelConnectGET, channelConnectPOST } from "@/lib/channels/oauth-routes";

export const dynamic = "force-dynamic";

/** GET: start Wix connect (web). Redirects to the Wix App install screen. */
export function GET(req: NextRequest) {
  return channelConnectGET(req, "wix");
}

/** POST: returns the Wix install URL for the mobile app (Bearer session). Response: { url }. */
export function POST(req: NextRequest) {
  return channelConnectPOST(req, "wix");
}
