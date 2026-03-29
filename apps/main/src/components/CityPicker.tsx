"use client";

import { useState, useRef, useEffect } from "react";
import { PREBUILT_CITIES, filterPrebuiltCities } from "@/lib/prebuilt-cities";
import { normalizeResidentCity } from "@/lib/city-utils";

interface CityPickerProps {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  placeholder?: string;
  className?: string;
  id?: string;
}

export function CityPicker({
  value,
  onChange,
  required = false,
  placeholder = "Search or select city",
  className = "",
  id,
}: CityPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  const isPrebuilt = value && PREBUILT_CITIES.includes(value as any);
  const showCustom = value && !isPrebuilt;
  const filtered = filterPrebuiltCities(search);
  const showList = open && (search.length > 0 || filtered.length > 0);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleSelect(city: string) {
    onChange(city);
    setSearch("");
    setOpen(false);
    setFocusedIndex(-1);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setSearch(v);
    setOpen(true);
    setFocusedIndex(-1);
  }

  function handleFocus() {
    setOpen(true);
    setSearch(value || "");
  }

  function handleBlur() {
    setOpen(false);
    setFocusedIndex(-1);
    if (search.trim()) {
      const matches = filterPrebuiltCities(search);
      const exact = matches.find((c) => c.toLowerCase() === search.trim().toLowerCase());
      onChange(normalizeResidentCity(exact ?? search.trim()));
    }
    setSearch("");
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!showList) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIndex((i) => (i < filtered.length ? i + 1 : i));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIndex((i) => (i > 0 ? i - 1 : -1));
    } else if (e.key === "Enter" && focusedIndex >= 0 && filtered[focusedIndex]) {
      e.preventDefault();
      handleSelect(filtered[focusedIndex]);
    } else if (e.key === "Escape") {
      setOpen(false);
      setFocusedIndex(-1);
    }
  }

  const displayValue = open ? search : (value || "");

  return (
    <div ref={containerRef} className="relative">
      <input
        id={id}
        type="text"
        value={displayValue}
        onChange={handleInputChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        required={required}
        placeholder={placeholder}
        autoComplete="off"
        className={className}
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls="city-listbox"
        role="combobox"
      />
      {showList && (
        <ul
          id="city-listbox"
          role="listbox"
          className="absolute z-10 mt-1 w-full max-h-48 overflow-auto border rounded bg-white shadow-lg py-1"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-gray-500">
              No matching city. Type and blur to use custom city.
            </li>
          ) : (
            filtered.map((city, i) => (
              <li
                key={city}
                role="option"
                aria-selected={focusedIndex === i}
                className={`px-3 py-2 text-sm cursor-pointer ${
                  focusedIndex === i ? "bg-gray-100" : "hover:bg-gray-50"
                }`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleSelect(city);
                }}
              >
                {city}
              </li>
            ))
          )}
          <li className="px-3 py-2 text-sm text-gray-500 border-t mt-1 pt-1">
            Or type your city name and blur to use it.
          </li>
        </ul>
      )}
    </div>
  );
}
