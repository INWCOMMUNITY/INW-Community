"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { IonIcon } from "@/components/IonIcon";
import { MyEventCard } from "@/components/event/MyEventCard";
import { partitionMyEvents, type MyEventListItem, type MyEventsTab } from "@/lib/my-events-page";

const TABS: { key: MyEventsTab; label: string }[] = [
  { key: "saved", label: "Saved" },
  { key: "going", label: "Going" },
  { key: "posted", label: "Posted" },
  { key: "ended", label: "Ended" },
];

function parseTab(value: string | null): MyEventsTab {
  if (value === "going" || value === "posted" || value === "ended" || value === "saved") return value;
  return "saved";
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div
      className="rounded-xl border-2 px-6 py-10 text-center"
      style={{ backgroundColor: "#FDEDCC", borderColor: "var(--color-primary)" }}
    >
      <div className="mb-3 flex justify-center text-[var(--color-primary)]">
        <IonIcon name="calendar-outline" size={36} />
      </div>
      <p className="text-lg font-bold mb-2" style={{ color: "var(--color-heading)" }}>
        {title}
      </p>
      <p className="text-sm text-gray-700 mb-5 max-w-md mx-auto">{body}</p>
      <div className="flex flex-wrap justify-center gap-3">
        <Link href="/my-community/local-events" className="btn inline-block">
          See Local Events
        </Link>
        <Link href="/my-community/post-event" className="btn inline-block">
          Post Event
        </Link>
      </div>
    </div>
  );
}

function EventSection({
  events,
  fromTab,
  savedIds,
  onUnsaved,
}: {
  events: MyEventListItem[];
  fromTab: MyEventsTab;
  savedIds: Set<string>;
  onUnsaved?: (id: string) => void;
}) {
  if (events.length === 0) return null;
  return (
    <ul className="grid grid-cols-2 gap-3 sm:gap-4">
      {events.map((event) => (
        <li key={event.id} className="min-w-0">
          <MyEventCard
            event={event}
            fromTab={fromTab}
            showSave={savedIds.has(event.id)}
            onUnsaved={() => onUnsaved?.(event.id)}
          />
        </li>
      ))}
    </ul>
  );
}

export function MyEventsContent({
  saved,
  going,
  posted,
}: {
  saved: MyEventListItem[];
  going: MyEventListItem[];
  posted: MyEventListItem[];
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = parseTab(searchParams?.get("tab") ?? null);
  const [hiddenSavedIds, setHiddenSavedIds] = useState<Set<string>>(new Set());

  const visibleSaved = useMemo(
    () => saved.filter((e) => !hiddenSavedIds.has(e.id)),
    [saved, hiddenSavedIds]
  );
  const savedIds = useMemo(() => new Set(visibleSaved.map((e) => e.id)), [visibleSaved]);
  const lists = useMemo(
    () => partitionMyEvents(visibleSaved, going, posted),
    [visibleSaved, going, posted]
  );
  const counts: Record<MyEventsTab, number> = {
    saved: lists.saved.length,
    going: lists.going.length,
    posted: lists.posted.length,
    ended: lists.ended.length,
  };
  const tabEvents = lists[tab];

  function setTab(next: MyEventsTab) {
    const sp = new URLSearchParams(searchParams?.toString() ?? "");
    if (next === "saved") sp.delete("tab");
    else sp.set("tab", next);
    const qs = sp.toString();
    router.replace(`${pathname ?? "/my-community/events"}${qs ? `?${qs}` : ""}`, { scroll: false });
  }

  const emptyCopy =
    tab === "going"
      ? {
          title: "You’re not going to any events yet",
          body: "RSVP from an event page, or browse local calendars to find something this week.",
        }
      : tab === "posted"
        ? {
            title: "You haven’t posted an upcoming event",
            body: "Share a fundraiser, show, or community gathering on a local calendar.",
          }
        : tab === "ended"
          ? {
              title: "No ended events",
              body: "When a saved, RSVP’d, or posted event is over, it will move here.",
            }
          : {
              title: "No saved events yet",
              body: "Heart events you want to remember. They’ll show up here with the date, place, and a way to share them.",
            };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-bold">My Events</h1>
          <p className="text-sm text-gray-600 mt-1">
            {counts.saved} saved · {counts.going} going · {counts.posted} posted · {counts.ended} ended
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/my-community/post-event" className="btn inline-block">
            Post Event
          </Link>
          <Link href="/my-community/local-events" className="btn inline-block">
            See Local Events
          </Link>
        </div>
      </div>

      <div className="flex gap-1 mb-6 border-b border-gray-200 overflow-x-auto">
        {TABS.map((t) => {
          const active = tab === t.key;
          const count = counts[t.key];
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap flex items-center gap-2 ${
                active
                  ? "border-[var(--color-primary)] text-[var(--color-primary)]"
                  : "border-transparent text-gray-600 hover:text-gray-900"
              }`}
            >
              {t.label}
              {count > 0 ? (
                <span
                  className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center"
                  style={{
                    backgroundColor: active ? "var(--color-primary)" : "var(--color-section-alt)",
                    color: active ? "#fff" : "var(--color-primary)",
                  }}
                >
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {tabEvents.length === 0 ? (
        <EmptyState title={emptyCopy.title} body={emptyCopy.body} />
      ) : (
        <EventSection
          events={tabEvents}
          fromTab={tab}
          savedIds={savedIds}
          onUnsaved={(id) => setHiddenSavedIds((prev) => new Set(prev).add(id))}
        />
      )}
    </>
  );
}
