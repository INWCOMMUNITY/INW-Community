import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { sendPushNotification } from "@/lib/send-push-notification";

export const maxDuration = 60;

/** Run daily (e.g. 9:00 AM). Notify members who saved an event that starts tomorrow. */
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
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDateOnly = tomorrow.toISOString().slice(0, 10); // YYYY-MM-DD

    const saved = await prisma.savedItem.findMany({
      where: { type: "event" },
      select: { memberId: true, referenceId: true },
    });
    if (saved.length === 0) {
      return NextResponse.json({ ok: true, sent: 0 });
    }

    const eventIds = [...new Set(saved.map((s) => s.referenceId))];
    const events = await prisma.event.findMany({
      where: {
        id: { in: eventIds },
        date: new Date(tomorrowDateOnly),
        status: "approved",
      },
      select: { id: true, title: true, slug: true },
    });
    const eventMap = new Map(events.map((e) => [e.id, e]));

    let sent = 0;
    for (const s of saved) {
      const event = eventMap.get(s.referenceId);
      if (!event) continue;
      await sendPushNotification(s.memberId, {
        title: "Event tomorrow",
        body: `${event.title} is coming up tomorrow.`,
        data: { screen: "event", eventSlug: event.slug },
      });
      sent++;
    }

    return NextResponse.json({ ok: true, sent });
  } catch (e) {
    console.error("[cron/event-reminder]", e);
    return NextResponse.json({ error: "Failed to run cron" }, { status: 500 });
  }
}
