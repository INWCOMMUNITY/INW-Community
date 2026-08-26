"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IonIcon } from "@/components/IonIcon";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);
const PANEL_WIDTH = 580;
const VIEWPORT_PAD = 16;
const FOOTER_GAP = 16;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function todayKey(): string {
  return dateKey(new Date());
}

function parseValue(value: string): { date: string; time: string } {
  if (!value) return { date: "", time: "00:00" };
  const [date = "", time = "00:00"] = value.split("T");
  return { date, time: time.slice(0, 5) || "00:00" };
}

function formatDisplay(value: string): string {
  if (!value) return "";
  const { date, time } = parseValue(value);
  if (!date) return "";
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return "";
  const dt = new Date(y, m - 1, d);
  const dateLabel = dt.toLocaleDateString(undefined, {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  });
  const [hh, mm] = time.split(":").map(Number);
  const hour = Number.isFinite(hh) ? hh : 0;
  const minute = Number.isFinite(mm) ? mm : 0;
  const ampm = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${dateLabel} ${pad(hour12)}:${pad(minute)} ${ampm}`;
}

function monthCells(view: Date): (Date | null)[] {
  const first = new Date(view.getFullYear(), view.getMonth(), 1);
  const last = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = Array.from({ length: first.getDay() }, () => null);
  for (let day = 1; day <= last; day++) {
    cells.push(new Date(view.getFullYear(), view.getMonth(), day));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function parseClock(time: string): { hour12: number; minute: number; ampm: "AM" | "PM" } {
  const [h, m] = time.split(":").map(Number);
  const hour = Number.isFinite(h) ? h : 0;
  const minute = Number.isFinite(m) ? m : 0;
  const ampm: "AM" | "PM" = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return { hour12, minute, ampm };
}

function toTime24(hour12: number, minute: number, ampm: "AM" | "PM"): string {
  let h = hour12 % 12;
  if (ampm === "PM") h += 12;
  return `${pad(h)}:${pad(minute)}`;
}

function chipClass(selected: boolean): string {
  return selected
    ? "bg-[var(--color-earth)] text-white"
    : "text-[var(--color-heading)] hover:bg-[var(--color-earth)] hover:text-white";
}

export function ThemeDateTimeField({
  id,
  value,
  onChange,
  required,
  pickerLabel,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  required?: boolean;
  pickerLabel?: string;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: PANEL_WIDTH });
  const parsed = parseValue(value);
  const [view, setView] = useState(() => {
    if (!parsed.date) return new Date();
    const [y, m] = parsed.date.split("-").map(Number);
    return new Date(y, (m || 1) - 1, 1);
  });

  useLayoutEffect(() => {
    if (!open) return;
    function update() {
      const el = btnRef.current;
      const pop = popRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = Math.min(PANEL_WIDTH, window.innerWidth - 32);
      const height = pop?.offsetHeight ?? 340;
      let left = r.right + 48;
      if (left + width > window.innerWidth - VIEWPORT_PAD) {
        left = Math.max(VIEWPORT_PAD, window.innerWidth - width - VIEWPORT_PAD);
      }
      const footer = document.querySelector("footer");
      const footerTop = footer?.getBoundingClientRect().top;
      const floor =
        footerTop != null && footerTop < window.innerHeight
          ? footerTop - FOOTER_GAP
          : window.innerHeight - 48;
      let top = r.top - 168;
      const maxTop = floor - height;
      if (top > maxTop) top = maxTop;
      if (top < VIEWPORT_PAD) top = VIEWPORT_PAD;
      setPos({ top, left, width });
    }
    update();
    const id = requestAnimationFrame(update);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const cells = useMemo(() => monthCells(view), [view]);
  const today = todayKey();

  function pickDate(d: Date) {
    onChange(`${dateKey(d)}T${parsed.time || "00:00"}`);
  }

  function pickTime(next: Partial<{ hour12: number; minute: number; ampm: "AM" | "PM" }>) {
    const clock = parseClock(parsed.time || "00:00");
    const time = toTime24(
      next.hour12 ?? clock.hour12,
      next.minute ?? clock.minute,
      next.ampm ?? clock.ampm
    );
    onChange(`${parsed.date || today}T${time}`);
  }

  const clock = parseClock(parsed.time || "00:00");
  const now = new Date();
  const nowHour12 = now.getHours() % 12 === 0 ? 12 : now.getHours() % 12;
  const nowAmpm: "AM" | "PM" = now.getHours() >= 12 ? "PM" : "AM";
  const nowMinute = (Math.round(now.getMinutes() / 5) * 5) % 60;
  const minuteOptions = MINUTES.includes(clock.minute)
    ? MINUTES
    : [...MINUTES, clock.minute].sort((a, b) => a - b);

  return (
    <div className="relative">
      <input type="hidden" value={value} required={required} readOnly tabIndex={-1} />
      <button
        ref={btnRef}
        type="button"
        id={id}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${id}-calendar`}
        onClick={() => {
          if (!open && parsed.date) {
            const [y, m] = parsed.date.split("-").map(Number);
            setView(new Date(y, (m || 1) - 1, 1));
          }
          setOpen((v) => !v);
        }}
        className="w-full border border-gray-300 rounded px-3 py-2 text-left flex items-center justify-between gap-2 bg-white"
      >
        <span className={value ? "text-gray-900" : "text-gray-400"}>
          {formatDisplay(value) || "mm/dd/yyyy --:-- --"}
        </span>
        <IonIcon name="calendar-outline" size={18} className="text-gray-700 shrink-0" />
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={popRef}
              id={`${id}-calendar`}
              role="dialog"
              className="fixed z-[10050] rounded-xl border-2 bg-white p-4 shadow-lg"
              style={{
                top: pos.top,
                left: pos.left,
                width: pos.width,
                borderColor: "var(--color-earth)",
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {pickerLabel ? (
                <p className="text-sm font-semibold mb-3" style={{ color: "var(--color-heading)" }}>
                  {pickerLabel}
                </p>
              ) : null}
              <div className="flex gap-5 items-start">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between mb-2">
                    <button
                      type="button"
                      className="px-2 py-1 rounded hover:bg-[var(--color-section-alt)]"
                      aria-label="Previous month"
                      onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}
                    >
                      ‹
                    </button>
                    <p className="text-sm font-semibold" style={{ color: "var(--color-heading)" }}>
                      {MONTHS[view.getMonth()]} {view.getFullYear()}
                    </p>
                    <button
                      type="button"
                      className="px-2 py-1 rounded hover:bg-[var(--color-section-alt)]"
                      aria-label="Next month"
                      onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}
                    >
                      ›
                    </button>
                  </div>
                  <div className="grid grid-cols-7 gap-1 text-center text-xs text-gray-500 mb-1">
                    {WEEKDAYS.map((day, i) => (
                      <span key={`${day}-${i}`}>{day}</span>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {cells.map((day, i) => {
                      if (!day) return <span key={`empty-${i}`} className="h-10" />;
                      const key = dateKey(day);
                      const selected = key === parsed.date;
                      const isToday = key === today;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => pickDate(day)}
                          className={`h-10 rounded-full text-sm leading-none transition-colors ${
                            selected ? "text-white" : "hover:bg-[var(--color-earth)] hover:text-white"
                          }`}
                          style={{
                            backgroundColor: selected ? "var(--color-earth)" : "transparent",
                            color: selected ? "#fff" : "var(--color-heading)",
                            boxShadow: isToday ? "inset 0 0 0 2px var(--color-section-alt)" : undefined,
                          }}
                        >
                          {day.getDate()}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="shrink-0">
                  <p className="mb-1 text-xs font-medium text-gray-700">Time</p>
                  <div className="flex gap-2">
                    <div className="w-[4.75rem] max-h-56 overflow-y-auto">
                      {HOURS.map((h) => (
                        <button
                          key={h}
                          type="button"
                          onClick={() => pickTime({ hour12: h })}
                          className={`w-full rounded px-2 py-1.5 text-sm ${chipClass(clock.hour12 === h)} ${
                            h === nowHour12 ? "ring-2 ring-inset ring-[var(--color-section-alt)]" : ""
                          }`}
                        >
                          {h}
                        </button>
                      ))}
                    </div>
                    <div className="w-[4.75rem] max-h-56 overflow-y-auto">
                      {minuteOptions.map((min) => (
                        <button
                          key={min}
                          type="button"
                          onClick={() => pickTime({ minute: min })}
                          className={`w-full rounded px-2 py-1.5 text-sm ${chipClass(clock.minute === min)} ${
                            min === nowMinute ? "ring-2 ring-inset ring-[var(--color-section-alt)]" : ""
                          }`}
                        >
                          {pad(min)}
                        </button>
                      ))}
                    </div>
                    <div className="w-12">
                      {(["AM", "PM"] as const).map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => pickTime({ ampm: p })}
                          className={`w-full rounded px-1 py-1.5 text-sm ${chipClass(clock.ampm === p)} ${
                            p === nowAmpm ? "ring-2 ring-inset ring-[var(--color-section-alt)]" : ""
                          }`}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
