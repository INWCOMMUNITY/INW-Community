"use client";

import { useState } from "react";
import {
  APPS_AIRPORT_ETSY_HUB,
  APPS_AIRPORT_ETSY_LISTINGS_PATH,
  APPS_AIRPORT_ETSY_SYNC_PATH,
  etsyListingIsPubliclyViewable,
  etsyListingPublicUrl,
} from "@/lib/etsy/apps-airport";
import {
  AppsAirportListingManageMenu,
  type AppsAirportManageMenuItem,
} from "@/components/apps-airport/AppsAirportListingManageMenu";

type Props = {
  storeItemId: string;
  etsyListingId?: string | null;
  remoteListingState?: string | null;
  onActionComplete?: (message?: string) => void;
};

export function EtsyListingActionButtons({
  storeItemId,
  etsyListingId,
  remoteListingState,
  onActionComplete,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const live = etsyListingIsPubliclyViewable(remoteListingState);
  const publicUrl = etsyListingPublicUrl({ etsyListingId, remoteListingState });
  const editHref = `/seller-hub/store/${storeItemId}`;

  async function callAction(
    action: "retry" | "remove",
    extra?: { confirmDelete?: boolean }
  ) {
    setBusy(action);
    setError(null);
    try {
      const response = await fetch(`/api/etsy/listings/${encodeURIComponent(storeItemId)}/actions`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      let body: { error?: string; message?: string | null; ok?: boolean } = {};
      try {
        body = (await response.json()) as typeof body;
      } catch {
        setError(`Action failed (HTTP ${response.status})`);
        return;
      }
      if (!response.ok) {
        setError(body.error?.trim() || `Action failed (HTTP ${response.status})`);
        return;
      }
      onActionComplete?.(body.message?.trim() || undefined);
    } catch {
      setError("Action failed — network error");
    } finally {
      setBusy(null);
    }
  }

  function onRemoveFromEtsy() {
    const unlink = window.confirm(
      "Remove from Etsy sync?\n\n" +
        "This unlinks the INW listing from Etsy (INW listing stays).\n\n" +
        "• OK — continue\n" +
        "• Cancel — keep the link"
    );
    if (!unlink) return;
    const alsoDelete = window.confirm(
      "Also try to delete the listing on Etsy?\n\n" +
        "• OK — deactivate/delete on Etsy when allowed, then unlink in INW\n" +
        "• Cancel — only unlink in INW (Etsy listing stays)"
    );
    void callAction("remove", { confirmDelete: alsoDelete });
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
      id: "remove",
      label: "Remove from Etsy",
      danger: true,
      onSelect: onRemoveFromEtsy,
    },
    ...(publicUrl
      ? ([
          {
            kind: "external" as const,
            id: "view-etsy",
            label: APPS_AIRPORT_ETSY_HUB.viewOnChannelLabel,
            href: publicUrl,
          },
        ] satisfies AppsAirportManageMenuItem[])
      : []),
    {
      kind: "link",
      id: "view-linked",
      label: "View linked listings",
      href: APPS_AIRPORT_ETSY_LISTINGS_PATH,
    },
    ...(!live
      ? ([
          {
            kind: "link" as const,
            id: "finish-list",
            label: "Finish List on Etsy",
            href: APPS_AIRPORT_ETSY_SYNC_PATH,
          },
          {
            kind: "action" as const,
            id: "retry",
            label: "Retry publish",
            onSelect: () => void callAction("retry"),
          },
        ] satisfies AppsAirportManageMenuItem[])
      : []),
  ];

  return (
    <AppsAirportListingManageMenu items={items} busy={busy !== null} error={error} />
  );
}
