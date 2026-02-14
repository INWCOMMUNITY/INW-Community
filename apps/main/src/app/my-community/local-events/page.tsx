import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { CALENDAR_TYPES } from "types";
import { getCalendarImagePath } from "@/lib/wix-media";

export default async function LocalEventsPage() {
  const session = await getServerSession(authOptions);
  const postEventHref = session?.user?.id ? "/my-community/post-event" : "/login?callbackUrl=/my-community/post-event";

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-2">Local Events</h1>
          <p className="text-gray-600">
            Local events not run by NWC. See what&apos;s happening in our area!
          </p>
        </div>
        <Link href={postEventHref} className="btn inline-block">
          Post Event
        </Link>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
        {CALENDAR_TYPES.map((c) => {
          const imagePath = getCalendarImagePath(c.value);
          return (
            <Link
              key={c.value}
              href={`/my-community/local-events/${c.value}`}
              className="block border-2 rounded-lg overflow-hidden transition text-center hover:shadow-md"
              style={{ borderColor: "var(--color-primary)" }}
            >
              {imagePath ? (
                <img
                  src={imagePath}
                  alt={c.label}
                  className="w-full h-64 object-cover"
                  width={210}
                  height={256}
                />
              ) : (
                <div
                  className="w-full h-64 flex items-center justify-center opacity-60"
                  style={{ backgroundColor: "var(--color-section-alt)" }}
                  aria-hidden
                />
              )}
              <h2 className="text-xl font-bold p-4">{c.label}</h2>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
