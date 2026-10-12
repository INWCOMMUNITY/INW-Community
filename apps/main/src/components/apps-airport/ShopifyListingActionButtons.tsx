"use client";

import { useState } from "react";
import {
  APPS_AIRPORT_SHOPIFY_HUB,
  shopifyAdminProductUrl,
} from "@/lib/shopify/apps-airport";
import { appsAirportInwLiveListingHref } from "@/lib/apps-airport-inw-listing-href";
import {
  AppsAirportListingManageMenu,
  type AppsAirportManageMenuItem,
} from "@/components/apps-airport/AppsAirportListingManageMenu";

type Props = {
  storeItemId: string;
  /** Storefront slug — used for View on INW. */
  slug?: string | null;
  shopDomain?: string | null;
  shopifyProductId?: string | null;
  /** @deprecated View On Shopify is a dedicated table column; kept for call-site compatibility. */
  preferStorefront?: boolean;
  onActionComplete?: (message?: string) => void;
};

export function ShopifyListingActionButtons({
  storeItemId,
  slug,
  shopDomain,
  shopifyProductId,
  onActionComplete,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const adminUrl = shopifyAdminProductUrl(shopDomain, shopifyProductId);
  const editHref = `/seller-hub/store/${storeItemId}`;
  const viewOnInwHref = appsAirportInwLiveListingHref({
    slug,
    storeItemId,
    from: "shopify-sync",
  });

  async function callAction(
    action: "retry" | "reconnect" | "unpublish" | "remove",
    extra?: { confirmDelete?: boolean },
    successMessage?: string
  ) {
    setBusy(action);
    setError(null);
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

  function onDeleteListing() {
    const choice = window.confirm(
      "Delete listing from Sync Airport?\n\n" +
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

  async function openViewOnShopify() {
    setBusy("view-shopify");
    setError(null);
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
      else setError("Shopify listing URL unavailable");
    } catch {
      if (adminUrl) window.open(adminUrl, "_blank", "noopener,noreferrer");
      else setError("Shopify listing URL unavailable");
    } finally {
      setBusy(null);
    }
  }

  const items: AppsAirportManageMenuItem[] = [
    {
      kind: "link",
      id: "edit",
      label: "Edit Listing",
      href: editHref,
    },
    {
      kind: "action",
      id: "delete",
      label: "Delete Listing",
      danger: true,
      onSelect: onDeleteListing,
    },
    {
      kind: "link",
      id: "view-inw",
      label: "View on INW",
      href: viewOnInwHref,
    },
    {
      kind: "action",
      id: "view-shopify",
      label: "View on Shopify",
      onSelect: () => void openViewOnShopify(),
    },
    {
      kind: "action",
      id: "reconnect",
      label: "Reconnect listing",
      onSelect: () =>
        void callAction(
          "reconnect",
          undefined,
          "Reconnect queued. INW will match this item to Shopify and publish it if it is still a draft."
        ),
    },
    {
      kind: "action",
      id: "reload",
      label: "Reload Sync",
      onSelect: () => void callAction("retry", undefined, "Reload queued"),
    },
    ...(adminUrl
      ? ([
          {
            kind: "external" as const,
            id: "admin",
            label: APPS_AIRPORT_SHOPIFY_HUB.openAdminLabel,
            href: adminUrl,
          },
        ] satisfies AppsAirportManageMenuItem[])
      : []),
    {
      kind: "action",
      id: "unpublish",
      label: "Unpublish",
      onSelect: () => void callAction("unpublish", undefined, "Removed from Online Store"),
    },
  ];

  return (
    <AppsAirportListingManageMenu items={items} busy={busy !== null} error={error} />
  );
}
