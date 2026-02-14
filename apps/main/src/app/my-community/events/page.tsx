import { getServerSession } from "next-auth";
import { prisma } from "database";
import { authOptions } from "@/lib/auth";
import Link from "next/link";
import { UnsaveButton } from "@/components/UnsaveButton";
import { formatTime12h } from "@/lib/format-time";
import { CALENDAR_TYPES } from "types";

export default async function MyEventsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;

  const saved = await prisma.savedItem.findMany({
    where: { memberId: session.user.id, type: "event" },
    orderBy: { createdAt: "desc" },
  });

  const eventIds = saved.map((s) => s.referenceId);
  const events = eventIds.length
    ? await prisma.event.findMany({
        where: { id: { in: eventIds } },
        include: { business: { select: { name: true, slug: true } } },
        orderBy: { date: "asc" },
      })
    : [];

  const eventMap = new Map(events.map((e) => [e.id, e]));

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold">My Events</h1>
        <Link
          href="/my-community/local-events"
          className="btn inline-block"
        >
          See Local Events
        </Link>
      </div>
      {saved.length === 0 ? (
        <p className="text-gray-600">
          You haven&apos;t saved any events yet. Browse the{" "}
          <Link href="/my-community/local-events" className="hover:underline" style={{ color: "var(--color-link)" }}>
            Local Events
          </Link>{" "}
          to find events to save.
        </p>
      ) : (
        <ul className="space-y-4">
          {saved.map((s) => {
            const event = eventMap.get(s.referenceId);
            if (!event) return null;
            const dateStr = new Date(event.date).toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            });
            return (
              <li
                key={s.id}
                className="border rounded-lg p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
              >
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link
                      href={`/events/${event.slug}`}
                      className="font-medium hover:underline"
                      style={{ color: "var(--color-link)" }}
                    >
                      {event.title}
                    </Link>
                    <span
                      className="text-xs px-2 py-0.5 rounded"
                      style={{ backgroundColor: "var(--color-section-alt)", color: "var(--color-primary)" }}
                    >
                      {CALENDAR_TYPES.find((c) => c.value === event.calendarType)?.label ?? event.calendarType}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 mt-1">
                    {dateStr}
                    {event.time
                      ? event.endTime
                        ? ` · ${formatTime12h(event.time)} – ${formatTime12h(event.endTime)}`
                        : ` · ${formatTime12h(event.time)}`
                      : ""}
                    {event.business && ` · ${event.business.name}`}
                  </p>
                </div>
                <UnsaveButton type="event" referenceId={event.id} />
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
