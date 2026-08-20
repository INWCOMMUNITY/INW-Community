import { notFound } from "next/navigation";
import { CALENDAR_TYPES, type CalendarType } from "types";
import Link from "next/link";
import { CalendarView } from "@/components/CalendarView";
import { PostEventModal } from "@/components/PostEventModal";
import { getCalendarImagePath } from "@/lib/wix-media";
import { calendarDescription, calendarImageObjectClass, shortCalendarLabel } from "@/lib/calendar-labels";

const validTypes = CALENDAR_TYPES.map((c) => c.value);

export default async function CalendarTypePage({
  params,
}: {
  params: Promise<{ calendarType: string }>;
}) {
  const { calendarType } = await params;
  if (!validTypes.includes(calendarType as CalendarType)) notFound();
  const typedCalendarType = calendarType as CalendarType;
  const label = CALENDAR_TYPES.find((c) => c.value === typedCalendarType)?.label ?? calendarType;
  const short = shortCalendarLabel(typedCalendarType);
  const description = calendarDescription(typedCalendarType);
  const imagePath = getCalendarImagePath(typedCalendarType);

  return (
    <section className="px-4 py-6 md:py-10">
      <div className="mx-auto w-full max-w-[var(--max-width)]">
        <div className="relative overflow-hidden rounded-xl w-full aspect-[5/2] min-h-[13rem]">
          {imagePath ? (
            <>
              <img
                src={imagePath}
                alt=""
                className={`absolute inset-0 w-full h-full object-cover ${calendarImageObjectClass(typedCalendarType)}`}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-black/20 to-black/10" />
            </>
          ) : (
            <div
              className="absolute inset-0"
              style={{ backgroundColor: "var(--color-earth)" }}
              aria-hidden
            />
          )}
          <div className="absolute inset-0 z-10 flex flex-col justify-between p-4 md:p-6">
            <Link
              href="/calendars"
              className="self-start rounded-full bg-white/90 px-3 py-1.5 text-sm font-semibold no-underline hover:bg-white"
              style={{ color: "var(--color-heading)" }}
            >
              ← Back to calendars
            </Link>
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
              <div className="min-w-0">
                <h1
                  className="text-3xl md:text-4xl font-bold text-white"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  {short}
                </h1>
                <p className="text-sm md:text-base text-white/90 mt-1 max-w-xl">{description}</p>
              </div>
              <PostEventModal calendarType={calendarType} calendarLabel={label} className="shrink-0" />
            </div>
          </div>
        </div>

        <nav aria-label="Calendars" className="grid grid-cols-3 md:grid-cols-6 gap-2 mt-4 mb-8">
          {CALENDAR_TYPES.map((c) => {
            const tileImage = getCalendarImagePath(c.value);
            const tileLabel = shortCalendarLabel(c.value);
            const active = c.value === typedCalendarType;
            return (
              <Link
                key={c.value}
                href={`/calendars/${c.value}`}
                aria-current={active ? "page" : undefined}
                className="group relative block overflow-hidden rounded-lg border-2 bg-white text-center no-underline transition hover:opacity-95"
                style={{
                  borderColor: active ? "var(--color-primary)" : "var(--color-earth)",
                }}
              >
                {tileImage ? (
                  <img
                    src={tileImage}
                    alt=""
                    className={`w-full aspect-[5/2] object-cover ${calendarImageObjectClass(c.value)}`}
                  />
                ) : (
                  <div
                    className="w-full aspect-[5/2]"
                    style={{ backgroundColor: "var(--color-section-alt)" }}
                    aria-hidden
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-black/[0.03] to-transparent pointer-events-none" />
                <span
                  className="absolute bottom-0 inset-x-0 p-1.5 text-[11px] md:text-xs font-bold text-white leading-tight"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  {tileLabel}
                </span>
              </Link>
            );
          })}
        </nav>

        <CalendarView
          calendarType={calendarType}
          emptyAction={
            <PostEventModal calendarType={calendarType} calendarLabel={label} className="shrink-0" />
          }
        />
      </div>
    </section>
  );
}
