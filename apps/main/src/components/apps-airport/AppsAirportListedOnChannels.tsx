"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IonIcon } from "@/components/IonIcon";
import {
  APPS_AIRPORT_SHOPIFY_PATH,
  formatSyncedWithChannels,
  type AppsAirportChannelId,
} from "@/lib/shopify/apps-airport";
import { APPS_AIRPORT_ETSY_PATH } from "@/lib/etsy/apps-airport";

const LISTED_ON_SLOTS: Array<{
  id: Exclude<AppsAirportChannelId, "ebay">;
  label: string;
  icon: string;
  /** Specific Sync Airport channel hub (3rd parties only). */
  manageHref: string | null;
  activeClass: string;
}> = [
  {
    id: "inw",
    label: "INW",
    icon: "storefront-outline",
    manageHref: null,
    activeClass: "bg-[var(--color-earth)] text-white",
  },
  {
    id: "shopify",
    label: "Shopify",
    icon: "bag-handle-outline",
    manageHref: APPS_AIRPORT_SHOPIFY_PATH,
    activeClass: "bg-[var(--color-primary)] text-white",
  },
  {
    id: "etsy",
    label: "Etsy",
    icon: "color-palette-outline",
    manageHref: APPS_AIRPORT_ETSY_PATH,
    activeClass: "bg-[#c99d5f] text-white",
  },
];

function useIsDesktopHover() {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px) and (hover: hover)");
    const sync = () => setOk(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return ok;
}

/** Fixed-slot channel icons so Listed On columns align across rows. */
export function AppsAirportListedOnChannels({
  channels,
}: {
  channels?: AppsAirportChannelId[] | null;
}) {
  const reactId = useId();
  const desktopHover = useIsDesktopHover();
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tip, setTip] = useState<{
    slotId: string;
    label: string;
    manageHref: string | null;
    top: number;
    left: number;
  } | null>(null);

  const clearCloseTimer = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    closeTimer.current = setTimeout(() => setTip(null), 120);
  }, []);

  const openTip = useCallback(
    (
      el: HTMLElement,
      slot: (typeof LISTED_ON_SLOTS)[number]
    ) => {
      if (!desktopHover) return;
      clearCloseTimer();
      const rect = el.getBoundingClientRect();
      setTip({
        slotId: slot.id,
        label: slot.label,
        manageHref: slot.manageHref,
        top: rect.top,
        left: rect.left + rect.width / 2,
      });
    },
    [desktopHover]
  );

  useEffect(() => () => clearCloseTimer(), []);

  const active = new Set<AppsAirportChannelId>(
    Array.isArray(channels) && channels.length > 0 ? channels : ["inw"]
  );
  if (!active.has("inw")) active.add("inw");

  const title = formatSyncedWithChannels([...active]);

  return (
    <div className="inline-grid grid-cols-4 gap-1" aria-label={`Listed On ${title}`}>
      {LISTED_ON_SLOTS.map((slot) => {
        const on = active.has(slot.id);
        return (
          <div
            key={slot.id}
            className="relative"
            onMouseEnter={(e) => {
              if (!on) return;
              openTip(e.currentTarget, slot);
            }}
            onMouseLeave={() => {
              if (!on) return;
              scheduleClose();
            }}
          >
            <span
              className={`inline-flex h-7 w-7 items-center justify-center rounded ${
                on ? slot.activeClass : "bg-neutral-100 text-neutral-300"
              }`}
              aria-label={on ? `Listed On ${slot.label}` : `Not on ${slot.label}`}
            >
              <IonIcon name={slot.icon} size={15} className="text-current" />
            </span>
          </div>
        );
      })}

      {tip &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            id={`${reactId}-listed-tip`}
            className="fixed z-[9999] flex -translate-x-1/2 -translate-y-full flex-col items-center pb-2"
            style={{ top: tip.top, left: tip.left }}
            onMouseEnter={clearCloseTimer}
            onMouseLeave={scheduleClose}
            role="tooltip"
          >
            <div className="rounded-2xl border border-neutral-200 bg-white px-3 py-2.5 shadow-lg">
              <p className="whitespace-nowrap text-xs font-semibold text-neutral-800">
                Listed on {tip.label}
              </p>
              {tip.manageHref ? (
                <Link
                  href={tip.manageHref}
                  className="mt-2 inline-flex w-full items-center justify-center rounded-full bg-[var(--color-primary)] px-3 py-1 text-xs font-semibold text-white hover:opacity-90"
                >
                  Manage
                </Link>
              ) : null}
            </div>
            <span
              className="mt-[-1px] h-2.5 w-2.5 rotate-45 border-b border-r border-neutral-200 bg-white"
              aria-hidden
            />
          </div>,
          document.body
        )}
    </div>
  );
}
