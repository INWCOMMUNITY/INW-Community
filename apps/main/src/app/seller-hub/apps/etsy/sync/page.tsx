"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AppsAirportChrome } from "@/components/apps-airport/AppsAirportChrome";
import {
  emptyEtsyHowItsMadeFormValue,
  EtsyHowItsMadeFields,
  type EtsyHowItsMadeFormValue,
} from "@/components/etsy/EtsyHowItsMadeFields";
import {
  APPS_AIRPORT_ETSY_LISTINGS_PATH,
  APPS_AIRPORT_ETSY_PATH,
  APPS_AIRPORT_ETSY_SETTINGS_PATH,
  APPS_AIRPORT_ETSY_SYNC_PATH,
  etsySyncProgressLabel,
  etsySyncProgressPercent,
  formatEtsyCents,
  resolveEtsySyncProgress,
  type EtsySyncProgressStep,
} from "@/lib/etsy/apps-airport";

type EligibleListing = {
  storeItemId: string;
  title: string;
  slug: string;
  sku: string | null;
  priceCents: number;
  quantity: number;
  status: string;
  variantCount?: number;
  photoCount?: number;
  photosReady?: boolean;
  inventoryTracking?: string | null;
  etsyWhoMade?: string | null;
  etsyWhenMade?: string | null;
  etsyIsSupply?: boolean | null;
  etsyTaxonomyId?: number | null;
  howItsMadeReady?: boolean;
  howItsMadeMissing?: string[];
  supported?: boolean;
  unsupportedReason?: string | null;
};

export default function AppsAirportEtsySyncPage() {
  const [listings, setListings] = useState<EligibleListing[]>([]);
  const [connectionStatus, setConnectionStatus] = useState("LOADING");
  const [shippingReady, setShippingReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [progress, setProgress] = useState<EtsySyncProgressStep | null>(null);
  const [progressDetail, setProgressDetail] = useState<string | null>(null);
  const [modalListing, setModalListing] = useState<EligibleListing | null>(null);
  const [howItsMade, setHowItsMade] = useState<EtsyHowItsMadeFormValue>(
    emptyEtsyHowItsMadeFormValue()
  );

  const loadEligible = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/etsy/listings/eligible", { credentials: "include" });
      if (!response.ok) {
        setError("Could not load eligible listings.");
        return;
      }
      const body = (await response.json()) as {
        connectionStatus: string;
        connection?: { shippingProfileReady?: boolean };
        listings: EligibleListing[];
      };
      setConnectionStatus(body.connectionStatus);
      setShippingReady(Boolean(body.connection?.shippingProfileReady));
      setListings(body.listings ?? []);
    } catch {
      setError("Could not load eligible listings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEligible();
  }, [loadEligible]);

  function openListModal(listing: EligibleListing) {
    setError(null);
    setProgressDetail(null);
    setModalListing(listing);
    setHowItsMade(
      emptyEtsyHowItsMadeFormValue({
        etsyWhoMade: listing.etsyWhoMade,
        etsyWhenMade: listing.etsyWhenMade,
        etsyIsSupply: listing.etsyIsSupply,
        etsyTaxonomyId: listing.etsyTaxonomyId,
      })
    );
  }

  function closeModal() {
    if (syncingId) return;
    setModalListing(null);
  }

  async function pollCreateStatus(storeItemId: string, jobId: string | null) {
    for (let attempt = 0; attempt < 24; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 600 : 2000));
      const qs = new URLSearchParams({ storeItemId });
      if (jobId) qs.set("jobId", jobId);
      const response = await fetch(`/api/etsy/listings/create-status?${qs}`, {
        credentials: "include",
      });
      if (!response.ok) continue;
      const body = (await response.json()) as {
        job?: {
          state?: string;
          errorMessage?: string | null;
        } | null;
        listing?: {
          readiness?: string | null;
          remoteListingState?: string | null;
          issueMessage?: string | null;
        } | null;
      };
      const step = resolveEtsySyncProgress({
        enqueueStatus: "queued",
        jobState: body.job?.state,
        jobError: body.job?.errorMessage,
        listing: body.listing,
      });
      setProgress(step);
      if (body.listing?.issueMessage || body.job?.errorMessage) {
        setProgressDetail(body.listing?.issueMessage ?? body.job?.errorMessage ?? null);
      }
      if (step === "live" || step === "needs_attention" || step === "already_mapped") {
        return;
      }
    }
    setProgressDetail(
      "Still working in the background. Open Linked Listings in a minute to confirm."
    );
  }

  async function onConfirmList() {
    if (!modalListing) return;
    if (!howItsMade.etsyWhoMade) {
      setError("Choose who made it.");
      return;
    }
    if (howItsMade.etsyIsSupply !== true && howItsMade.etsyIsSupply !== false) {
      setError("Choose whether this is a finished product or a supply/tool.");
      return;
    }
    const madeToOrder = modalListing.inventoryTracking === "made_to_order";
    if (!madeToOrder && !howItsMade.etsyWhenMade) {
      setError("Choose when it was made.");
      return;
    }

    setError(null);
    setProgressDetail(null);
    setProgress("preparing");
    setSyncingId(modalListing.storeItemId);
    const storeItemId = modalListing.storeItemId;
    try {
      const attrsRes = await fetch(`/api/store-items/${storeItemId}/etsy-attributes`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          etsyWhoMade: howItsMade.etsyWhoMade,
          etsyWhenMade: madeToOrder ? "made_to_order" : howItsMade.etsyWhenMade || null,
          etsyIsSupply: howItsMade.etsyIsSupply,
          ...(howItsMade.etsyTaxonomyId.trim() && /^\d+$/.test(howItsMade.etsyTaxonomyId.trim())
            ? {
                etsyTaxonomyId: Number.parseInt(howItsMade.etsyTaxonomyId.trim(), 10),
              }
            : {}),
        }),
      });
      if (!attrsRes.ok) {
        const attrsBody = (await attrsRes.json().catch(() => ({}))) as { error?: string };
        setError(attrsBody.error ?? "Could not save How it’s made.");
        setProgress("needs_attention");
        return;
      }

      setModalListing(null);
      setProgress("queued");

      const response = await fetch("/api/etsy/listings/create", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeItemId }),
      });
      const body = (await response.json()) as {
        status?: string;
        error?: string;
        jobId?: string;
      };
      if (!response.ok) {
        setError(body.error ?? "Could not start Etsy listing.");
        setProgress("needs_attention");
        return;
      }
      if (body.status === "already_mapped") {
        setProgress("already_mapped");
        await loadEligible();
        return;
      }
      if (body.status === "queued") {
        setProgress("creating");
        await pollCreateStatus(storeItemId, body.jobId ?? null);
        await loadEligible();
        return;
      }
      setError("Unexpected listing response.");
      setProgress("needs_attention");
    } catch {
      setError("Could not start Etsy listing.");
      setProgress("needs_attention");
    } finally {
      setSyncingId(null);
    }
  }

  return (
    <AppsAirportChrome
      title="List on Etsy"
      subtitle="Choose an INW listing, complete How it’s made, then publish it to your Etsy shop."
      crumbs={[
        { href: APPS_AIRPORT_ETSY_PATH, label: "Etsy" },
        { href: APPS_AIRPORT_ETSY_SYNC_PATH, label: "List on Etsy" },
      ]}
    >
      {connectionStatus === "DISCONNECTED" ? (
        <div className="rounded-[10px] border-2 p-5" style={{ borderColor: "var(--color-primary)" }}>
          <p className="font-semibold" style={{ color: "var(--color-heading)" }}>
            Connect Etsy first
          </p>
          <Link href={APPS_AIRPORT_ETSY_SETTINGS_PATH} className="btn mt-4 inline-block" prefetch={false}>
            Connection Settings
          </Link>
        </div>
      ) : null}

      {connectionStatus === "ACTIVE" && !shippingReady ? (
        <div className="mb-6 rounded-[10px] border-2 border-amber-300 bg-amber-50 p-4 text-sm">
          Choose a default Etsy shipping profile in{" "}
          <Link href={APPS_AIRPORT_ETSY_SETTINGS_PATH} className="underline" prefetch={false}>
            Connection Settings
          </Link>{" "}
          before listing.
        </div>
      ) : null}

      {error ? <p className="mb-4 text-sm text-neutral-800">{error}</p> : null}

      {progress ? (
        <div
          className="mb-6 rounded-[10px] border-2 p-4"
          style={{ borderColor: "var(--color-primary)" }}
          data-testid="etsy-sync-progress"
        >
          <p className="font-semibold" style={{ color: "var(--color-heading)" }}>
            Sync status: {etsySyncProgressLabel(progress)}
          </p>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-neutral-200">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${etsySyncProgressPercent(progress)}%`,
                backgroundColor: "var(--color-primary)",
              }}
            />
          </div>
          {progressDetail ? (
            <p className="mt-2 text-sm text-neutral-600">
              {/IMAGES_REQUIRED|photo/i.test(progressDetail)
                ? `${progressDetail} Photos must be publicly reachable (INW-hosted works best).`
                : progressDetail}
            </p>
          ) : null}
          {(progress === "live" || progress === "needs_attention" || progress === "already_mapped") && (
            <Link href={APPS_AIRPORT_ETSY_LISTINGS_PATH} className="btn mt-3 inline-block" prefetch={false}>
              View linked listings
            </Link>
          )}
        </div>
      ) : null}

      {loading ? <p className="text-sm text-neutral-600">Loading eligible listings…</p> : null}

      {!loading && connectionStatus === "ACTIVE" && listings.length === 0 ? (
        <p className="text-sm text-neutral-600">
          No eligible listings. Active INW items that are not already linked to Etsy will appear here.
        </p>
      ) : null}

      {!loading && listings.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm border-collapse">
            <thead>
              <tr className="border-b text-left" style={{ borderColor: "var(--color-primary)" }}>
                <th className="py-2 pr-4 font-semibold">INW listing</th>
                <th className="py-2 pr-4 font-semibold">Price</th>
                <th className="py-2 pr-4 font-semibold">Status</th>
                <th className="py-2 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {listings.map((listing) => {
                const readyToList = Boolean(
                  listing.howItsMadeReady && listing.photosReady !== false && listing.supported
                );
                const canOpen =
                  shippingReady &&
                  (listing.variantCount ?? 0) >= 1 &&
                  listing.photosReady !== false;
                const statusLabel = !shippingReady
                  ? "Shipping profile needed"
                  : listing.unsupportedReason
                    ? listing.unsupportedReason
                    : readyToList
                      ? "Ready To List"
                      : "Info Needed";
                return (
                  <tr key={listing.storeItemId} className="border-b border-neutral-200">
                    <td className="py-3 pr-4">
                      <Link
                        href={`/seller-hub/store/${listing.storeItemId}`}
                        className="font-medium underline"
                        style={{ color: "var(--color-primary)" }}
                        prefetch={false}
                      >
                        {listing.title}
                      </Link>
                    </td>
                    <td className="py-3 pr-4">{formatEtsyCents(listing.priceCents)}</td>
                    <td className="py-3 pr-4">
                      <span className="text-sm text-neutral-700">{statusLabel}</span>
                    </td>
                    <td className="py-3">
                      <button
                        type="button"
                        className="btn"
                        style={{ color: "#fff" }}
                        disabled={!canOpen || syncingId === listing.storeItemId}
                        onClick={() => openListModal(listing)}
                      >
                        {syncingId === listing.storeItemId ? "Listing…" : "List on Etsy"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {modalListing ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 overflow-y-auto">
          <div
            className="w-full max-w-lg rounded-[12px] bg-white p-5 shadow-lg"
            role="dialog"
            aria-modal="true"
            aria-labelledby="etsy-list-modal-title"
          >
            <h3
              id="etsy-list-modal-title"
              className="text-lg font-semibold"
              style={{ color: "var(--color-heading)" }}
            >
              List on Etsy
            </h3>
            <p className="mt-1 text-sm text-neutral-600">{modalListing.title}</p>
            <div className="mt-4">
              <EtsyHowItsMadeFields
                value={howItsMade}
                onChange={setHowItsMade}
                madeToOrder={modalListing.inventoryTracking === "made_to_order"}
                embedded
              />
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                className="btn"
                style={{ color: "#fff" }}
                disabled={Boolean(syncingId)}
                onClick={() => void onConfirmList()}
              >
                {syncingId ? "Listing…" : "Publish to Etsy"}
              </button>
              <button
                type="button"
                className="btn border border-gray-300 bg-white hover:bg-gray-50"
                style={{ color: "var(--color-heading)" }}
                disabled={Boolean(syncingId)}
                onClick={closeModal}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </AppsAirportChrome>
  );
}
