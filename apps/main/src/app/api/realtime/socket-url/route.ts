import { NextResponse } from "next/server";
import { resolvePublicRealtimeSocketUrl } from "@/lib/realtime-socket-url";

export const dynamic = "force-dynamic";

/**
 * Lets the browser connect when NEXT_PUBLIC_REALTIME_URL was not set at build time but
 * REALTIME_PUBLISH_URL is (common: mobile env complete, Vercel missing the public var).
 */
export async function GET() {
  const url = resolvePublicRealtimeSocketUrl();
  return NextResponse.json(
    { url },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
