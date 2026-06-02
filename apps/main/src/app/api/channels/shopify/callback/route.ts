import { NextRequest } from "next/server";
import { channelCallbackGET } from "@/lib/channels/oauth-routes";

export const dynamic = "force-dynamic";

/** GET: Shopify OAuth callback. Verifies HMAC, exchanges code, stores offline token + shop config. */
export function GET(req: NextRequest) {
  return channelCallbackGET(req, "shopify");
}
