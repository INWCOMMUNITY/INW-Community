import { NextRequest } from "next/server";
import { channelCallbackGET } from "@/lib/channels/oauth-routes";

export const dynamic = "force-dynamic";

/** GET: eBay OAuth callback. Exchanges the code, stores encrypted tokens + business policies. */
export function GET(req: NextRequest) {
  return channelCallbackGET(req, "ebay");
}
