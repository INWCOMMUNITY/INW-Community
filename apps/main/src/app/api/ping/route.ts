import { NextResponse } from "next/server";

/**
 * GET /api/ping
 * Simple connectivity test. Open this URL on your phone's browser:
 * http://YOUR_IP:3000/api/ping
 * If you see {"ok":true}, the phone can reach your server.
 */
export async function GET() {
  return NextResponse.json({ ok: true, ts: Date.now() });
}
