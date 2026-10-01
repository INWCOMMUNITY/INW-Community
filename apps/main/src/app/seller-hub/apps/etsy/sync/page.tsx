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
  formatEtsyCents,
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
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
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
    setStatusMessage(null);
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
    setStatusMessage(null);
    setSyncingId(modalListing.storeItemId);
    try {
      const attrsRes = await fetch(`/api/store-items/${modalListing.storeItemId}/etsy-attributes`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          etsyWhoMade: howItsMade.etsyWhoMade,
          etsyWhenMade: madeToOrder ? "made_to_order" : howItsMade.etsyWhenMade || null,
          etsyIsSupply: howItsMade.etsyIsSupply,
          etsyTaxonomyId: null,
        }),
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
        body: JSON.stringify({ storeItemId: modalListing.storeItemId }),
      });
      const body = (await response.json()) as {
        status?: string;
        error?: string;
        code?: string;
        missing?: string[];
      };
      if (!response.ok) {
        setError(body.error ?? "Could not start Etsy listing.");
        return;
      }
      if (body.status === "already_mapped") {
        setStatusMessage("Already listed on Etsy for this connection.");
      } else if (body.status === "queued") {
        setStatusMessage("Queued. The Etsy worker will create the listing shortly.");
      }
      setModalListing(null);
      await loadEligible();
    } catch {
      setError("Could not start Etsy listing.");
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

      {error ? <p className="mb-4 text-sm text-red-700">{error}</p> : null}
      {statusMessage ? (
        <div className="mb-6 rounded-[10px] border-2 p-4" style={{ borderColor: "var(--color-primary)" }}>
          <p className="text-sm text-neutral-700">{statusMessage}</p>
          <Link href={APPS_AIRPORT_ETSY_LISTINGS_PATH} className="btn mt-3 inline-block" prefetch={false}>
            View mapped listings
          </Link>
        </div>
      ) : null}

      {loading ? <p className="text-sm text-neutral-600">Loading eligible listings…</p> : null}

      {!loading && connectionStatus === "ACTIVE" && listings.length === 0 ? (
        <p className="text-sm text-neutral-600">
          No eligible listings. Active INW items that are not already mapped will appear here.
        </p>
      ) : null}

      {!loading && listings.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm border-collapse">
            <thead>
              <tr className="border-b text-left" style={{ borderColor: "var(--color-primary)" }}>
                <th className="py-2 pr-4 font-semibold">INW listing</th>
                <th className="py-2 pr-4 font-semibold">Price</th>
                <th className="py-2 pr-4 font-semibold">How it’s made</th>
                <th className="py-2 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {listings.map((listing) => {
                const readyToList = Boolean(listing.howItsMadeReady);
                const canOpen = shippingReady && (listing.variantCount ?? 0) >= 1;
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
                      {!readyToList && listing.unsupportedReason ? (
                        <p className="mt-1 text-xs text-amber-800">{listing.unsupportedReason}</p>
                      ) : null}
                    </td>
                    <td className="py-3 pr-4">{formatEtsyCents(listing.priceCents)}</td>
                    <td className="py-3 pr-4">
                      {readyToList ? (
                        <span className="text-xs uppercase tracking-wide text-neutral-500">
                          Ready to list
                        </span>
                      ) : (
                        <span className="text-xs text-amber-800">
                          Missing {(listing.howItsMadeMissing ?? []).filter((m) => m !== "taxonomy_id").join(", ") || "fields"}
                        </span>
                      )}
                    </td>
                    <td className="py-3">
                      <button
                        type="button"
                        className="btn"
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
