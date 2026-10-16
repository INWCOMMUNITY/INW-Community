"use client";

import { useEffect, useState } from "react";

export type EndListingPlace = "inw" | "etsy" | "shopify";

export type EndListingOption = {
  id: EndListingPlace;
  label: string;
  detail: string;
};

type Props = {
  open: boolean;
  listingCount: number;
  options: EndListingOption[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: (places: EndListingPlace[]) => void;
};

export function EndListingsDialog({
  open,
  listingCount,
  options,
  busy,
  onCancel,
  onConfirm,
}: Props) {
  const [selected, setSelected] = useState<EndListingPlace[]>([]);

  useEffect(() => {
    if (open) setSelected([]);
  }, [open]);

  if (!open) return null;

  const title =
    listingCount === 1 ? "End listing" : `End ${listingCount} listings`;

  function toggle(id: EndListingPlace) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/50">
      <div
        className="w-full max-w-sm rounded-[12px] bg-white p-6 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="end-listings-title"
      >
        <h3
          id="end-listings-title"
          className="text-lg font-semibold"
          style={{ color: "var(--color-heading)" }}
        >
          {title}
        </h3>
        <p className="mt-1 text-sm text-neutral-600">
          Choose each place to end. Unchecked places stay live.
        </p>
        <ul className="mt-4 space-y-2">
          {options.map((option) => {
            const checked = selected.includes(option.id);
            return (
              <li key={option.id}>
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-neutral-200 px-3 py-2 hover:bg-neutral-50">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-neutral-300"
                    checked={checked}
                    disabled={busy}
                    onChange={() => toggle(option.id)}
                  />
                  <span>
                    <span className="block text-sm font-semibold text-neutral-900">{option.label}</span>
                    <span className="block text-xs text-neutral-600">{option.detail}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            className="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-semibold text-neutral-800 disabled:opacity-50"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="flex-1 rounded-md bg-[var(--color-earth)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={busy || selected.length === 0}
            onClick={() => onConfirm(selected)}
          >
            {busy ? "Ending…" : "End selected"}
          </button>
        </div>
      </div>
    </div>
  );
}
