"use client";

import { useState } from "react";
import {
  APPS_AIRPORT_SHOPIFY_HUB,
  APPS_AIRPORT_SHOPIFY_LISTINGS_PATH,
  shopifyAdminProductUrl,
} from "@/lib/shopify/apps-airport";
import {
  AppsAirportListingManageMenu,
  type AppsAirportManageMenuItem,
} from "@/components/apps-airport/AppsAirportListingManageMenu";

type Props = {
  storeItemId: string;
  shopDomain?: string | null;
  shopifyProductId?: string | null;
  /** @deprecated View On Shopify is a dedicated table column; kept for call-site compatibility. */
  preferStorefront?: boolean;
  onActionComplete?: (message?: string) => void;
};

export function ShopifyListingActionButtons({
  storeItemId,
  shopDomain,
  shopifyProductId,
  onActionComplete,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const adminUrl = shopifyAdminProductUrl(shopDomain, shopifyProductId);
  const editHref = `/seller-hub/store/${storeItemId}`;
  const viewOnInwHref = `${APPS_AIRPORT_SHOPIFY_LISTINGS_PATH}/${storeItemId}`;

  async function callAction(
    action: "retry" | "unpublish" | "remove",
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
