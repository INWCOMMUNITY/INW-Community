import { prisma } from "database";
import Link from "next/link";
import { CALENDAR_TYPES, type CalendarType } from "types";
import { getCalendarImagePath } from "@/lib/wix-media";
import { formatTime12h } from "@/lib/format-time";
import { calendarImageObjectClass, shortCalendarLabel } from "@/lib/calendar-labels";
import { PostEventModal } from "@/components/PostEventModal";
import { buildEventHref } from "@/lib/event-referrer";

function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export default async function CalendarsPage() {
  const from = startOfLocalDay(new Date());
  const to = new Date(from);
  to.setDate(to.getDate() + 7);
  to.setHours(23, 59, 59, 999);

  const upcoming = await prisma.event.findMany({
    where: {
      status: "approved",
      date: { gte: from, lte: to },
    },
    select: {
      id: true,
      slug: true,
      title: true,
      date: true,
      time: true,
      endTime: true,
      location: true,
      calendarType: true,
    },
    orderBy: [{ date: "asc" }, { time: "asc" }],
  });

  const counts = Object.fromEntries(CALENDAR_TYPES.map((c) => [c.value, 0])) as Record<CalendarType, number>;
  for (const ev of upcoming) {
    counts[ev.calendarType] = (counts[ev.calendarType] ?? 0) + 1;
  }

  return (
    <section className="px-4 py-8 md:py-10" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-[var(--max-width)] mx-auto">
        <div className="relative mb-8 overflow-hidden rounded-2xl min-h-[220px] md:min-h-[300px] flex items-end">
          <img
            src="/calendars/calendars-hero.jpg"
            alt=""
            className="absolute inset-0 h-full w-full object-cover object-center"
            aria-hidden
          />
          <div className="relative z-10 w-full p-5 md:p-8">
            <div
              className="inline-flex flex-col rounded-xl px-8 py-5 md:px-10 md:py-6"
              style={{ backgroundColor: "rgba(62, 67, 47, 0.66)" }}
            >
              <p
                className="text-[11px] md:text-xs font-semibold tracking-[0.16em] uppercase"
                style={{ color: "#FDEDCC" }}
              >
                Spokane &amp; Kootenai County
              </p>
              <h1
                className="text-3xl md:text-4xl font-bold text-white mt-1.5 whitespace-nowrap"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                Northwest Community Calendars
              </h1>
              <p className="text-sm md:text-base mt-2" style={{ color: "rgba(253,237,204,0.95)" }}>
                Take a look at the events happening in Spokane &amp; Kootenai County!
              </p>
              <div
                className="mt-4"
                style={{
                  ["--color-button" as string]: "var(--color-earth)",
                  ["--color-button-text" as string]: "#ffffff",
                  ["--color-button-hover" as string]: "#4a3f33",
                  ["--color-button-hover-text" as string]: "#ffffff",
                }}
              >
                <PostEventModal className="inline-block" />
              </div>
            </div>
          </div>
        </div>

        <section>
          <h2
            className="text-2xl font-semibold mb-3"
            style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
          >
            Upcoming this Week
          </h2>
          {upcoming.length === 0 ? (
            <p className="text-sm text-gray-600">No events this week — check a calendar below.</p>
          ) : (
            <ul className="space-y-2">
              {upcoming.map((ev) => {
                const dateStr = new Date(ev.date).toLocaleDateString("en-US", {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                });
                const timeStr = ev.time
                  ? ev.endTime
                    ? `${formatTime12h(ev.time)} – ${formatTime12h(ev.endTime)}`
                    : formatTime12h(ev.time)
                  : null;
                return (
                  <li key={ev.id}>
                    <Link
                      href={buildEventHref(ev.slug, { type: "calendars" })}
                      className="block rounded-lg border px-4 py-3 no-underline hover:bg-[var(--color-section-alt)] transition"
                      style={{ borderColor: "var(--color-earth)", color: "var(--color-heading)" }}
                    >
                      <p className="font-semibold">{ev.title}</p>
                      <p className="text-sm text-gray-600 mt-0.5">
                        {dateStr}
                        {timeStr ? ` · ${timeStr}` : ""}
                        {ev.location ? ` · ${ev.location}` : ""}
                        {" · "}
                        {shortCalendarLabel(ev.calendarType)}
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="mt-10">
          <h2
            className="text-2xl font-semibold mb-3"
            style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
          >
            Calendars
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
            {CALENDAR_TYPES.map((c) => {
              const imagePath = getCalendarImagePath(c.value);
              const count = counts[c.value] ?? 0;
              const short = shortCalendarLabel(c.value);
              return (
                <Link
                  key={c.value}
                  href={`/calendars/${c.value}`}
                  className="group relative block overflow-hidden rounded-lg border bg-white text-center no-underline transition hover:opacity-95"
                  style={{ borderColor: "var(--color-earth)" }}
                >
                  {imagePath ? (
                    <img
                      src={imagePath}
                      alt={short}
                      className={`w-full aspect-[4/3] md:aspect-square object-cover ${calendarImageObjectClass(c.value)}`}
                      width={420}
                      height={420}
                    />
                  ) : (
                    <div
                      className="w-full aspect-[4/3] md:aspect-square"
                      style={{ backgroundColor: "var(--color-section-alt)" }}
                      aria-hidden
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-black/[0.03] to-transparent pointer-events-none" />
                  {count > 0 && (
                    <span className="absolute top-2 right-2 rounded-full bg-white/90 px-2 py-0.5 text-xs font-semibold" style={{ color: "var(--color-heading)" }}>
                      {count} upcoming
                    </span>
                  )}
                  <h3
                    className="absolute bottom-0 inset-x-0 p-3 text-sm md:text-base font-bold text-white"
                    style={{ fontFamily: "var(--font-heading)" }}
                  >
                    {short}
                  </h3>
                </Link>
              );
            })}
          </div>
        </section>
      </div>
    </section>
  );
}
