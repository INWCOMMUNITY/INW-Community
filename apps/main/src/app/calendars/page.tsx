import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { CALENDAR_TYPES } from "types";
import { getCalendarImagePath } from "@/lib/wix-media";

export default async function CalendarsPage() {
  const session = await getServerSession(authOptions);
  const postEventHref = session?.user?.id ? "/my-community/post-event" : "/login?callbackUrl=/my-community/post-event";
  return (
    <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-[var(--max-width)] mx-auto text-center">
        <div className="flex flex-col items-center gap-4 mb-8 w-full max-md:px-2">
          <h1 className="text-3xl font-bold mb-2">Northwest Community Calendars</h1>
          <p className="opacity-80 max-w-xl">
            Local events not run by NWC. See what&apos;s happening in our area!
          </p>
          <div className="w-full max-md:flex max-md:justify-center">
            <Link
              href={postEventHref}
              className="btn inline-block"
            >
              Post Event
            </Link>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
          {CALENDAR_TYPES.map((c) => {
            const imagePath = getCalendarImagePath(c.value);
            return (
              <Link
                key={c.value}
                href={`/calendars/${c.value}`}
                className="block border-2 border-[var(--color-primary)] rounded-lg overflow-hidden transition text-center"
              >
                {imagePath ? (
                  <img
                    src={imagePath}
                    alt={c.label}
                    className="w-full aspect-square object-cover"
                    width={210}
                    height={210}
                  />
                ) : (
                  <div className="w-full aspect-square flex items-center justify-center opacity-60" style={{ backgroundColor: "var(--color-section-alt)" }} aria-hidden />
                )}
                <h2 className="text-[0.875rem] font-bold p-4">{c.label}</h2>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
