import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import Link from "next/link";
import { EventForm } from "@/components/EventForm";

export default async function PostEventPage({
  searchParams,
}: {
  searchParams: Promise<{ calendarType?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login?callbackUrl=/my-community/post-event");

  const { calendarType: calendarTypeFromUrl } = await searchParams;

  return (
    <div>
      <Link href="/my-community" prefetch={false} className="text-sm text-gray-600 hover:underline mb-4 inline-block">
        ← Back to My Community
      </Link>
      <h1 className="text-2xl font-bold mb-6">Post Event</h1>
      <p className="text-gray-600 mb-6">
        Add an event to one of the community calendars. All members can post events.
      </p>
      <EventForm successRedirect="/my-community/events" initialCalendarType={calendarTypeFromUrl} />
    </div>
  );
}
