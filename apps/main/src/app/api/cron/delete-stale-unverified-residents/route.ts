import { NextRequest, NextResponse } from "next/server";
import { deleteStaleUnverifiedResidents } from "@/lib/stale-unverified-resident-cleanup";

export const maxDuration = 60;

/**
 * Removes resident accounts that never verified email and are older than 14 days, with no subs/business/orders/Stripe IDs.
 * Business and seller signups are never selected. Configure in `apps/main/vercel.json` crons + `CRON_SECRET`.
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
    const { deleted } = await deleteStaleUnverifiedResidents();
    if (deleted > 0) {
      console.info("[cron/delete-stale-unverified-residents] deleted", deleted);
    }
    return NextResponse.json({ ok: true, deleted });
  } catch (e) {
    console.error("[cron/delete-stale-unverified-residents]", e);
    return NextResponse.json({ error: "Failed to run cron" }, { status: 500 });
  }
}
