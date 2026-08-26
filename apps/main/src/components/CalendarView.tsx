"use client";

import { useState, useEffect, useMemo, type ReactNode } from "react";
import Link from "next/link";
import { HeartSaveButton } from "@/components/HeartSaveButton";
import { formatTime12h } from "@/lib/format-time";
import { IonIcon } from "@/components/IonIcon";
import { buildEventHref } from "@/lib/event-referrer";

interface EventItem {
  id: string;
  slug: string;
  title: string;
  date: string;
  time: string | null;
  endTime: string | null;
  location: string | null;
  business: { name: string; slug: string } | null;
}

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function eventDateKey(date: string): string {
  return toDateKey(new Date(date));
}

export function CalendarView({
  calendarType,
  emptyAction,
}: {
  calendarType: string;
  emptyAction?: ReactNode;
}) {
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [view, setView] = useState<"list" | "month">("list");
  const [scrollDay, setScrollDay] = useState<string | null>(null);
  const eventHref = (slug: string) => buildEventHref(slug, { type: "local-events", calendarType });

  const from = useMemo(() => startOfMonth(currentMonth), [currentMonth]);
  const to = useMemo(() => endOfMonth(currentMonth), [currentMonth]);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const apply = () => setView(mq.matches ? "month" : "list");
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    setLoading(true);
    setFetchError(null);
    fetch(
      `/api/events?calendarType=${encodeURIComponent(calendarType)}&from=${from.toISOString()}&to=${to.toISOString()}`
    )
      .then(async (r) => {
        if (!r.ok) {
          throw new Error(`Request failed (${r.status})`);
        }
        const ct = r.headers.get("content-type");
        if (!ct?.includes("application/json")) {
          throw new Error("Invalid response");
        }
        return r.json() as Promise<unknown>;
      })
      .then((d) => {
        setEvents(Array.isArray(d) ? d : []);
      })
      .catch(() => {
        setFetchError("Could not load events. Try again.");
        setEvents([]);
      })
      .finally(() => setLoading(false));
  }, [calendarType, from.toISOString(), to.toISOString()]);

  useEffect(() => {
    fetch("/api/saved?type=event")
      .then((r) => r.json())
      .then((items) => {
        if (Array.isArray(items)) {
          setSavedIds(new Set(items.map((i: { referenceId: string }) => i.referenceId)));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (view !== "list" || !scrollDay) return;
    const id = `day-${scrollDay}`;
    const t = window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
      setScrollDay(null);
    }, 50);
    return () => window.clearTimeout(t);
  }, [view, scrollDay]);

  const eventsByDay = useMemo(() => {
    const map: Record<string, EventItem[]> = {};
    for (const ev of events) {
      const key = eventDateKey(ev.date);
      if (!map[key]) map[key] = [];
      map[key].push(ev);
    }
    return map;
  }, [events]);

  const weeks = useMemo(() => {
    const first = startOfMonth(currentMonth);
    const last = endOfMonth(currentMonth);
    const startDow = first.getDay();
    const daysInMonth = last.getDate();
    const totalCells = startDow + daysInMonth;
    const trailingBlanks = (7 - (totalCells % 7)) % 7;
    const out: (number | null)[][] = [];
    let day = 1;
    let row: (number | null)[] = [];
    for (let i = 0; i < startDow; i++) row.push(null);
    for (let i = 0; i < daysInMonth; i++) {
      row.push(day++);
      if (row.length === 7) {
        out.push(row);
        row = [];
      }
    }
    for (let i = 0; i < trailingBlanks; i++) row.push(null);
    if (row.length) out.push(row);
    return out;
  }, [currentMonth]);

  const monthLabel = currentMonth.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const prevMonth = () => {
    setCurrentMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1));
  };

  const nextMonth = () => {
    setCurrentMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1));
  };

  const todayKey = toDateKey(new Date());

  function showDayList(dayKey: string) {
    setScrollDay(dayKey);
    setView("list");
  }

  const toggleClass = (active: boolean) =>
    `px-3 py-1.5 text-sm font-semibold rounded-full border ${
      active ? "text-white border-transparent" : "text-gray-700 border-gray-200 hover:bg-gray-50"
    }`;

  const today = new Date();
  const isCurrentMonth =
    currentMonth.getFullYear() === today.getFullYear() &&
    currentMonth.getMonth() === today.getMonth();

  const emptyState = (
    <div
      className="rounded-xl border bg-white px-4 py-8 text-center"
      style={{ borderColor: "var(--color-earth)" }}
    >
      <p className="text-gray-600">No events in this calendar for {monthLabel}.</p>
      {emptyAction ? <div className="mt-4 flex justify-center">{emptyAction}</div> : null}
    </div>
  );

  const eventList = (
    <div>
      {loading ? (
        <p className="text-gray-500 text-sm">Loading…</p>
      ) : events.length === 0 ? (
        emptyState
      ) : (
        <ul className="space-y-3">
          {events.map((ev, i) => {
            const dayKey = eventDateKey(ev.date);
            const firstOfDay = i === 0 || eventDateKey(events[i - 1]!.date) !== dayKey;
            const dateStr = new Date(ev.date).toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            });
            return (
              <li
                key={ev.id}
                id={firstOfDay ? `day-${dayKey}` : undefined}
                className="border rounded-lg p-4 transition bg-white relative"
                style={{ borderColor: "var(--color-earth)" }}
              >
                <div className="absolute top-3 right-3">
                  <HeartSaveButton
                    type="event"
                    referenceId={ev.id}
                    initialSaved={savedIds.has(ev.id)}
                  />
                </div>
                <Link href={eventHref(ev.slug)} className="block">
                  <h4 className="font-bold pr-8">{ev.title}</h4>
                  <p className="text-gray-600 text-sm">
                    {dateStr}
                    {ev.time
                      ? ev.endTime
                        ? ` · ${formatTime12h(ev.time)} – ${formatTime12h(ev.endTime)}`
                        : ` · ${formatTime12h(ev.time)}`
                      : ""}
                  </p>
                  {ev.location && (
                    <p className="text-gray-600 text-sm">{ev.location}</p>
                  )}
                  {ev.business && (
                    <p className="text-sm mt-1" style={{ color: "var(--color-link)" }}>{ev.business.name}</p>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  const monthGrid = (
    <div className="border rounded-xl overflow-hidden bg-white" style={{ borderColor: "var(--color-earth)" }}>
      {!loading && events.length === 0 ? (
        <div className="px-4 py-5 text-center border-b" style={{ borderColor: "var(--color-earth)" }}>
          <p className="text-sm text-gray-600">No events this month.</p>
          {emptyAction ? <div className="mt-3 flex justify-center">{emptyAction}</div> : null}
        </div>
      ) : null}
      <div className="grid grid-cols-7 border-b bg-gray-50">
        {WEEKDAYS.map((wd) => (
          <div
            key={wd}
            className="py-2 text-center text-xs font-semibold text-gray-600 uppercase border-r last:border-r-0"
          >
            {wd}
          </div>
        ))}
      </div>
      {loading ? (
        <div className="p-8 text-center text-gray-500">Loading calendar…</div>
      ) : (
        <div className="grid grid-cols-7">
          {weeks.flat().map((day, idx) => {
            const cellMin =
              events.length === 0 ? "min-h-[3.5rem] sm:min-h-[4.25rem]" : "min-h-[6rem] sm:min-h-[7.5rem]";
            if (day === null) {
              return (
                <div
                  key={`empty-${idx}`}
                  className={`${cellMin} border-b border-r border-gray-200 bg-gray-50/50 last:border-r-0`}
                />
              );
            }
            const key = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const dayEvents = eventsByDay[key] ?? [];
            const isToday = key === todayKey;
            return (
              <div
                key={key}
                className={`${cellMin} border-b border-r border-gray-200 p-1 last:border-r-0 flex flex-col`}
              >
                <span
                  className={`text-sm font-medium mb-1 ${
                    isToday
                      ? "w-7 h-7 rounded-full flex items-center justify-center"
                      : "opacity-80"
                  }`}
                  {...(isToday && { style: { backgroundColor: "var(--color-button)", color: "var(--color-button-text)" } })}
                >
                  {day}
                </span>
                <div className="flex-1 space-y-1 overflow-auto">
                  {dayEvents.slice(0, 3).map((ev) => (
                    <Link
                      key={ev.id}
                      href={eventHref(ev.slug)}
                      className="block text-xs px-1.5 py-0.5 rounded truncate hover:opacity-80"
                      style={{ backgroundColor: "var(--color-section-alt)", color: "var(--color-primary)" }}
                      title={ev.title}
                    >
                      {ev.title}
                    </Link>
                  ))}
                  {dayEvents.length > 3 && (
                    <a
                      href={`#day-${key}`}
                      className="text-xs text-gray-600 px-1 hover:underline"
                      onClick={(e) => {
                        e.preventDefault();
                        showDayList(key);
                      }}
                    >
                      +{dayEvents.length - 3} more
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const navBtnClass =
    "inline-flex h-9 w-9 items-center justify-center rounded-lg border hover:bg-gray-50 transition disabled:opacity-40";

  return (
    <div className="space-y-4 w-full max-w-full">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={toggleClass(view === "list")}
            style={view === "list" ? { backgroundColor: "var(--color-primary)" } : undefined}
            onClick={() => setView("list")}
          >
            List
          </button>
          <button
            type="button"
            className={toggleClass(view === "month")}
            style={view === "month" ? { backgroundColor: "var(--color-primary)" } : undefined}
            onClick={() => setView("month")}
          >
            Month
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={prevMonth}
            className={navBtnClass}
            style={{ borderColor: "var(--color-earth)", color: "var(--color-heading)" }}
            aria-label="Previous month"
          >
            <IonIcon name="chevron-back-outline" size={18} />
          </button>
          <h2
            className="text-lg font-semibold min-w-[10.5rem] text-center"
            style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
          >
            {monthLabel}
          </h2>
          <button
            type="button"
            onClick={nextMonth}
            className={navBtnClass}
            style={{ borderColor: "var(--color-earth)", color: "var(--color-heading)" }}
            aria-label="Next month"
          >
            <IonIcon name="chevron-forward-outline" size={18} />
          </button>
          <button
            type="button"
            onClick={() => setCurrentMonth(new Date())}
            disabled={isCurrentMonth}
            className="px-3 h-9 border rounded-lg hover:bg-gray-50 transition text-sm font-medium disabled:opacity-40 disabled:hover:bg-transparent"
            style={{ borderColor: "var(--color-earth)", color: "var(--color-heading)" }}
            aria-label="This month"
          >
            Today
          </button>
        </div>
      </div>

      {fetchError ? (
        <p className="text-sm text-red-600" role="alert">
          {fetchError}
        </p>
      ) : null}

      {view === "month" ? monthGrid : eventList}
    </div>
  );
}
