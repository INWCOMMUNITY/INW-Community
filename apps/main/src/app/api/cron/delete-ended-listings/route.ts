import { NextRequest, NextResponse } from "next/server";
import { deleteEndedListingsPastRetention } from "@/lib/ended-listing-cleanup";

export const maxDuration = 60;

/**
 * Removes INW storefront records that were ended more than 14 days ago.
 * Does not unpublish or delete listings on eBay, Etsy, Wix, or Shopify.
 * Configure in `apps/main/vercel.json` crons + `CRON_SECRET`.
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
