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
      "Mobile: set EXPO_PUBLIC_REALTIME_URL to match NEXT_PUBLIC_REALTIME_URL. Realtime service: set REDIS_URL when running multiple instances.",
  });
}
