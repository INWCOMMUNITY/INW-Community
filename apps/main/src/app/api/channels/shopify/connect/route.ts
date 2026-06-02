import { NextRequest } from "next/server";
import { channelConnectGET, channelConnectPOST } from "@/lib/channels/oauth-routes";

export const dynamic = "force-dynamic";

/** GET: start Shopify OAuth (web). Requires `?shop=` query param. */
export function GET(req: NextRequest) {
  return channelConnectGET(req, "shopify");
}

/** POST: returns the Shopify consent URL for the mobile app. Body: { shop }. */
export function POST(req: NextRequest) {
  return channelConnectPOST(req, "shopify");
}
