import { notFound } from "next/navigation";
import { CALENDAR_TYPES, type CalendarType } from "types";
import Link from "next/link";
import { CalendarView } from "@/components/CalendarView";
import { PostEventModal } from "@/components/PostEventModal";
import { getCalendarImagePath } from "@/lib/wix-media";

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
  const imagePath = getCalendarImagePath(typedCalendarType);

  return (
    <section className="relative min-h-[180vh] py-12 px-4 pb-24">
      {/* Mobile: background image in header with centered 70% white box; desktop: photo as full background with opaque content below */}
      {imagePath && (
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat max-md:h-[45vh] max-md:inset-x-0 max-md:top-0"
          style={{ backgroundImage: `url(${imagePath})` }}
          aria-hidden
        />
      )}
      {/* Mobile: white box centered in photo, shifted up 1in */}
      <div className="relative z-10 max-md:flex max-md:flex-col max-md:items-center max-md:justify-center max-md:h-[45vh] max-md:min-h-[45vh]">
        <div
          className="max-md:w-[90%] max-md:max-w-md max-md:rounded-xl max-md:p-6 max-md:shadow-xl max-md:text-center max-md:-translate-y-[0.5in] md:hidden"
          style={{ backgroundColor: "rgba(255,255,255,0.8)" }}
        >
          <Link href="/calendars" className="text-sm text-gray-600 hover:underline mb-2 inline-block">
            ← Back to NWC Calendar & Events Page
          </Link>
          <h1 className="text-2xl font-bold mb-2">Northwest Community</h1>
          <h2 className="text-xl font-semibold mb-4">{label}</h2>
          <PostEventModal calendarType={calendarType} calendarLabel={label} />
        </div>
      </div>
      {/* Calendar: full width on mobile, centered month/nav; desktop white box shifted up 1in */}
      <div className="relative z-10 max-w-[var(--max-width)] mx-auto md:-mt-[0.5in] max-md:mt-6 max-md:w-full max-md:max-w-full max-md:px-1">
        <div className="rounded-xl bg-white shadow-lg overflow-hidden max-md:rounded-none max-md:shadow-none">
          <div className="p-6 border-b border-gray-200 max-md:hidden">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <Link href="/calendars" className="text-sm text-gray-600 hover:underline mb-2 inline-block">
                  ← Back to NWC Calendar & Events Page
                </Link>
                <h1 className="text-3xl font-bold mb-2">Northwest Community</h1>
                <h2 className="text-2xl font-semibold">{label}</h2>
              </div>
              <PostEventModal calendarType={calendarType} calendarLabel={label} />
            </div>
          </div>
          <div className="p-6 max-md:p-1 max-md:w-full">
            <CalendarView calendarType={calendarType} />
          </div>
        </div>
      </div>
    </section>
  );
}
