"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { IonIcon } from "@/components/IonIcon";
import { formatTime12h } from "@/lib/format-time";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

const triggerClass =
  "w-full border border-gray-300 rounded px-3 py-2 text-left bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-earth)] focus:border-[var(--color-earth)] hover:border-[var(--color-earth)] flex items-center justify-between gap-2";

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseYmd(value: string): Date | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function parseTime(value: string): { hour12: number; minute: number; ampm: "AM" | "PM" } | null {
  const m = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hours = Number(m[1]);
  const minute = Number(m[2]);
  if (hours > 23 || minute > 59) return null;
  const ampm: "AM" | "PM" = hours >= 12 ? "PM" : "AM";
  let hour12 = hours % 12;
  if (hour12 === 0) hour12 = 12;
  return { hour12, minute, ampm };
}

function toTime24(hour12: number, minute: number, ampm: "AM" | "PM"): string {
  let h = hour12 % 12;
  if (ampm === "PM") h += 12;
  return `${String(h).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function optionClass(selected: boolean) {
  return selected
    ? "bg-[var(--color-earth)] text-white"
    : "text-gray-800 hover:bg-[var(--color-earth)] hover:text-white";
}

function usePopoverPosition(open: boolean, anchorRef: RefObject<HTMLElement | null>, height: number, minWidth: number) {
  const [pos, setPos] = useState({ top: 0, left: 0, width: minWidth });

  useLayoutEffect(() => {
    if (!open) return;
    function update() {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = Math.max(r.width, minWidth);
      let left = r.left;
      if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
      const spaceBelow = window.innerHeight - r.bottom;
      const top =
        spaceBelow < height && r.top > height ? r.top - height - 4 : r.bottom + 4;
      setPos({ top, left, width });
    }
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, anchorRef, height, minWidth]);

  return pos;
}

function Popover({
  open,
  onClose,
  anchorRef,
  height,
  minWidth,
  children,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  height: number;
  minWidth: number;
  children: ReactNode;
}) {
  const popRef = useRef<HTMLDivElement>(null);
  const pos = usePopoverPosition(open, anchorRef, height, minWidth);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t) || popRef.current?.contains(t)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={popRef}
      className="fixed z-[10050] rounded border border-gray-200 bg-white py-2 shadow-lg"
      style={{ top: pos.top, left: pos.left, width: pos.width }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body
  );
}

export function ThemeDateField({
  value,
  onChange,
  required,
  "aria-label": ariaLabel = "Date",
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  "aria-label"?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const selected = parseYmd(value);
  const [month, setMonth] = useState(() => selected ?? new Date());

  useEffect(() => {
    if (open) setMonth(parseYmd(value) ?? new Date());
  }, [open, value]);

  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(startDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);

  const monthLabel = month.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const today = toYmd(new Date());
  const display = selected
    ? selected.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "Select date";

  return (
    <div className={`relative ${className}`}>
      <button
        ref={btnRef}
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        className={triggerClass}
      >
        <span className={value ? "" : "text-gray-500"}>{display}</span>
        <IonIcon name="calendar-outline" size={18} className="opacity-70" />
      </button>
      {required ? (
        <input
          tabIndex={-1}
          required
          value={value}
          onChange={() => {}}
          className="absolute inset-0 opacity-0 pointer-events-none"
          aria-hidden
        />
      ) : null}
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={btnRef} height={320} minWidth={280}>
        <div className="px-2">
          <div className="flex items-center justify-between mb-2 px-1">
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded hover:bg-[var(--color-earth)] hover:text-white"
              aria-label="Previous month"
              onClick={() => setMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
            >
              <IonIcon name="chevron-back-outline" size={16} />
            </button>
            <p className="text-sm font-semibold" style={{ color: "var(--color-heading)" }}>
              {monthLabel}
            </p>
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded hover:bg-[var(--color-earth)] hover:text-white"
              aria-label="Next month"
              onClick={() => setMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
            >
              <IonIcon name="chevron-forward-outline" size={16} />
            </button>
          </div>
          <div className="grid grid-cols-7 mb-1">
            {WEEKDAYS.map((wd) => (
              <div key={wd} className="text-center text-[10px] font-semibold uppercase text-gray-500 py-1">
                {wd}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((day, idx) => {
              if (day === null) return <div key={`e-${idx}`} className="h-8" />;
              const key = toYmd(new Date(month.getFullYear(), month.getMonth(), day));
              const isSelected = key === value;
              const isToday = key === today;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    onChange(key);
                    setOpen(false);
                  }}
                  className={`h-8 w-full rounded text-sm ${optionClass(isSelected)} ${
                    isToday && !isSelected ? "ring-1 ring-[var(--color-earth)]" : ""
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      </Popover>
    </div>
  );
}

export function ThemeTimeField({
  value,
  onChange,
  placeholder = "Select time",
  "aria-label": ariaLabel = "Time",
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  "aria-label"?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const parsed = parseTime(value);

  function commit(next: Partial<{ hour12: number; minute: number; ampm: "AM" | "PM" }>) {
    const hour12 = next.hour12 ?? parsed?.hour12 ?? 12;
    const minute = next.minute ?? parsed?.minute ?? 0;
    const ampm = next.ampm ?? parsed?.ampm ?? "AM";
    onChange(toTime24(hour12, minute, ampm));
  }

  const display = value ? formatTime12h(value) : placeholder;
  const minuteOptions = MINUTES.includes(parsed?.minute ?? -1)
    ? MINUTES
    : parsed
      ? [...MINUTES, parsed.minute].sort((a, b) => a - b)
      : MINUTES;

  return (
    <div className={`relative ${className}`}>
      <button
        ref={btnRef}
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((o) => !o)}
        className={triggerClass}
      >
        <span className={value ? "" : "text-gray-500"}>{display}</span>
        <IonIcon name="time-outline" size={18} className="opacity-70" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={btnRef} height={280} minWidth={240}>
        <div className="grid grid-cols-3 gap-1 px-2 max-h-56">
          <div className="overflow-y-auto max-h-56">
            {HOURS.map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => commit({ hour12: h })}
                className={`w-full rounded px-2 py-1.5 text-sm text-center ${optionClass(parsed?.hour12 === h)}`}
              >
                {h}
              </button>
            ))}
          </div>
          <div className="overflow-y-auto max-h-56">
            {minuteOptions.map((min) => (
              <button
                key={min}
                type="button"
                onClick={() => commit({ minute: min })}
                className={`w-full rounded px-2 py-1.5 text-sm text-center ${optionClass(parsed?.minute === min)}`}
              >
                {String(min).padStart(2, "0")}
              </button>
            ))}
          </div>
          <div>
            {(["AM", "PM"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => commit({ ampm: p })}
                className={`w-full rounded px-2 py-1.5 text-sm text-center ${optionClass(parsed?.ampm === p)}`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        {value ? (
          <button
            type="button"
            className="mt-1 w-full text-xs text-gray-500 hover:text-[var(--color-earth)] px-2 py-1"
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
          >
            Clear
          </button>
        ) : null}
      </Popover>
    </div>
  );
}
