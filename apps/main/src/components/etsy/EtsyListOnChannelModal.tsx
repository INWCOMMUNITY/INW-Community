"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ListOnChannelProgressModal } from "@/components/apps-airport/ListOnChannelProgressModal";
import {
  emptyEtsyHowItsMadeFormValue,
  EtsyHowItsMadeFields,
  type EtsyHowItsMadeFormValue,
} from "@/components/etsy/EtsyHowItsMadeFields";
import { APPS_AIRPORT_ETSY_SETTINGS_PATH } from "@/lib/etsy/apps-airport";
import {
  buildEtsyListAttributesBody,
  validateEtsyListOnChannelForm,
} from "@/lib/etsy/list-on-channel";

type Props = {
  storeItemId: string;
  title?: string | null;
  /** When omitted, loaded from GET etsy-attributes. */
  inventoryTracking?: string | null;
  initialHowItsMade?: EtsyHowItsMadeFormValue | null;
  onClose: () => void;
  /** Called after create finishes (or already mapped). */
  onQueued?: (message?: string) => void;
};

type ProgressState = {
  enqueueStatus: "queued" | "already_mapped";
  jobId: string | null;
};

/**
 * List on Etsy popup: How it's made fields → PATCH attributes → POST create → progress popup.
 * Shipping profile stays in Sync Airport Etsy settings.
 */
export function EtsyListOnChannelModal({
  storeItemId,
  title: titleProp,
  inventoryTracking: inventoryTrackingProp,
  initialHowItsMade,
  onClose,
  onQueued,
}: Props) {
  const [title, setTitle] = useState(titleProp?.trim() || "Listing");
  const [inventoryTracking, setInventoryTracking] = useState(inventoryTrackingProp ?? null);
  const [howItsMade, setHowItsMade] = useState<EtsyHowItsMadeFormValue>(
    initialHowItsMade ?? emptyEtsyHowItsMadeFormValue()
  );
  const [loading, setLoading] = useState(!initialHowItsMade || inventoryTrackingProp == null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shippingProfileMissing, setShippingProfileMissing] = useState(false);
  const [progress, setProgress] = useState<ProgressState | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (initialHowItsMade && inventoryTrackingProp != null && titleProp) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch(`/api/store-items/${encodeURIComponent(storeItemId)}/etsy-attributes`, {
          credentials: "include",
        });
        if (!res.ok) {
          if (!cancelled) setError("Could not load Etsy details.");
          return;
        }
        const body = (await res.json()) as {
          storeItem?: {
            title?: string;
            inventoryTracking?: string | null;
            etsyWhoMade?: string | null;
            etsyWhenMade?: string | null;
            etsyIsSupply?: boolean | null;
            etsyTaxonomyId?: number | null;
          };
        };
        if (cancelled || !body.storeItem) return;
        setTitle(body.storeItem.title?.trim() || titleProp?.trim() || "Listing");
        setInventoryTracking(body.storeItem.inventoryTracking ?? null);
        if (!initialHowItsMade) {
          setHowItsMade(emptyEtsyHowItsMadeFormValue(body.storeItem));
        }
      } catch {
        if (!cancelled) setError("Could not load Etsy details.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storeItemId, initialHowItsMade, inventoryTrackingProp, titleProp]);

  async function onConfirm() {
    const validation = validateEtsyListOnChannelForm({ howItsMade, inventoryTracking });
    if (!validation.ok) {
      setError(validation.error);
      return;
    }

    setError(null);
    setShippingProfileMissing(false);
    setBusy(true);
    try {
      const attrsRes = await fetch(`/api/store-items/${encodeURIComponent(storeItemId)}/etsy-attributes`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildEtsyListAttributesBody({ howItsMade, inventoryTracking })),
      });
      if (!attrsRes.ok) {
        const attrsBody = (await attrsRes.json().catch(() => ({}))) as { error?: string };
        setError(attrsBody.error ?? "Could not save How it’s made.");
        return;
      }

      const response = await fetch("/api/etsy/listings/create", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeItemId }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        status?: string;
        error?: string;
        code?: string;
        jobId?: string;
      };
      if (!response.ok) {
        if (body.code === "SHIPPING_PROFILE_REQUIRED") {
          setShippingProfileMissing(true);
        }
        setError(
          body.error ??
            "Could not start Etsy listing. Check photos, price, and Sync Airport settings."
        );
        return;
      }
      setProgress({
        enqueueStatus: body.status === "already_mapped" ? "already_mapped" : "queued",
        jobId: body.jobId ?? null,
      });
    } catch {
      setError("Could not start Etsy listing.");
    } finally {
      setBusy(false);
    }
  }

  if (progress) {
    return (
      <ListOnChannelProgressModal
        channel="etsy"
        storeItemId={storeItemId}
        title={title}
        enqueueStatus={progress.enqueueStatus}
        jobId={progress.jobId}
        onClose={onClose}
        onFinished={(_outcome, message) => onQueued?.(message)}
      />
    );
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[10050] flex items-center justify-center p-4 bg-black/50 overflow-y-auto">
      <div
        className="relative w-full max-w-lg min-w-0 overflow-hidden rounded-[12px] bg-white p-5 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="etsy-list-on-channel-modal-title"
      >
        <h3
          id="etsy-list-on-channel-modal-title"
          className="text-lg font-semibold"
          style={{ color: "var(--color-heading)" }}
        >
          List on Etsy
        </h3>
        <p className="mt-1 break-words text-sm text-neutral-600">{title}</p>
        {loading ? (
          <p className="mt-4 text-sm text-neutral-600">Loading…</p>
        ) : (
          <div className="mt-4 min-w-0">
            <EtsyHowItsMadeFields
              value={howItsMade}
              onChange={setHowItsMade}
              madeToOrder={inventoryTracking === "made_to_order"}
              embedded
            />
          </div>
        )}
        {error ? (
          <p className="mt-3 break-words text-sm text-red-700">
            {error}
            {shippingProfileMissing ? (
              <>
                {" "}
                <Link
                  href={APPS_AIRPORT_ETSY_SETTINGS_PATH}
                  className="underline font-semibold"
                  prefetch={false}
                >
                  Open Etsy Connection Settings
                </Link>
              </>
            ) : null}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            className="btn"
            style={{ color: "#fff" }}
            disabled={busy || loading}
            onClick={() => void onConfirm()}
          >
            {busy ? "Listing…" : "Publish to Etsy"}
          </button>
          <button
            type="button"
            className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-semibold text-neutral-800 disabled:opacity-50"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
