"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type AddressValue = {
  street: string;
  aptOrSuite?: string;
  city: string;
  state: string;
  zip: string;
};

type Suggestion = { description: string; placeId: string };

type AddressSearchInputProps = {
  value: AddressValue;
  onChange: (addr: AddressValue, meta?: { fromPlaces?: boolean }) => void;
  placeholder?: string;
  id?: string;
  /** When true, show manual fields as fallback if no API or no results (default true). */
  showManualFallback?: boolean;
};

const DEBOUNCE_MS = 300;

function formatAddressLine(addr: AddressValue): string {
  const parts = [addr.street, addr.city, addr.state, addr.zip].filter(Boolean);
  return parts.join(", ") || "";
}

export function AddressSearchInput({
  value,
  onChange,
  placeholder = "Search for your address",
  id,
  showManualFallback = true,
}: AddressSearchInputProps) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedFromPlaces, setSelectedFromPlaces] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const hasAddress = !!(value.street?.trim() && value.city?.trim() && value.state?.trim() && value.zip?.trim());

  const fetchSuggestions = useCallback(async (input: string) => {
    if (input.length < 3) {
      setSuggestions([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/address-autocomplete?input=${encodeURIComponent(input)}`,
        { credentials: "include" }
      );
      const data = (await res.json()) as { suggestions?: Suggestion[] };
      setSuggestions(data.suggestions ?? []);
      setShowDropdown(true);
    } catch {
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      fetchSuggestions(query);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, fetchSuggestions]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelectSuggestion = useCallback(
    async (suggestion: Suggestion) => {
      setShowDropdown(false);
      setQuery("");
      setLoading(true);
      try {
        const res = await fetch(
          `/api/address-details?placeId=${encodeURIComponent(suggestion.placeId)}`,
          { credentials: "include" }
        );
        const data = (await res.json()) as {
          street?: string;
          city?: string;
          state?: string;
          zip?: string;
          error?: string;
        };
        if (data.error || !res.ok) {
          setSuggestions([]);
          setLoading(false);
          return;
        }
        const next: AddressValue = {
          street: data.street ?? "",
          aptOrSuite: value.aptOrSuite ?? "",
          city: data.city ?? "",
          state: data.state ?? "",
          zip: data.zip ?? "",
        };
        onChange(next, { fromPlaces: true });
        setSelectedFromPlaces(true);
      } catch {
        // leave previous value
      } finally {
        setLoading(false);
      }
    },
    [onChange, value.aptOrSuite]
  );

  const handleChangeAddress = useCallback(
    (updates: Partial<AddressValue>) => {
      onChange({ ...value, ...updates }, { fromPlaces: false });
      setSelectedFromPlaces(false);
    },
    [value, onChange]
  );

  const handleClearSelection = useCallback(() => {
    onChange(
      { street: "", aptOrSuite: value.aptOrSuite ?? "", city: "", state: "", zip: "" },
      { fromPlaces: false }
    );
    setSelectedFromPlaces(false);
    setQuery("");
    setShowDropdown(false);
  }, [onChange, value.aptOrSuite]);

  if (hasAddress && !showManual && !showDropdown) {
    return (
      <div className="space-y-2">
        <div
          className="rounded border px-3 py-2 text-sm"
          style={{ borderColor: "var(--color-primary)", color: "var(--color-text)" }}
        >
          {formatAddressLine(value)}
          {value.aptOrSuite?.trim() ? `, ${value.aptOrSuite}` : ""}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleClearSelection}
            className="text-sm underline"
            style={{ color: "var(--color-primary)" }}
          >
            Change address
          </button>
          {showManualFallback && (
            <button
              type="button"
              onClick={() => setShowManual(true)}
              className="text-sm underline"
              style={{ color: "var(--color-text)" }}
            >
              Enter manually
            </button>
          }
        </div>
        {value.aptOrSuite !== undefined && (
          <input
            type="text"
            placeholder="Apartment, suite, etc. (optional)"
            value={value.aptOrSuite}
            onChange={(e) => handleChangeAddress({ aptOrSuite: e.target.value })}
            className="w-full border rounded px-3 py-2 text-sm"
            style={{ borderColor: "var(--color-primary)" }}
          />
        )}
      </div>
    );
  }

  if (showManual) {
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setShowManual(false)}
          className="text-sm underline mb-2"
          style={{ color: "var(--color-primary)" }}
        >
          Search for address instead
        </button>
        <input
          type="text"
          placeholder="Street"
          value={value.street}
          onChange={(e) => handleChangeAddress({ street: e.target.value })}
          className="w-full border rounded px-3 py-2 text-sm"
          style={{ borderColor: "var(--color-primary)" }}
        />
        <input
          type="text"
          placeholder="Apartment, suite, etc. (optional)"
          value={value.aptOrSuite ?? ""}
          onChange={(e) => handleChangeAddress({ aptOrSuite: e.target.value })}
          className="w-full border rounded px-3 py-2 text-sm"
          style={{ borderColor: "var(--color-primary)" }}
        />
        <div className="grid grid-cols-3 gap-2">
          <input
            type="text"
            placeholder="City"
            value={value.city}
            onChange={(e) => handleChangeAddress({ city: e.target.value })}
            className="border rounded px-3 py-2 text-sm"
            style={{ borderColor: "var(--color-primary)" }}
          />
          <input
            type="text"
            placeholder="State"
            value={value.state}
            onChange={(e) => handleChangeAddress({ state: e.target.value })}
            className="border rounded px-3 py-2 text-sm"
            style={{ borderColor: "var(--color-primary)" }}
          />
          <input
            type="text"
            placeholder="ZIP"
            value={value.zip}
            onChange={(e) => handleChangeAddress({ zip: e.target.value })}
            className="border rounded px-3 py-2 text-sm"
            style={{ borderColor: "var(--color-primary)" }}
          />
        </div>
      </div>
    );
  }

  return (
    <div ref={wrapperRef} className="relative space-y-2">
      <input
        id={id}
        type="text"
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          if (!e.target.value) setShowDropdown(false);
        }}
        onFocus={() => {
          if (suggestions.length > 0) setShowDropdown(true);
        }}
        className="w-full border rounded px-3 py-2 text-sm"
        style={{ borderColor: "var(--color-primary)" }}
        autoComplete="off"
      />
      {loading && (
        <p className="text-xs" style={{ color: "var(--color-text)" }}>
          Searching…
        </p>
      )}
      {showDropdown && suggestions.length > 0 && (
        <ul
          className="absolute z-10 w-full mt-1 border rounded shadow-lg max-h-60 overflow-auto"
          style={{
            borderColor: "var(--color-primary)",
            backgroundColor: "var(--color-background)",
          }}
        >
          {suggestions.map((s) => (
            <li key={s.placeId}>
              <button
                type="button"
                className="w-full text-left px-3 py-2 text-sm hover:opacity-90"
                style={{ color: "var(--color-text)" }}
                onClick={() => handleSelectSuggestion(s)}
              >
                {s.description}
              </button>
            </li>
          ))}
        </ul>
      )}
      {showManualFallback && (
        <button
          type="button"
          onClick={() => setShowManual(true)}
          className="text-sm underline"
          style={{ color: "var(--color-text)" }}
        >
          Enter address manually
        </button>
      )}
    </div>
  );
}
