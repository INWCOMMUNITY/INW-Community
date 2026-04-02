import { notFound } from "next/navigation";
import { CALENDAR_TYPES, type CalendarType } from "types";
import Link from "next/link";
import { CalendarView } from "@/components/CalendarView";
import { PostEventModal } from "@/components/PostEventModal";
import { cloudinaryFetchUrl } from "@/lib/cloudinary";
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
    <section className="relative px-4 pb-8 max-md:pt-0 md:min-h-[180vh] md:pb-24 md:pt-24">
      {/* Mobile: hero image and overlay share the same top + height so the white box centers in the photo */}
      {imagePath && (
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat max-md:h-[45vh] max-md:rounded-none max-md:bottom-auto max-md:left-0 max-md:right-0 max-md:top-0"
          style={{ backgroundImage: imagePath ? `url(${cloudinaryFetchUrl(imagePath)})` : undefined }}
          aria-hidden
        />
      )}
      <div className="relative z-10 flex min-h-[45vh] w-full flex-col items-center justify-center px-2 max-md:h-[45vh] md:hidden">
        <div
          className="mx-auto w-[min(92%,28rem)] rounded-xl p-5 text-center shadow-xl sm:p-6"
          style={{ backgroundColor: "rgba(255,255,255,0.88)" }}
        >
          <Link href="/calendars" className="text-sm text-gray-600 hover:underline mb-2 inline-block">
            ← Back to NWC Calendar & Events Page
          </Link>
          <h1 className="text-2xl font-bold mb-2">Northwest Community</h1>
          <h2 className="text-xl font-semibold mb-4">{label}</h2>
          <PostEventModal calendarType={calendarType} calendarLabel={label} />
        </div>
      </div>
      <div className="relative z-10 mx-auto mt-0 w-full max-w-[var(--max-width)] max-md:max-w-full md:mt-8">
        <div className="overflow-hidden rounded-xl bg-white shadow-lg max-md:rounded-lg max-md:shadow-md">
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
