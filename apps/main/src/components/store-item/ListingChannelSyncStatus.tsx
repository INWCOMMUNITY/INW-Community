"use client";

import { useEffect, useState } from "react";
import { IonIcon } from "@/components/IonIcon";
import {
  etsySyncProgressLabel,
  etsySyncProgressPercent,
  resolveEtsySyncProgress,
  type EtsySyncProgressStep,
} from "@/lib/etsy/apps-airport";
import {
  resolveShopifySyncProgress,
  shopifySyncProgressLabel,
  type ShopifySyncProgressStep,
} from "@/lib/shopify/apps-airport";

export type ChannelListingEnqueue = {
  channel: "etsy" | "shopify";
  storeItemId: string;
  enqueueStatus: "queued" | "already_mapped" | null;
  jobId: string | null;
  error: string | null;
};

type RowState = {
  label: string;
  percent: number;
  done: boolean;
  success: boolean;
  detail: string | null;
};

const CHANNEL_NAME: Record<ChannelListingEnqueue["channel"], string> = {
  etsy: "Etsy",
  shopify: "Shopify",
};

function shopifyPercent(step: ShopifySyncProgressStep): number {
  switch (step) {
    case "preparing":
      return 12;
    case "queued":
      return 28;
    case "creating_product":
      return 48;
    case "mapping":
      return 62;
    case "inventory_initializing":
      return 76;
    case "publishing":
      return 90;
    case "published":
    case "already_mapped":
    case "needs_attention":
      return 100;
  }
}

function isEtsyTerminal(step: EtsySyncProgressStep): boolean {
  return step === "live" || step === "needs_attention" || step === "already_mapped";
}

function isShopifyTerminal(
  step: ShopifySyncProgressStep,
  enqueueStatus: "queued" | "already_mapped"
): boolean {
  return (
    step === "published" ||
    step === "needs_attention" ||
    (enqueueStatus === "already_mapped" && step === "already_mapped")
  );
}

function initialRow(item: ChannelListingEnqueue): RowState {
  if (item.error) {
    return { label: item.error, percent: 100, done: true, success: false, detail: null };
  }
  if (item.enqueueStatus === "already_mapped") {
    return {
      label: item.channel === "etsy" ? "Already on Etsy" : "Already on Shopify",
      percent: 100,
      done: true,
      success: true,
      detail: null,
    };
  }
  return {
    label: item.channel === "etsy" ? "Listing on Etsy" : "Listing on Shopify",
    percent: 18,
    done: false,
    success: false,
    detail: null,
  };
}

function ChannelSyncRow({ item }: { item: ChannelListingEnqueue }) {
  const [row, setRow] = useState<RowState>(() => initialRow(item));

  useEffect(() => {
    if (item.error || item.enqueueStatus !== "queued") return;
    let cancelled = false;
    const maxAttempts = item.channel === "etsy" ? 24 : 36;

    async function poll() {
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        if (cancelled) return;
        await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 600 : 2000));
        if (cancelled) return;
        try {
          const qs = new URLSearchParams({ storeItemId: item.storeItemId });
          if (item.jobId) qs.set("jobId", item.jobId);
          const path =
            item.channel === "etsy"
              ? `/api/etsy/listings/create-status?${qs}`
              : `/api/shopify/listings/create-status?${qs}`;
          const response = await fetch(path, { credentials: "include" });
          if (!response.ok) continue;
          const body = (await response.json().catch(() => null)) as {
            job?: { state?: string; errorMessage?: string | null } | null;
            listing?: {
              readiness?: string | null;
              remoteListingState?: string | null;
              inventoryInitState?: string | null;
              remoteProductStatus?: string | null;
              issueMessage?: string | null;
            } | null;
          } | null;
          if (!body || cancelled) continue;

          if (item.channel === "etsy") {
            const step = resolveEtsySyncProgress({
              enqueueStatus: "queued",
              jobState: body.job?.state,
              jobError: body.job?.errorMessage,
              listing: body.listing,
            });
            const done = isEtsyTerminal(step);
            const success = step === "live" || step === "already_mapped";
            setRow({
              label: success ? "Live on Etsy" : etsySyncProgressLabel(step),
              percent: etsySyncProgressPercent(step),
              done,
              success,
              detail: done && !success ? body.listing?.issueMessage ?? body.job?.errorMessage ?? null : null,
            });
            if (done) return;
          } else {
            const step = resolveShopifySyncProgress({
              enqueueStatus: "queued",
              jobState: body.job?.state,
              listing: body.listing,
            });
            const done = isShopifyTerminal(step, "queued");
            const success = step === "published" || step === "already_mapped";
            setRow({
              label: success ? "Live on Shopify" : shopifySyncProgressLabel(step),
              percent: shopifyPercent(step),
              done,
              success,
              detail: done && !success ? body.listing?.issueMessage ?? body.job?.errorMessage ?? null : null,
            });
            if (done) return;
          }
        } catch {
          // Keep the bar moving and try again.
        }
      }
      if (!cancelled) {
        setRow((current) =>
          current.done
            ? current
            : {
                ...current,
                label: "Still syncing",
                detail: "You can leave this page. It usually finishes within a minute.",
              }
        );
      }
    }

    void poll();
    return () => {
      cancelled = true;
    };
  }, [item]);

  const name = CHANNEL_NAME[item.channel];

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold" style={{ color: "var(--color-heading)" }}>
          {name}
        </p>
        <p className="text-xs text-neutral-600">{row.label}</p>
      </div>
      {row.done && row.success ? (
        <div className="mt-2 flex justify-center" role="status">
          <IonIcon
            name="checkmark-circle"
            size={36}
            className="text-[var(--color-heading)]"
          />
          <span className="sr-only">{name} listing complete</span>
        </div>
      ) : (
        <div
          className="relative mt-2 h-2 overflow-hidden rounded-full bg-neutral-200"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={row.percent}
          aria-label={`${name} listing progress`}
        >
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${row.percent}%`, background: "var(--color-primary)" }}
          />
          {!row.done ? (
            <div
              className="listing-channel-sync-slide absolute inset-y-0 left-0 w-1/3 rounded-full"
              style={{ background: "var(--color-heading)" }}
            />
          ) : null}
        </div>
      )}
      {row.detail ? <p className="mt-1 text-xs text-amber-800">{row.detail}</p> : null}
    </div>
  );
}

export function ListingChannelSyncStatus({ channels }: { channels: ChannelListingEnqueue[] }) {
  if (channels.length === 0) return null;
  return (
    <div className="mb-6 space-y-4 text-left">
      {channels.map((item) => (
        <ChannelSyncRow key={item.channel} item={item} />
      ))}
    </div>
  );
}
