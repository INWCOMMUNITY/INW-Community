"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AppsAirportChrome } from "@/components/apps-airport/AppsAirportChrome";
import { AppsAirportListingPhotoCollage } from "@/components/apps-airport/AppsAirportListingPhotoCollage";
import { ShopifyMetafieldListingDialog } from "@/components/shopify/ShopifyMetafieldListingDialog";
import { ShopifySharedQuantityDialog } from "@/components/shopify/ShopifySharedQuantityDialog";
import {
  APPS_AIRPORT_SHOPIFY_PATH,
  APPS_AIRPORT_SHOPIFY_SETTINGS_PATH,
  formatCents,
  resolveShopifySyncProgress,
  shopifySyncProgressLabel,
  type ShopifySyncProgressStep,
} from "@/lib/shopify/apps-airport";

type EligibleListing = {
  storeItemId: string;
  title: string;
  photos?: string[];
  slug: string;
  sku: string | null;
  priceCents: number;
  quantity: number;
  status: string;
  variantCount?: number;
  supported?: boolean;
  unsupportedReason?: string | null;
  needsShopifyMetafields?: boolean;
  usesSharedQuantityPool?: boolean;
};

type ListingStatus = {
  storeItemId: string;
  readiness: string;
  inventoryInitState: string | null;
  remoteProductStatus?: string | null;
  issueMessage: string | null;
};

type EnqueueResult =
  | { ok: true; status: "queued" | "already_mapped"; storeItemId: string; title: string }
  | { ok: false; storeItemId: string; title: string; error: string };

type ResultModal = {
  tone: "success" | "error" | "mixed";
  title: string;
  message: string;
  failures?: Array<{ title: string; error: string }>;
};

async function enqueueListing(
  storeItemId: string,
  title: string
): Promise<EnqueueResult> {
  try {
    const response = await fetch("/api/shopify/listings/create", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeItemId }),
    });
    let body: { status?: string; error?: string } = {};
    try {
      body = (await response.json()) as { status?: string; error?: string };
    } catch {
      body = {};
    }
    if (!response.ok) {
      return {
        ok: false,
        storeItemId,
        title,
        error: body.error?.trim() || "Could not start Shopify sync.",
      };
    }
    if (body.status === "already_mapped") {
      return { ok: true, status: "already_mapped", storeItemId, title };
    }
    if (body.status === "queued") {
      return { ok: true, status: "queued", storeItemId, title };
    }
    return {
      ok: false,
      storeItemId,
      title,
      error: "Unexpected sync response.",
    };
  } catch {
    return {
      ok: false,
      storeItemId,
      title,
      error: "Could not start Shopify sync.",
    };
  }
}

export default function AppsAirportShopifySyncPage() {
  const [listings, setListings] = useState<EligibleListing[]>([]);
  const [inventoryReady, setInventoryReady] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<string>("LOADING");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<ShopifySyncProgressStep | null>(null);
  const [progressDetail, setProgressDetail] = useState<string | null>(null);
  const [resultModal, setResultModal] = useState<ResultModal | null>(null);
  const [metafieldTargets, setMetafieldTargets] = useState<EligibleListing[] | null>(null);
  const [sharedQuantityOpen, setSharedQuantityOpen] = useState(false);
  const [sharedQuantityTargets, setSharedQuantityTargets] = useState<EligibleListing[]>([]);
  const busyRef = useRef(false);
  const pollGenerationRef = useRef(0);

  const selectableListings = useMemo(
    () =>
      listings.filter(
        (listing) => listing.supported !== false && inventoryReady
      ),
    [listings, inventoryReady]
  );

  const allSelectableSelected =
    selectableListings.length > 0 &&
    selectableListings.every((listing) => selectedIds.has(listing.storeItemId));

  const loadEligible = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/shopify/listings/eligible", {
        credentials: "include",
      });
      if (!response.ok) {
        setError("Could not load eligible listings.");
        return;
      }
      const body = (await response.json()) as {
        connectionStatus: string;
        inventoryReady?: boolean;
        listings: EligibleListing[];
      };
      setConnectionStatus(body.connectionStatus);
      setInventoryReady(Boolean(body.inventoryReady));
      setListings(body.listings ?? []);
      setSelectedIds((prev) => {
        const next = new Set<string>();
        for (const id of prev) {
          if ((body.listings ?? []).some((row) => row.storeItemId === id)) {
            next.add(id);
          }
        }
        return next;
      });
    } catch {
      setError("Could not load eligible listings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEligible();
  }, [loadEligible]);

  const pollListingStatus = useCallback(
    async (storeItemId: string, enqueueStatus: "queued" | "already_mapped") => {
      const generation = ++pollGenerationRef.current;
      setProgress(
        resolveShopifySyncProgress({
          enqueueStatus,
          listing: null,
        })
      );
      for (let attempt = 0; attempt < 36; attempt += 1) {
        if (pollGenerationRef.current !== generation) return;
        await new Promise((resolve) =>
          setTimeout(resolve, attempt === 0 ? 800 : 2000)
        );
        if (pollGenerationRef.current !== generation) return;
        const response = await fetch(
          `/api/shopify/listings/create-status?storeItemId=${encodeURIComponent(storeItemId)}`,
          { credentials: "include" }
        );
        if (!response.ok) continue;
        const body = (await response.json()) as {
          job?: { state?: string; errorMessage?: string | null } | null;
          listing?: ListingStatus | null;
        };
        const listing = body.listing ?? null;
        const step = resolveShopifySyncProgress({
          enqueueStatus,
          jobState: body.job?.state,
          listing,
        });
        if (pollGenerationRef.current !== generation) return;
        setProgress(step);
        if (listing?.issueMessage) setProgressDetail(listing.issueMessage);
        else if (body.job?.errorMessage) setProgressDetail(body.job.errorMessage);
        if (
          step === "published" ||
          step === "needs_attention" ||
          (enqueueStatus === "already_mapped" && listing)
        ) {
          if (step === "published") {
            setProgressDetail("This listing is live on your Online Store.");
          } else if (step === "needs_attention" && !listing?.issueMessage && !body.job?.errorMessage) {
            setProgressDetail("Open My Items to review what needs attention.");
          }
          return;
        }
      }
      if (pollGenerationRef.current !== generation) return;
      setProgressDetail(
        "Sync is still running in the background. Check My Items shortly."
      );
    },
    []
  );

  const showEnqueueModal = useCallback((results: EnqueueResult[]) => {
    const successes = results.filter((row): row is Extract<EnqueueResult, { ok: true }> => row.ok);
    const failures = results.filter((row): row is Extract<EnqueueResult, { ok: false }> => !row.ok);
    if (successes.length > 0 && failures.length === 0) {
      const already = successes.filter((row) => row.status === "already_mapped").length;
      const queued = successes.length - already;
      const parts: string[] = [];
      if (queued === 1) parts.push("1 listing was queued for Shopify.");
      if (queued > 1) parts.push(`${queued} listings were queued for Shopify.`);
      if (already === 1) parts.push("1 listing was already synced.");
      if (already > 1) parts.push(`${already} listings were already synced.`);
      setResultModal({
        tone: "success",
        title: successes.length === 1 ? "Listed on Shopify" : "Listings started",
        message: parts.join(" ") + " Sync continues in the background.",
      });
      return;
    }
    if (successes.length === 0) {
      setResultModal({
        tone: "error",
        title: results.length === 1 ? "Could not list on Shopify" : "Could not list listings",
        message:
          results.length === 1
            ? failures[0]?.error ?? "Could not start Shopify sync."
            : "None of the selected listings could be started.",
        failures: failures.map((row) => ({ title: row.title, error: row.error })),
      });
      return;
    }
    setResultModal({
      tone: "mixed",
      title: "Some listings could not be started",
      message: `${successes.length} started, ${failures.length} failed.`,
      failures: failures.map((row) => ({ title: row.title, error: row.error })),
    });
  }, []);

  const runEnqueue = useCallback(
    async (targets: EligibleListing[]) => {
      if (targets.length < 1 || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setError(null);
      setProgressDetail(null);
      setResultModal(null);
      const results: EnqueueResult[] = [];
      try {
        for (const listing of targets) {
          setSyncingId(listing.storeItemId);
          const result = await enqueueListing(listing.storeItemId, listing.title);
          results.push(result);
        }
        showEnqueueModal(results);
        const firstSuccess = results.find(
          (row): row is Extract<EnqueueResult, { ok: true }> => row.ok
        );
        if (firstSuccess) {
          setProgress(
            firstSuccess.status === "already_mapped" ? "already_mapped" : "queued"
          );
          // Poll the first success for live progress; do not block further clicks.
          void pollListingStatus(firstSuccess.storeItemId, firstSuccess.status);
        } else if (results[0] && !results[0].ok) {
          setProgress("needs_attention");
          setProgressDetail(results[0].error);
        }
        setSelectedIds((prev) => {
          const next = new Set(prev);
          for (const row of results) {
            if (row.ok) next.delete(row.storeItemId);
          }
          return next;
        });
        await loadEligible();
      } finally {
        setSyncingId(null);
        setBusy(false);
        busyRef.current = false;
      }
    },
    [loadEligible, pollListingStatus, showEnqueueModal]
  );

  function continueEnqueue(targets: EligibleListing[]) {
    if (targets.some((listing) => listing.needsShopifyMetafields)) {
      setMetafieldTargets(targets);
      return;
    }
    void runEnqueue(targets);
  }

  function requestEnqueue(targets: EligibleListing[]) {
    const blocked = targets.filter((listing) => listing.usesSharedQuantityPool);
    if (blocked.length > 0) {
      setSharedQuantityTargets(targets);
      setSharedQuantityOpen(true);
      return;
    }
    continueEnqueue(targets);
  }

  function skipSharedQuantityListings() {
    const compatible = sharedQuantityTargets.filter((listing) => !listing.usesSharedQuantityPool);
    const blockedIds = new Set(
      sharedQuantityTargets
        .filter((listing) => listing.usesSharedQuantityPool)
        .map((listing) => listing.storeItemId)
    );
    setSharedQuantityOpen(false);
    setSharedQuantityTargets([]);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of blockedIds) next.delete(id);
      return next;
    });
    if (compatible.length === 0) return;
    continueEnqueue(compatible);
  }

  function toggleSelected(storeItemId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(storeItemId)) next.delete(storeItemId);
      else next.add(storeItemId);
      return next;
    });
  }

  function toggleSelectAll() {
    if (allSelectableSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(selectableListings.map((row) => row.storeItemId)));
  }

  const selectedCount = selectableListings.filter((row) =>
    selectedIds.has(row.storeItemId)
  ).length;

  return (
    <AppsAirportChrome
      title="List on Shopify"
      subtitle="Choose active INW listings that are not already mapped, then export them to Shopify as ACTIVE products published to your Online Store."
      crumbs={[
        { href: APPS_AIRPORT_SHOPIFY_PATH, label: "Shopify" },
        { href: `${APPS_AIRPORT_SHOPIFY_PATH}/sync`, label: "List on Shopify" },
      ]}
    >
      {connectionStatus === "CONNECTION_REQUIRED" ? (
        <div
          className="rounded-[10px] border-2 p-5"
          style={{ borderColor: "var(--color-primary)" }}
        >
          <p className="font-semibold" style={{ color: "var(--color-heading)" }}>
            Connect Shopify first
          </p>
          <p className="mt-2 text-sm text-neutral-600">
            You need an active Shopify connection before syncing listings.
          </p>
          <Link
            href={APPS_AIRPORT_SHOPIFY_SETTINGS_PATH}
            className="btn mt-4 inline-block"
            prefetch={false}
          >
            Connection settings
          </Link>
        </div>
      ) : null}

      {connectionStatus === "ACTIVE" && !inventoryReady ? (
        <div className="mb-6 rounded-[10px] border-2 border-amber-300 bg-amber-50 p-4 text-sm">
          Choose a primary Shopify location in{" "}
          <Link
            href={APPS_AIRPORT_SHOPIFY_SETTINGS_PATH}
            className="underline"
            prefetch={false}
          >
            Connection settings
          </Link>{" "}
          before syncing.
        </div>
      ) : null}

      {error ? <p className="mb-4 text-sm text-red-700">{error}</p> : null}

      {progress ? (
        <div
          className="mb-6 rounded-[10px] border-2 p-4"
          style={{ borderColor: "var(--color-primary)" }}
          data-testid="shopify-sync-progress"
        >
          <p className="font-semibold" style={{ color: "var(--color-heading)" }}>
            Sync status: {shopifySyncProgressLabel(progress)}
          </p>
          {progressDetail ? (
            <p className="mt-1 text-sm text-neutral-600">{progressDetail}</p>
          ) : null}
          {(progress === "published" ||
            progress === "needs_attention" ||
            progress === "already_mapped" ||
            progress === "inventory_initializing" ||
            progress === "queued" ||
            progress === "creating_product" ||
            progress === "mapping" ||
            progress === "publishing") && (
            <Link
              href="/seller-hub/store/items"
              className="btn mt-3 inline-block"
              prefetch={false}
            >
              View my items
            </Link>
          )}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-neutral-600">Loading eligible listings…</p>
      ) : null}

      {!loading && connectionStatus === "ACTIVE" && listings.length === 0 ? (
        <p className="text-sm text-neutral-600">
          No eligible listings right now. List on Shopify supports active INW listings
          (up to 100 variants) that are not already mapped to this Shopify connection.
        </p>
      ) : null}

      {!loading && listings.length > 0 ? (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn"
              disabled={!inventoryReady || busy || selectedCount < 1}
              onClick={() =>
                requestEnqueue(
                  selectableListings.filter((row) => selectedIds.has(row.storeItemId))
                )
              }
            >
              {busy && selectedCount > 1
                ? "Listing selected…"
                : selectedCount > 0
                  ? `List selected (${selectedCount})`
                  : "List selected"}
            </button>
            <p className="text-sm text-neutral-600">
              {selectedCount > 0
                ? `${selectedCount} selected`
                : "Select one or more listings, or use List on Shopify on a row."}
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border-collapse">
              <thead>
                <tr
                  className="border-b text-left"
                  style={{ borderColor: "var(--color-primary)" }}
                >
                  <th className="py-2 pr-3 font-semibold w-10">
                    <input
                      type="checkbox"
                      aria-label="Select all eligible listings"
                      checked={allSelectableSelected}
                      disabled={!inventoryReady || selectableListings.length < 1 || busy}
                      onChange={toggleSelectAll}
                    />
                  </th>
                  <th className="py-2 pr-4 font-semibold">INW Listing</th>
                  <th className="py-2 pr-4 font-semibold">Price</th>
                  <th className="py-2 pr-4 font-semibold" title="Q is a quantity cap. P is a pools cap.">
                    Q / P
                  </th>
                  <th className="py-2 pr-4 font-semibold">Variants</th>
                  <th className="py-2 pr-4 font-semibold">SKU</th>
                  <th className="py-2 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {listings.map((listing) => {
                  const supported = listing.supported !== false;
                  const canSelect = supported && inventoryReady;
                  const rowBusy = busy && syncingId === listing.storeItemId;
                  return (
                    <tr
                      key={listing.storeItemId}
                      className="border-b border-neutral-200 align-top"
                    >
                      <td className="py-3 pr-3">
                        <input
                          type="checkbox"
                          aria-label={`Select ${listing.title}`}
                          checked={selectedIds.has(listing.storeItemId)}
                          disabled={!canSelect || busy}
                          onChange={() => toggleSelected(listing.storeItemId)}
                        />
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex items-start gap-3">
                          <AppsAirportListingPhotoCollage
                            photos={listing.photos}
                            alt={listing.title}
                          />
                          <div>
                            <Link
                              href={
                                listing.slug?.trim()
                                  ? `/storefront/${listing.slug.trim()}?from=shopify-sync`
                                  : `/seller-hub/store/${listing.storeItemId}`
                              }
                              className="font-medium underline"
                              style={{ color: "var(--color-primary)" }}
                              prefetch={false}
                            >
                              {listing.title}
                            </Link>
                            {!supported && listing.unsupportedReason ? (
                              <p className="mt-1 text-xs text-amber-800">
                                {listing.unsupportedReason}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td className="py-3 pr-4">{formatCents(listing.priceCents)}</td>
                      <td
                        className="py-3 pr-4 whitespace-nowrap"
                        title={listing.usesSharedQuantityPool ? "Pools cap" : "Quantity cap"}
                      >
                        {listing.usesSharedQuantityPool ? `P ${listing.quantity}` : `Q ${listing.quantity}`}
                      </td>
                      <td className="py-3 pr-4">{listing.variantCount ?? "—"}</td>
                      <td className="py-3 pr-4">{listing.sku ?? "—"}</td>
                      <td className="py-3">
                        <button
                          type="button"
                          className="btn"
                          disabled={!canSelect || busy}
                          onClick={() => requestEnqueue([listing])}
                        >
                          {rowBusy ? "Listing…" : "List on Shopify"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <ShopifySharedQuantityDialog
        open={sharedQuantityOpen}
        skippedTitles={sharedQuantityTargets
          .filter((listing) => listing.usesSharedQuantityPool)
          .map((listing) => listing.title)}
        onSkip={skipSharedQuantityListings}
        onClose={() => {
          setSharedQuantityOpen(false);
          setSharedQuantityTargets([]);
        }}
      />
      <ShopifyMetafieldListingDialog
        open={metafieldTargets != null}
        itemCount={metafieldTargets?.length ?? 1}
        onCancel={() => setMetafieldTargets(null)}
        onConfirm={() => {
          const targets = metafieldTargets ?? [];
          setMetafieldTargets(null);
          void runEnqueue(targets);
        }}
      />

      {resultModal ? (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="shopify-list-result-title"
          onClick={() => setResultModal(null)}
        >
          <div
            className="w-full max-w-md rounded-[12px] border-2 bg-white p-5 shadow-lg"
            style={{ borderColor: "var(--color-primary)" }}
            onClick={(event) => event.stopPropagation()}
          >
            <h2
              id="shopify-list-result-title"
              className="text-lg font-semibold"
              style={{
                color:
                  resultModal.tone === "error"
                    ? "#b91c1c"
                    : resultModal.tone === "mixed"
                      ? "#92400e"
                      : "var(--color-heading)",
              }}
            >
              {resultModal.title}
            </h2>
            <p className="mt-2 text-sm text-neutral-700">{resultModal.message}</p>
            {resultModal.failures && resultModal.failures.length > 0 ? (
              <ul className="mt-3 max-h-48 space-y-2 overflow-y-auto text-sm">
                {resultModal.failures.map((row) => (
                  <li key={`${row.title}:${row.error}`} className="text-red-700">
                    <span className="font-medium">{row.title}</span>
                    <span className="text-neutral-700"> — {row.error}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-5 flex flex-wrap gap-3">
              <button type="button" className="btn" onClick={() => setResultModal(null)}>
                OK
              </button>
              {resultModal.tone !== "error" ? (
                <Link
                  href="/seller-hub/store/items"
                  className="btn"
                  prefetch={false}
                  onClick={() => setResultModal(null)}
                >
                  View my items
                </Link>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </AppsAirportChrome>
  );
}
