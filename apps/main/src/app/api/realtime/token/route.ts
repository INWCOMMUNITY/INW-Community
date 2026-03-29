import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { signRealtimeSocketToken } from "@/lib/realtime-token";

/**
 * Socket.IO auth for web (cookie session). Mobile can use the existing Bearer JWT (nwc-mobile) instead.
 */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const token = await signRealtimeSocketToken(session.user.id);
    return NextResponse.json({ token });
  } catch (e) {
    console.error("[GET /api/realtime/token]", e);
    return NextResponse.json({ error: "Token unavailable" }, { status: 500 });
  }
}
