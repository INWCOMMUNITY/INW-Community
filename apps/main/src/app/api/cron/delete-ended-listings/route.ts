import { NextRequest, NextResponse } from "next/server";
import { deleteEndedListingsPastRetention } from "@/lib/ended-listing-cleanup";

export const maxDuration = 60;

/**
 * Route name is kept for scheduler compatibility. Physical StoreItem purge is
 * intentionally disabled: deleteEndedListingsPastRetention is a protective no-op
 * so ended listings and OrderItem history are retained.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { deleted } = await deleteEndedListingsPastRetention();
    if (deleted > 0) {
      console.info("[cron/delete-ended-listings] deleted", deleted);
    }
    return NextResponse.json({ ok: true, deleted });
  } catch (e) {
    console.error("[cron/delete-ended-listings]", e);
    return NextResponse.json({ error: "Failed to run cron" }, { status: 500 });
  }
}
