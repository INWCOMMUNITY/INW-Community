"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { APPS_AIRPORT_ROW_ACTION_BTN_CLASS } from "@/components/apps-airport/apps-airport-row-action-btn";

export type AppsAirportManageMenuItem =
  | {
      kind: "link";
      id: string;
      label: string;
      href: string;
      danger?: boolean;
    }
  | {
      kind: "external";
      id: string;
      label: string;
      href: string;
      danger?: boolean;
    }
  | {
      kind: "action";
      id: string;
      label: string;
      onSelect: () => void;
      disabled?: boolean;
      danger?: boolean;
    };

export function AppsAirportListingManageMenu({
  items,
  busy = false,
  error = null,
}: {
  items: AppsAirportManageMenuItem[];
  busy?: boolean;
  error?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const itemClass = (danger?: boolean) =>
    `block w-full px-3 py-2 text-left text-sm hover:bg-neutral-50 disabled:opacity-50 ${
      danger ? "text-red-800 hover:bg-red-50" : ""
    }`;

  return (
    <div ref={rootRef} className="inline-flex flex-col items-stretch text-left">
      <button
        type="button"
        className={`${APPS_AIRPORT_ROW_ACTION_BTN_CLASS} self-start`}
        style={{ color: "#fff" }}
        disabled={busy}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        {busy ? "Working…" : "Manage"}
      </button>
      {open ? (
        <div
          role="menu"
          className="mt-1 min-w-[13rem] rounded-[8px] border border-neutral-200 bg-white py-1 shadow-md"
        >
          {items.map((item) => {
            if (item.kind === "link") {
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  role="menuitem"
                  className={itemClass(item.danger)}
                  style={item.danger ? undefined : { color: "var(--color-heading)" }}
                  prefetch={false}
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </Link>
              );
            }
            if (item.kind === "external") {
              return (
                <a
                  key={item.id}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  role="menuitem"
                  className={itemClass(item.danger)}
                  style={item.danger ? undefined : { color: "var(--color-heading)" }}
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </a>
              );
            }
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                className={itemClass(item.danger)}
                style={item.danger ? undefined : { color: "var(--color-heading)" }}
                disabled={busy || item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      ) : null}
      {error ? <p className="mt-1 text-xs text-red-700">{error}</p> : null}
    </div>
  );
}

/** Optional helper when a menu needs a custom footer node. */
export function AppsAirportManageMenuFooter({ children }: { children: ReactNode }) {
  return <div className="mt-1">{children}</div>;
}
