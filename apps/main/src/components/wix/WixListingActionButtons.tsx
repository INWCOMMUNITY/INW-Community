"use client";

import { useState } from "react";
import {
  APPS_AIRPORT_WIX_LISTINGS_PATH,
  APPS_AIRPORT_WIX_SYNC_PATH,
} from "@/lib/wix/apps-airport";
import {
  AppsAirportListingManageMenu,
  type AppsAirportManageMenuItem,
} from "@/components/apps-airport/AppsAirportListingManageMenu";

type Props = {
  storeItemId: string;
  listingLinkId?: string | null;
  wixProductId?: string | null;
  remoteProductVisible?: boolean | null;
  onActionComplete?: (message?: string) => void;
};

export function WixListingActionButtons({
  storeItemId,
  listingLinkId,
  wixProductId,
  remoteProductVisible,
  onActionComplete,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const live = Boolean(wixProductId) && remoteProductVisible !== false;
  const editHref = `/seller-hub/store/${storeItemId}`;

  async function reconcile() {
    if (!listingLinkId) return;
    setBusy("reconcile");
    setError(null);
    try {
      const response = await fetch("/api/wix/listing/reconcile", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingLinkId }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? "Could not reconcile listing");
        return;
      }
      onActionComplete?.("Reconcile queued");
    } catch {
      setError("Could not reconcile listing");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!listingLinkId) return;
    const ok = window.confirm(
      "Remove from Wix sync?\n\nThis deletes the product on Wix when possible and unlinks it in INW. The INW listing stays."
    );
    if (!ok) return;
    setBusy("remove");
    setError(null);
    try {
      const response = await fetch("/api/wix/listing/remove", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingLinkId }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? "Could not remove listing");
        return;
      }
      onActionComplete?.("Removed from Wix");
    } catch {
      setError("Could not remove listing");
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
      kind: "link",
      id: "view-linked",
      label: "View linked listings",
      href: APPS_AIRPORT_WIX_LISTINGS_PATH,
    },
  ];

  if (listingLinkId) {
    items.push({
      kind: "action",
      id: "reconcile",
      label: "Reload Sync",
      onSelect: () => void reconcile(),
    });
    items.push({
      kind: "action",
      id: "remove",
      label: "Remove from Wix",
      danger: true,
      onSelect: () => void remove(),
    });
  }

  if (!live) {
    items.push({
      kind: "link",
      id: "finish-list",
      label: "Finish List on Wix",
      href: APPS_AIRPORT_WIX_SYNC_PATH,
    });
  }

  return (
    <AppsAirportListingManageMenu
      items={items}
      busy={busy !== null}
      error={error}
    />
  );
}
