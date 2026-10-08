"use client";

import { useState } from "react";
import {
  APPS_AIRPORT_ETSY_LISTINGS_PATH,
  APPS_AIRPORT_ETSY_SYNC_PATH,
  etsyListingIsPubliclyViewable,
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

type ConfirmStep = null | "unlink" | "deleteRemote";

export function EtsyListingActionButtons({
  storeItemId,
  etsyListingId,
  remoteListingState,
  onActionComplete,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmStep, setConfirmStep] = useState<ConfirmStep>(null);

  const live = etsyListingIsPubliclyViewable(remoteListingState);
  const editHref = `/seller-hub/store/${storeItemId}`;

  async function callAction(
    action: "retry" | "remove",
    extra?: { confirmDelete?: boolean }
  ) {
    setBusy(action);
    setError(null);
    setConfirmStep(null);
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
      disabled: busy !== null,
      onSelect: () => {
        setError(null);
        setConfirmStep("unlink");
      },
    },
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
    <div className="inline-flex flex-col items-stretch gap-1 text-left">
      <AppsAirportListingManageMenu items={items} busy={busy !== null} error={error} />
      {confirmStep === "unlink" ? (
        <div className="max-w-[16rem] rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-950">
          <p className="font-semibold">Remove from Etsy sync?</p>
          <p className="mt-1 text-red-900/90">
            Unlinks this INW listing from Etsy. Your INW listing stays.
            {etsyListingId ? ` Etsy #${etsyListingId}.` : ""}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md bg-red-800 px-2 py-1 font-semibold text-white disabled:opacity-50"
              disabled={busy !== null}
              onClick={() => setConfirmStep("deleteRemote")}
            >
              Continue
            </button>
            <button
              type="button"
              className="rounded-md border border-neutral-300 bg-white px-2 py-1 font-semibold text-neutral-800 disabled:opacity-50"
              disabled={busy !== null}
              onClick={() => setConfirmStep(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {confirmStep === "deleteRemote" ? (
        <div className="max-w-[16rem] rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950">
          <p className="font-semibold">Also delete on Etsy?</p>
          <p className="mt-1 text-amber-900/90">
            INW will unlink either way. Deleting on Etsy is best-effort (active listings may need
            deactivation first).
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md bg-red-800 px-2 py-1 font-semibold text-white disabled:opacity-50"
              disabled={busy !== null}
              onClick={() => void callAction("remove", { confirmDelete: true })}
            >
              {busy === "remove" ? "Removing…" : "Unlink + delete on Etsy"}
            </button>
            <button
              type="button"
              className="rounded-md bg-[var(--color-earth)] px-2 py-1 font-semibold text-white disabled:opacity-50"
              disabled={busy !== null}
              onClick={() => void callAction("remove", { confirmDelete: false })}
            >
              {busy === "remove" ? "Removing…" : "Unlink only"}
            </button>
            <button
              type="button"
              className="rounded-md border border-neutral-300 bg-white px-2 py-1 font-semibold text-neutral-800 disabled:opacity-50"
              disabled={busy !== null}
              onClick={() => setConfirmStep(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
