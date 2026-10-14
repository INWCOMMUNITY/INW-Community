"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IonIcon } from "@/components/IonIcon";
import { ListOnChannelProgressModal } from "@/components/apps-airport/ListOnChannelProgressModal";
import { EtsyListOnChannelModal } from "@/components/etsy/EtsyListOnChannelModal";
import { ShopifyMetafieldListingDialog } from "@/components/shopify/ShopifyMetafieldListingDialog";
import {
  listedOnManageHref,
  listedOnSettingsHref,
  listedOnTipCopy,
} from "@/lib/apps-airport-listed-on-tip";
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
  manageHref: string | null;
  settingsHref: string | null;
  activeClass: string;
  /** Light brand wash for unfilled hover. */
  hoverEmptyClass: string;
}> = [
  {
    id: "inw",
    label: "INW",
    icon: "storefront-outline",
    manageHref: null,
    settingsHref: null,
    activeClass: "bg-[var(--color-earth)] text-white",
    hoverEmptyClass: "",
  },
  {
    id: "shopify",
    label: "Shopify",
    icon: "bag-handle-outline",
    manageHref: APPS_AIRPORT_SHOPIFY_PATH,
    settingsHref: listedOnSettingsHref("shopify"),
    activeClass: "bg-[var(--color-primary)] text-white",
    hoverEmptyClass:
      "hover:bg-[var(--color-primary)]/20 hover:text-[var(--color-primary)] transition-colors",
  },
  {
    id: "etsy",
    label: "Etsy",
    icon: "color-palette-outline",
    manageHref: APPS_AIRPORT_ETSY_PATH,
    settingsHref: listedOnSettingsHref("etsy"),
    activeClass: "bg-[#c99d5f] text-white",
    hoverEmptyClass: "hover:bg-[#c99d5f]/25 hover:text-[#8a6a3f] transition-colors",
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

type TipState = {
  slotId: Exclude<AppsAirportChannelId, "ebay">;
  label: string;
  mode: "listed" | "list";
  channelReady: boolean;
  manageHref: string | null;
  settingsHref: string | null;
  top: number;
  left: number;
};

/** Fixed-slot channel icons so Listed On columns align across rows. */
export function AppsAirportListedOnChannels({
  channels,
  storeItemId,
  itemTitle,
  etsyReady = false,
  shopifyReady = false,
  needsShopifyMetafields = false,
  onListed,
}: {
  channels?: AppsAirportChannelId[] | null;
  /** Required for List / Connect actions on unfilled 3rd-party slots. */
  storeItemId?: string | null;
  itemTitle?: string | null;
  /** Etsy ACTIVE connection. */
  etsyReady?: boolean;
  /** Shopify fully connected (ACTIVE + inventory ready). */
  shopifyReady?: boolean;
  /** Listing has custom options Shopify shows through metafields. */
  needsShopifyMetafields?: boolean;
  onListed?: (message?: string) => void;
}) {
  const reactId = useId();
  const tipRootId = `${reactId}-listed-tip`;
  const desktopHover = useIsDesktopHover();
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tip, setTip] = useState<TipState | null>(null);
  const [etsyModalOpen, setEtsyModalOpen] = useState(false);
  const [shopifyProgressOpen, setShopifyProgressOpen] = useState(false);
  const [shopifyMetafieldOpen, setShopifyMetafieldOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const clearCloseTimer = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const closeTip = useCallback(() => {
    clearCloseTimer();
    setTip(null);
    setActionError(null);
  }, []);

  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    closeTimer.current = setTimeout(() => {
      setTip(null);
      setActionError(null);
    }, 120);
  }, []);

  const channelReadyFor = useCallback(
    (id: Exclude<AppsAirportChannelId, "ebay">) => {
      if (id === "etsy") return etsyReady;
      if (id === "shopify") return shopifyReady;
      return true;
    },
    [etsyReady, shopifyReady]
  );

  const openTip = useCallback(
    (el: HTMLElement, slot: (typeof LISTED_ON_SLOTS)[number], listed: boolean) => {
      if (slot.id === "inw" && !listed) return;
      clearCloseTimer();
      const rect = el.getBoundingClientRect();
      setActionError(null);
      setTip({
        slotId: slot.id,
        label: slot.label,
        mode: listed ? "listed" : "list",
        channelReady: channelReadyFor(slot.id),
        manageHref:
          slot.id === "inw"
            ? null
            : slot.manageHref ?? listedOnManageHref(slot.id as "etsy" | "shopify"),
        settingsHref: slot.settingsHref,
        top: rect.top,
        left: rect.left + rect.width / 2,
      });
    },
    [channelReadyFor]
  );

  useEffect(() => () => clearCloseTimer(), []);

  // Tap-outside dismisses the thought bubble (mobile + after tap on desktop).
  useEffect(() => {
    if (!tip) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      const tipEl = document.getElementById(tipRootId);
      if (tipEl?.contains(target)) return;
      if ((target as HTMLElement).closest?.(`[data-listed-on-slot="${tip.slotId}"]`)) return;
      closeTip();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [tip, tipRootId, closeTip]);

  const active = new Set<AppsAirportChannelId>(
    Array.isArray(channels) && channels.length > 0 ? channels : ["inw"]
  );
  if (!active.has("inw")) active.add("inw");

  const title = formatSyncedWithChannels([...active]);

  function onListClick() {
    if (!tip || tip.mode !== "list") return;
    if (tip.slotId === "etsy") {
      setTip(null);
      setEtsyModalOpen(true);
      return;
    }
    if (tip.slotId === "shopify") {
      if (!storeItemId) {
        setActionError("Missing listing id");
        return;
      }
      setTip(null);
      if (needsShopifyMetafields) {
        setShopifyMetafieldOpen(true);
        return;
      }
      setShopifyProgressOpen(true);
    }
  }

  return (
    <div className="inline-grid grid-cols-4 gap-1" aria-label={`Listed On ${title}`}>
      {LISTED_ON_SLOTS.map((slot) => {
        const on = active.has(slot.id);
        const isThirdParty = slot.id === "etsy" || slot.id === "shopify";
        const canTipEmpty = !on && isThirdParty;
        const canTip = on || canTipEmpty;
        return (
          <div
            key={slot.id}
            className="relative"
            data-listed-on-slot={slot.id}
            onMouseEnter={(e) => {
              if (!desktopHover || !canTip) return;
              openTip(e.currentTarget, slot, on);
            }}
            onMouseLeave={() => {
              if (!desktopHover || !canTip) return;
              scheduleClose();
            }}
          >
            <button
              type="button"
              className={`inline-flex h-7 w-7 items-center justify-center rounded ${
                on
                  ? slot.activeClass
                  : `bg-neutral-100 text-neutral-300 ${canTipEmpty ? slot.hoverEmptyClass : ""}`
              } ${canTip ? "cursor-pointer" : "cursor-default"}`}
              aria-label={on ? `Listed On ${slot.label}` : `Not on ${slot.label}`}
              aria-expanded={tip?.slotId === slot.id}
              disabled={!canTip}
              onClick={(e) => {
                if (!canTip) return;
                // Desktop hover owns the tip; tap toggles on touch / narrow viewports.
                if (desktopHover) return;
                if (tip?.slotId === slot.id) {
                  closeTip();
                  return;
                }
                openTip(e.currentTarget, slot, on);
              }}
            >
              <IonIcon name={slot.icon} size={15} className="text-current" />
            </button>
          </div>
        );
      })}

      {tip &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            id={tipRootId}
            className="fixed z-[9999] flex -translate-x-1/2 -translate-y-full flex-col items-center pb-2"
            style={{ top: tip.top, left: tip.left }}
            onMouseEnter={() => {
              if (desktopHover) clearCloseTimer();
            }}
            onMouseLeave={() => {
              if (desktopHover) scheduleClose();
            }}
            role="tooltip"
          >
            <div className="min-w-[9.5rem] max-w-[min(16rem,calc(100vw-1.5rem))] rounded-2xl border border-neutral-200 bg-white px-3 py-2.5 shadow-lg">
              {(() => {
                const copy = listedOnTipCopy({
                  mode: tip.mode,
                  label: tip.label,
                  channelReady: tip.channelReady,
                });
                return (
                  <>
                    <p className="whitespace-nowrap text-xs font-semibold text-neutral-800">
                      {copy.title}
                    </p>
                    {tip.mode === "listed" && tip.manageHref ? (
                      <Link
                        href={tip.manageHref}
                        className="mt-2 inline-flex w-full items-center justify-center rounded-full bg-[var(--color-primary)] px-3 py-1 text-xs font-semibold text-white hover:opacity-90"
                        prefetch={false}
                      >
                        {copy.ctaLabel}
                      </Link>
                    ) : null}
                    {tip.mode === "list" && !tip.channelReady && tip.settingsHref ? (
                      <Link
                        href={tip.settingsHref}
                        className="mt-2 inline-flex w-full items-center justify-center rounded-full bg-[var(--color-primary)] px-3 py-1 text-xs font-semibold text-white hover:opacity-90"
                        prefetch={false}
                      >
                        Connect
                      </Link>
                    ) : null}
                    {tip.mode === "list" && tip.channelReady ? (
                      <button
                        type="button"
                        className="mt-2 inline-flex w-full items-center justify-center rounded-full bg-[var(--color-primary)] px-3 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
                        disabled={!storeItemId}
                        onClick={onListClick}
                      >
                        List
                      </button>
                    ) : null}
                    {actionError ? (
                      <p className="mt-2 max-w-[12rem] text-[11px] leading-snug text-red-700">
                        {actionError}
                      </p>
                    ) : null}
                  </>
                );
              })()}
            </div>
            <span
              className="mt-[-1px] h-2.5 w-2.5 rotate-45 border-b border-r border-neutral-200 bg-white"
              aria-hidden
            />
          </div>,
          document.body
        )}

      {etsyModalOpen && storeItemId ? (
        <EtsyListOnChannelModal
          storeItemId={storeItemId}
          title={itemTitle}
          onClose={() => setEtsyModalOpen(false)}
          onQueued={(message) => onListed?.(message)}
        />
      ) : null}

      {shopifyProgressOpen && storeItemId ? (
        <ListOnChannelProgressModal
          channel="shopify"
          storeItemId={storeItemId}
          title={itemTitle}
          onClose={() => setShopifyProgressOpen(false)}
          onFinished={(_outcome, message) => onListed?.(message)}
        />
      ) : null}
      <ShopifyMetafieldListingDialog
        open={shopifyMetafieldOpen}
        onCancel={() => setShopifyMetafieldOpen(false)}
        onConfirm={() => {
          setShopifyMetafieldOpen(false);
          setShopifyProgressOpen(true);
        }}
      />
    </div>
  );
}
