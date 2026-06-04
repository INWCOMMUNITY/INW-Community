import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { CALENDAR_TYPES } from "types";
import { getCalendarImagePath } from "@/lib/wix-media";

export default async function CalendarsPage() {
  const session = await getServerSession(authOptions);
  const postEventHref = session?.user?.id ? "/my-community/post-event" : "/login?callbackUrl=/my-community/post-event";
  return (
    <section className="pt-20 pb-12 px-4" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-[var(--max-width)] mx-auto text-center">
        <div
          className="mb-8 mx-auto flex w-full max-w-2xl flex-col items-center gap-4 rounded-lg border-2 border-[var(--color-primary)] p-6 sm:p-8 max-md:px-2"
          style={{ backgroundColor: "var(--color-section-alt)" }}
        >
          <div className="flex flex-col items-center gap-1">
            <h1 className="text-3xl font-bold">Northwest Community Calendars</h1>
            <p className="opacity-80 max-w-xl">
              Take a look at the events happening in Spokane &amp; Kootenai County!
            </p>
          </div>
          <div className="flex w-full max-w-xs justify-center sm:max-w-sm">
            <Link
              href={postEventHref}
              className="btn inline-block w-full text-center px-8 py-2.5 text-sm sm:text-base"
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
