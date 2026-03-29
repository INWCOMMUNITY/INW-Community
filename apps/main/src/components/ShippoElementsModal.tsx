"use client";

import { useEffect, useId, useLayoutEffect, useRef } from "react";
import { clearShippoElementsMount } from "@/lib/shippo-mount-utils";

export type ShippoElementsPresentation = "modal" | "page";

type Props = {
  open: boolean;
  onClose: () => void;
  /** DOM id for Shippo `labelPurchase("#…")` — must be unique per page. */
  containerId: string;
  title?: string;
  presentation: ShippoElementsPresentation;
  /** Shown under the title in page mode (e.g. buyer progress). */
  subtitle?: string | null;
};

/**
 * Mount point for Shippo Embeddable: centered modal overlay, or full-viewport in-page surface (no dimmed backdrop).
 */
export function ShippoElementsSurface({
  open,
  onClose,
  containerId,
  title = "Purchase label",
  presentation,
  subtitle,
}: Props) {
  const titleId = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  /**
   * When `open` becomes false we return `null`, so the mount node unmounts before `useEffect`
   * can clear it via ref — Shippo iframes may linger. Clear by id on close / unmount.
   */
  useLayoutEffect(() => {
    if (!open) return;
    return () => {
      clearShippoElementsMount(containerId);
    };
  }, [open, containerId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  const mountClass =
    presentation === "modal"
      ? "shippo-modal-elements-root min-h-[min(70vh,720px)] w-full min-w-0"
      : "shippo-page-elements-root min-h-[min(72dvh,820px)] w-full min-w-0 flex-1";

  const inner = (
    <>
      <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-4 py-3 sm:px-6">
        <div className="min-w-0 pr-2">
          <h2 id={titleId} className="text-lg font-semibold truncate" style={{ color: "var(--color-heading)" }}>
            {title}
          </h2>
          {presentation === "page" && subtitle ? (
            <p className="text-sm text-gray-500 mt-0.5 truncate">{subtitle}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 shrink-0"
          aria-label="Close"
        >
          <span className="text-2xl leading-none" aria-hidden>
            ×
          </span>
        </button>
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div
          ref={containerRef}
          id={containerId}
          className={mountClass}
          aria-hidden="true"
        />
      </div>
    </>
  );

  if (presentation === "modal") {
    return (
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <button
          type="button"
          className="absolute inset-0 bg-black/50"
          aria-label="Close dialog"
          onClick={onClose}
        />
        <div
          className="relative z-[101] flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-[var(--color-background)] shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {inner}
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[90] flex flex-col overflow-hidden bg-[var(--color-background)]"
      role="region"
      aria-labelledby={titleId}
    >
      {inner}
    </div>
  );
}

/** @deprecated Prefer ShippoElementsSurface with presentation="modal". */
export function ShippoElementsModal({
  open,
  onClose,
  containerId,
  title = "Purchase label",
}: Omit<Props, "presentation" | "subtitle">) {
  return (
    <ShippoElementsSurface
      open={open}
      onClose={onClose}
      containerId={containerId}
      title={title}
      presentation="modal"
    />
  );
}
