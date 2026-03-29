import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getRealtimeEnvStatus, publishPipelineLikelyWorks } from "@/lib/realtime-env-check";

/**
 * Safe booleans for verifying messaging env (no secrets). Development: open GET.
 * Production: requires admin session or x-admin-code (same as other admin APIs).
 */
export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    if (!(await requireAdmin(req))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const status = getRealtimeEnvStatus();
  return NextResponse.json({
    ...status,
    publishPipelineLikelyWorks: publishPipelineLikelyWorks(),
    note:
      "Web messages page uses NEXT_PUBLIC_REALTIME_URL, or REALTIME_PUBLISH_URL via GET /api/realtime/socket-url. Mobile: EXPO_PUBLIC_REALTIME_URL. Realtime: REDIS_URL if multiple instances.",
  });
}
