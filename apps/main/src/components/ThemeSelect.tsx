"use client";

import { useState, useRef, useEffect } from "react";

export interface ThemeSelectOption {
  value: string;
  label: string;
}

interface ThemeSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: ThemeSelectOption[] | string[];
  placeholder?: string;
  id?: string;
  "aria-label"?: string;
  className?: string;
}

export function ThemeSelect({
  value,
  onChange,
  options,
  placeholder = "All",
  id,
  "aria-label": ariaLabel,
  className = "",
}: ThemeSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const normalizedOptions: ThemeSelectOption[] = options.map((opt) =>
    typeof opt === "string" ? { value: opt, label: opt } : opt
  );

  const selectedLabel = value
    ? normalizedOptions.find((o) => o.value === value)?.label ?? value
    : placeholder;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        id={id}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((o) => !o)}
        className="w-full min-w-[120px] border border-gray-300 rounded px-3 py-2 text-left bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-secondary)] focus:border-[var(--color-secondary)] hover:border-[var(--color-secondary)] flex items-center justify-between gap-2"
      >
        <span>{selectedLabel}</span>
        <svg className="w-4 h-4 shrink-0 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={open ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} />
        </svg>
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute z-50 mt-1 w-full max-h-60 overflow-auto rounded border border-gray-200 bg-white py-1 shadow-lg"
          aria-label={ariaLabel}
        >
          <li role="option">
            <button
              type="button"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2 text-sm ${value === "" ? "bg-[var(--color-secondary)] text-white" : "text-gray-800 hover:bg-[var(--color-secondary)] hover:text-white"}`}
            >
              {placeholder}
            </button>
          </li>
          {normalizedOptions.map((opt) => (
            <li key={opt.value} role="option" aria-selected={value === opt.value}>
              <button
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-sm ${value === opt.value ? "bg-[var(--color-secondary)] text-white" : "text-gray-800 hover:bg-[var(--color-secondary)] hover:text-white"}`}
              >
                {opt.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
