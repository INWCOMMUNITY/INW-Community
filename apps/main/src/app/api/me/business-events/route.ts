import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { formatTime12h } from "@/lib/format-time";
import { CALENDAR_TYPES } from "types";
import { getEventInviteStatsByEventIds } from "@/lib/event-invite-stats";

/** Events posted as a business directory listing (businessId set, owned by the member). */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const events = await prisma.event.findMany({
    where: {
      status: "approved",
      businessId: { not: null },
      business: { memberId: session.user.id },
    },
    include: { business: { select: { name: true, slug: true } } },
    orderBy: { date: "desc" },
  });

  const statsMap = await getEventInviteStatsByEventIds(events.map((e) => e.id));

  const result = events.map((event) => {
    const dateStr = new Date(event.date).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    const timeStr = event.time
      ? event.endTime
        ? `${formatTime12h(event.time)} – ${formatTime12h(event.endTime)}`
        : formatTime12h(event.time)
      : null;
    const calendarLabel =
      CALENDAR_TYPES.find((c) => c.value === event.calendarType)?.label ??
      event.calendarType;
    return {
      id: event.id,
      title: event.title,
      slug: event.slug,
      date: event.date,
      dateStr,
      time: event.time,
      endTime: event.endTime,
      timeStr,
      calendarType: event.calendarType,
      calendarLabel,
      business: event.business,
      inviteStats: statsMap.get(event.id)!,
    };
  });

  return NextResponse.json({ events: result });
}
