"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { HeartSaveButton } from "@/components/HeartSaveButton";
import { formatTime12h } from "@/lib/format-time";

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

export function CalendarView({ calendarType }: { calendarType: string }) {
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  const from = useMemo(() => startOfMonth(currentMonth), [currentMonth]);
  const to = useMemo(() => endOfMonth(currentMonth), [currentMonth]);

  useEffect(() => {
    setLoading(true);
    fetch(
      `/api/events?calendarType=${encodeURIComponent(calendarType)}&from=${from.toISOString()}&to=${to.toISOString()}`
    )
      .then((r) => r.json())
      .then((d) => {
        setEvents(Array.isArray(d) ? d : []);
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

  const eventsByDay = useMemo(() => {
    const map: Record<string, EventItem[]> = {};
    for (const ev of events) {
      const key = toDateKey(new Date(ev.date));
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

  return (
    <div className="space-y-6 w-full max-w-full">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 max-md:items-center max-md:justify-center">
        <h3 className="text-xl font-semibold">{monthLabel}</h3>
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={prevMonth}
            className="px-3 py-1.5 border rounded-lg hover:bg-gray-100 transition text-sm font-medium"
            aria-label="Previous month"
          >
            ← Previous
          </button>
          <button
            type="button"
            onClick={() => setCurrentMonth(new Date())}
            className="px-3 py-1.5 border rounded-lg hover:bg-gray-100 transition text-sm font-medium"
            aria-label="This month"
          >
            Today
          </button>
          <button
            type="button"
            onClick={nextMonth}
            className="px-3 py-1.5 border rounded-lg hover:bg-gray-100 transition text-sm font-medium"
            aria-label="Next month"
          >
            Next →
          </button>
        </div>
      </div>

      <div className="border-2 border-[var(--color-primary)] rounded-xl overflow-hidden bg-white">
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
              if (day === null) {
                return (
                  <div
                    key={`empty-${idx}`}
                    className="min-h-[160px] sm:min-h-[200px] border-b border-r border-gray-200 bg-gray-50/50 last:border-r-0"
                  />
                );
              }
              const key = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const dayEvents = eventsByDay[key] ?? [];
              const isToday = key === todayKey;
              return (
                <div
                  key={key}
                  className={`min-h-[160px] sm:min-h-[200px] border-b border-r border-gray-200 p-1 last:border-r-0 flex flex-col ${
                    isToday ? "opacity-90" : ""
                  }`}
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
                        href={`/events/${ev.slug}`}
                        className="block text-xs px-1.5 py-0.5 rounded truncate hover:opacity-80"
                        style={{ backgroundColor: "var(--color-section-alt)", color: "var(--color-primary)" }}
                        title={ev.title}
                      >
                        {ev.title}
                      </Link>
                    ))}
                    {dayEvents.length > 3 && (
                      <span className="text-xs text-gray-500 px-1">
                        +{dayEvents.length - 3} more
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <h3 className="text-lg font-semibold mb-3">Events this month</h3>
        {events.length === 0 ? (
          <p className="text-gray-500">No events in this calendar for {monthLabel}.</p>
        ) : (
          <ul className="space-y-3">
            {events.map((ev) => {
              const dateStr = new Date(ev.date).toLocaleDateString("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
              });
              return (
                <li
                  key={ev.id}
                  className="border-2 border-[var(--color-primary)] rounded-lg p-4 transition bg-white relative"
                >
                  <div className="absolute top-3 right-3">
                    <HeartSaveButton
                      type="event"
                      referenceId={ev.id}
                      initialSaved={savedIds.has(ev.id)}
                    />
                  </div>
                  <Link href={`/events/${ev.slug}`} className="block">
                    <h4 className="font-bold">{ev.title}</h4>
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
                  <Link
                    href={`/events/${ev.slug}`}
                    className="btn mt-2 inline-block text-sm"
                  >
                    Details
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
