"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { shopifyAdminProductUrl } from "@/lib/shopify/apps-airport";

type Props = {
  storeItemId: string;
  shopDomain?: string | null;
  shopifyProductId?: string | null;
  /** When true, resolve storefront URL first for View. */
  preferStorefront?: boolean;
  onActionComplete?: (message?: string) => void;
};

export function ShopifyListingActionButtons({
  storeItemId,
  shopDomain,
  shopifyProductId,
  preferStorefront = false,
  onActionComplete,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const adminUrl = shopifyAdminProductUrl(shopDomain, shopifyProductId);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function callAction(
    action: "retry" | "unpublish" | "remove",
    extra?: { confirmDelete?: boolean },
    successMessage?: string
  ) {
    setBusy(action);
    setError(null);
    setOpen(false);
    try {
      const response = await fetch(`/api/shopify/listings/${storeItemId}/actions`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const body = (await response.json()) as { error?: string; ok?: boolean };
      if (!response.ok) {
        setError(body.error ?? "Action failed");
        return;
      }
      onActionComplete?.(successMessage);
    } catch {
      setError("Action failed");
    } finally {
      setBusy(null);
    }
  }

  async function onViewShopify() {
    setBusy("view");
    setError(null);
    setOpen(false);
    try {
      const response = await fetch(`/api/shopify/listings/${storeItemId}/view-url`, {
        credentials: "include",
      });
      if (response.ok) {
        const body = (await response.json()) as {
          primaryUrl?: string | null;
          storefrontUrl?: string | null;
          adminUrl?: string | null;
        };
        const url = body.primaryUrl || body.storefrontUrl || body.adminUrl || adminUrl;
        if (url) {
          window.open(url, "_blank", "noopener,noreferrer");
          return;
        }
      }
      if (adminUrl) window.open(adminUrl, "_blank", "noopener,noreferrer");
      else setError("Could not open Shopify product");
    } catch {
      if (adminUrl) window.open(adminUrl, "_blank", "noopener,noreferrer");
      else setError("Could not open Shopify product");
    } finally {
      setBusy(null);
    }
  }

  function onRemove() {
    const choice = window.confirm(
      "Remove this listing from Apps Airport?\n\n" +
        "• OK — Unpublish from Online Store and remove the INW ↔ Shopify link. The product stays in Shopify Admin.\n" +
        "• Cancel — keep the mapping."
    );
    if (!choice) return;
    const alsoDelete = window.confirm(
      "Also delete the product from Shopify Admin?\n\n" +
        "• OK — permanently delete the Shopify product.\n" +
        "• Cancel — only remove the INW mapping (recommended)."
    );
    void callAction(
      "remove",
      { confirmDelete: alsoDelete },
      alsoDelete ? "Mapping removed and Shopify product deleted" : "Mapping removed"
    );
  }

  return (
    <div ref={rootRef} className="relative inline-block text-left">
      <button
        type="button"
        className="btn border border-neutral-300 bg-white hover:bg-neutral-50 text-sm py-1.5 px-3 disabled:opacity-50"
        style={{ color: "var(--color-heading)" }}
        disabled={busy !== null}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        {busy ? "Working…" : "Manage"}
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 min-w-[12rem] rounded-[8px] border border-neutral-200 bg-white py-1 shadow-md"
        >
          <Link
            href={`/seller-hub/store/${storeItemId}`}
            role="menuitem"
            className="block px-3 py-2 text-sm hover:bg-neutral-50"
            style={{ color: "var(--color-heading)" }}
            prefetch={false}
            onClick={() => setOpen(false)}
          >
            Edit in INW
          </Link>
          <button
            type="button"
            role="menuitem"
            className="block w-full px-3 py-2 text-left text-sm hover:bg-neutral-50 disabled:opacity-50"
            style={{ color: "var(--color-heading)" }}
            disabled={busy !== null}
            onClick={() => void onViewShopify()}
          >
            {preferStorefront ? "View on store" : "View on Shopify"}
          </button>
          {adminUrl && preferStorefront ? (
            <a
              href={adminUrl}
              target="_blank"
              rel="noopener noreferrer"
              role="menuitem"
              className="block px-3 py-2 text-sm hover:bg-neutral-50"
              style={{ color: "var(--color-heading)" }}
              onClick={() => setOpen(false)}
            >
              Open in Shopify Admin
            </a>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className="block w-full px-3 py-2 text-left text-sm hover:bg-neutral-50 disabled:opacity-50"
            style={{ color: "var(--color-heading)" }}
            disabled={busy !== null}
            onClick={() => void callAction("retry", undefined, "Retry queued")}
          >
            Retry sync
          </button>
          <button
            type="button"
            role="menuitem"
            className="block w-full px-3 py-2 text-left text-sm hover:bg-neutral-50 disabled:opacity-50"
            style={{ color: "var(--color-heading)" }}
            disabled={busy !== null}
            onClick={() =>
              void callAction("unpublish", undefined, "Removed from Online Store")
            }
          >
            Unpublish
          </button>
          <button
            type="button"
            role="menuitem"
            className="block w-full px-3 py-2 text-left text-sm text-red-800 hover:bg-red-50 disabled:opacity-50"
            disabled={busy !== null}
            onClick={onRemove}
          >
            Remove…
          </button>
        </div>
      ) : null}
      {error ? <p className="mt-1 text-xs text-red-700">{error}</p> : null}
    </div>
  );
}
