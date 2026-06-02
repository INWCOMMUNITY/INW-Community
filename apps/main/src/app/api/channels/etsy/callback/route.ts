import { NextRequest } from "next/server";
import { channelCallbackGET } from "@/lib/channels/oauth-routes";

export const dynamic = "force-dynamic";

/** GET: Etsy OAuth callback. Exchanges the code, stores encrypted tokens + shop info. */
export function GET(req: NextRequest) {
  return channelCallbackGET(req, "etsy");
}
