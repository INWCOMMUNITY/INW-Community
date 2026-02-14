import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { formatTime12h } from "@/lib/format-time";
import { CALENDAR_TYPES } from "types";

export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const saved = await prisma.savedItem.findMany({
    where: { memberId: session.user.id, type: "event" },
    orderBy: { createdAt: "desc" },
  });

  const eventIds = saved.map((s) => s.referenceId);
  const events =
    eventIds.length > 0
      ? await prisma.event.findMany({
          where: { id: { in: eventIds } },
          include: { business: { select: { name: true, slug: true } } },
          orderBy: { date: "asc" },
        })
      : [];

  const eventMap = new Map(events.map((e) => [e.id, e]));
  const result = saved
    .map((s) => {
      const event = eventMap.get(s.referenceId);
      if (!event) return null;
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
        CALENDAR_TYPES.find((c) => c.value === event.calendarType)?.label ?? event.calendarType;
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
      };
    })
    .filter((e): e is NonNullable<typeof e> => e != null);

  return NextResponse.json({ events: result });
}
