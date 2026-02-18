import { notFound } from "next/navigation";
import Link from "next/link";
import { CALENDAR_TYPES, type CalendarType } from "types";
import { CalendarView } from "@/components/CalendarView";
import { cloudinaryFetchUrl } from "@/lib/cloudinary";
import { getCalendarImagePath } from "@/lib/wix-media";

const validTypes = CALENDAR_TYPES.map((c) => c.value);

export default async function LocalEventTypePage({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const { type } = await params;
  if (!validTypes.includes(type as CalendarType)) notFound();
  const typedCalendarType = type as CalendarType;
  const label = CALENDAR_TYPES.find((c) => c.value === typedCalendarType)?.label ?? type;
  const imagePath = getCalendarImagePath(typedCalendarType);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <Link href="/my-community/local-events" className="text-sm text-gray-600 hover:underline mb-2 inline-block">
            ← Back to Local Events
          </Link>
          <h1 className="text-2xl font-bold mb-2">{label}</h1>
        </div>
        <Link href="/my-community/post-event" className="btn inline-block">
          Post Event
        </Link>
      </div>
      {imagePath && (
        <div className="mb-8 flex justify-center">
          <img
            src={imagePath ? cloudinaryFetchUrl(imagePath) : undefined}
            alt={label}
            className="rounded-lg max-w-full h-auto object-cover"
            width={420}
            height={418}
          />
        </div>
      )}
      <CalendarView calendarType={type} />
    </div>
  );
}
