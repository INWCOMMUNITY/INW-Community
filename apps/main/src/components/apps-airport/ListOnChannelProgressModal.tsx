"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  etsySyncProgressLabel,
  resolveEtsySyncProgress,
  type EtsySyncProgressStep,
} from "@/lib/etsy/apps-airport";
import {
  resolveShopifySyncProgress,
  shopifySyncProgressLabel,
  type ShopifySyncProgressStep,
} from "@/lib/shopify/apps-airport";

type Channel = "etsy" | "shopify";

type Outcome = "success" | "attention" | "pending" | "error";

type Props = {
  channel: Channel;
  storeItemId: string;
  title?: string | null;
  /**
   * When omitted, this modal POSTs create itself (Shopify List from tip).
   * When set, create already happened and we only poll (Etsy after How it’s made).
   */
  enqueueStatus?: "queued" | "already_mapped";
  jobId?: string | null;
  /** Initial error before polling (e.g. create failed). */
  initialError?: string | null;
  onClose: () => void;
  onFinished?: (outcome: Outcome, message: string) => void;
};

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

function outcomeFromStep(
  step: EtsySyncProgressStep | ShopifySyncProgressStep | null,
  pending: boolean,
  error: string | null
): Outcome {
  if (error) return "error";
  if (pending || !step) return "pending";
  if (step === "needs_attention") return "attention";
  if (step === "live" || step === "published" || step === "already_mapped") {
    return "success";
  }
  return "pending";
}

function successMessage(channel: Channel, step: string): string {
  if (step === "already_mapped") {
    return channel === "etsy" ? "Already linked on Etsy." : "Already listed on Shopify.";
  }
  return channel === "etsy"
    ? "This listing is live on Etsy."
    : "This listing is live on your Online Store.";
}

/**
 * Full-screen popup: circle loader while listing syncs, then final status.
 */
export function ListOnChannelProgressModal({
  channel,
  storeItemId,
  title,
  enqueueStatus: enqueueStatusProp,
  jobId: jobIdProp,
  initialError = null,
  onClose,
  onFinished,
}: Props) {
  const channelLabel = channel === "etsy" ? "Etsy" : "Shopify";
  const [statusLabel, setStatusLabel] = useState(
    initialError ? "Could not start" : "Preparing…"
  );
  const [detail, setDetail] = useState<string | null>(initialError);
  const [done, setDone] = useState(Boolean(initialError));
  const [outcome, setOutcome] = useState<Outcome>(initialError ? "error" : "pending");
  const finishedRef = useRef(false);
  const cancelledRef = useRef(false);
  const outcomeRef = useRef<Outcome>(initialError ? "error" : "pending");
  const messageRef = useRef<string>(initialError ?? "Preparing…");

  function finish(next: Outcome, label: string, detailText: string | null) {
    outcomeRef.current = next;
    messageRef.current = detailText ?? label;
    setOutcome(next);
    setStatusLabel(label);
    setDetail(detailText);
    setDone(true);
  }

  useEffect(() => {
    cancelledRef.current = false;
    if (initialError) return;

    async function run() {
      let enqueueStatus: "queued" | "already_mapped" = enqueueStatusProp ?? "queued";
      let jobId: string | null = jobIdProp ?? null;

      try {
        if (!enqueueStatusProp) {
          setStatusLabel("Preparing…");
          const path =
            channel === "etsy" ? "/api/etsy/listings/create" : "/api/shopify/listings/create";
          const res = await fetch(path, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ storeItemId }),
          });
          const body = (await res.json().catch(() => ({}))) as {
            status?: string;
            error?: string;
            jobId?: string;
          };
          if (cancelledRef.current) return;
          if (!res.ok) {
            finish("error", "Could not start", body.error ?? `Could not list on ${channelLabel}`);
            return;
          }
          if (body.status === "already_mapped") {
            enqueueStatus = "already_mapped";
          } else {
            enqueueStatus = "queued";
            jobId = body.jobId ?? null;
          }
        }

        if (enqueueStatus === "already_mapped") {
          const label =
            channel === "etsy"
              ? etsySyncProgressLabel("already_mapped")
              : shopifySyncProgressLabel("already_mapped");
          finish("success", label, successMessage(channel, "already_mapped"));
          return;
        }

        setStatusLabel(
          channel === "etsy"
            ? etsySyncProgressLabel("queued")
            : shopifySyncProgressLabel("queued")
        );

        const maxAttempts = channel === "etsy" ? 24 : 20;
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
          if (cancelledRef.current) return;
          await new Promise((resolve) =>
            setTimeout(resolve, attempt === 0 ? (channel === "etsy" ? 600 : 800) : 2000)
          );
          if (cancelledRef.current) return;

          try {
            if (channel === "etsy") {
              const qs = new URLSearchParams({ storeItemId });
              if (jobId) qs.set("jobId", jobId);
              const response = await fetch(`/api/etsy/listings/create-status?${qs}`, {
                credentials: "include",
              });
              if (!response.ok) continue;
              const body = (await response.json().catch(() => null)) as {
                job?: {
                  state?: string;
                  errorMessage?: string | null;
                } | null;
                listing?: {
                  readiness?: string | null;
                  remoteListingState?: string | null;
                  issueMessage?: string | null;
                } | null;
              } | null;
              if (!body) continue;
              const step = resolveEtsySyncProgress({
                enqueueStatus,
                jobState: body.job?.state,
                jobError: body.job?.errorMessage,
                listing: body.listing,
              });
              if (cancelledRef.current) return;
              setStatusLabel(etsySyncProgressLabel(step));
              if (isEtsyTerminal(step)) {
                if (step === "live" || step === "already_mapped") {
                  finish("success", etsySyncProgressLabel(step), successMessage("etsy", step));
                } else {
                  finish(
                    "attention",
                    etsySyncProgressLabel(step),
                    body.listing?.issueMessage ??
                      body.job?.errorMessage ??
                      "Open Linked Listings to review what needs attention."
                  );
                }
                return;
              }
            } else {
              const response = await fetch(
                `/api/shopify/listings?storeItemId=${encodeURIComponent(storeItemId)}`,
                { credentials: "include" }
              );
              if (!response.ok) continue;
              const body = (await response.json().catch(() => null)) as {
                listings?: Array<{
                  storeItemId: string;
                  readiness?: string | null;
                  inventoryInitState?: string | null;
                  remoteProductStatus?: string | null;
                  issueMessage?: string | null;
                }>;
              } | null;
              if (!body) continue;
              const listing =
                body.listings?.find((row) => row.storeItemId === storeItemId) ?? null;
              const step = resolveShopifySyncProgress({ enqueueStatus, listing });
              if (cancelledRef.current) return;
              setStatusLabel(shopifySyncProgressLabel(step));
              if (isShopifyTerminal(step, enqueueStatus)) {
                if (step === "published" || step === "already_mapped") {
                  finish("success", shopifySyncProgressLabel(step), successMessage("shopify", step));
                } else {
                  finish(
                    "attention",
                    shopifySyncProgressLabel(step),
                    listing?.issueMessage ??
                      "Open Synced Listings to review what needs attention."
                  );
                }
                return;
              }
            }
          } catch {
            // Transient poll failures — keep spinning and retry.
          }
        }

        if (cancelledRef.current) return;
        finish(
          "pending",
          "Still working",
          channel === "etsy"
            ? "Still working in the background. Open Linked Listings in a minute to confirm."
            : "Sync is still running in the background. Check Synced Listings shortly."
        );
      } catch {
        if (cancelledRef.current) return;
        finish("error", "Could not start", `Could not list on ${channelLabel}`);
      }
    }

    void run();
    return () => {
      cancelledRef.current = true;
    };
  }, [
    channel,
    channelLabel,
    storeItemId,
    enqueueStatusProp,
    jobIdProp,
    initialError,
  ]);

  function handleDone() {
    if (!finishedRef.current) {
      finishedRef.current = true;
      onFinished?.(outcomeRef.current, messageRef.current);
    }
    onClose();
  }

  const spinnerTone =
    outcome === "error" || outcome === "attention"
      ? "border-red-300 border-t-red-600"
      : outcome === "success"
        ? "border-emerald-200 border-t-emerald-600"
        : "border-neutral-200 border-t-[var(--color-primary)]";

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[10050] flex items-center justify-center p-4 bg-black/50">
      <div
        className="relative w-full max-w-sm min-w-0 overflow-hidden rounded-[12px] bg-white p-6 shadow-lg text-center"
        role="dialog"
        aria-modal="true"
        aria-labelledby="list-on-channel-progress-title"
        aria-busy={!done}
      >
        <h3
          id="list-on-channel-progress-title"
          className="text-lg font-semibold"
          style={{ color: "var(--color-heading)" }}
        >
          List on {channelLabel}
        </h3>
        {title ? (
          <p className="mt-1 break-words text-sm text-neutral-600 line-clamp-2">{title}</p>
        ) : null}

        <div className="mt-6 flex flex-col items-center gap-4">
          {!done ? (
            <span
              className={`inline-block h-12 w-12 rounded-full border-4 animate-spin ${spinnerTone}`}
              aria-hidden
            />
          ) : outcome === "success" ? (
            <span
              className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 text-2xl font-semibold"
              aria-hidden
            >
              ✓
            </span>
          ) : outcome === "error" || outcome === "attention" ? (
            <span
              className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-700 text-2xl font-semibold"
              aria-hidden
            >
              !
            </span>
          ) : (
            <span
              className={`inline-block h-12 w-12 rounded-full border-4 ${spinnerTone}`}
              aria-hidden
            />
          )}

          <div>
            <p className="text-sm font-semibold text-neutral-900">{statusLabel}</p>
            {detail ? (
              <p
                className={`mt-1 break-words text-sm leading-snug ${
                  outcome === "error" || outcome === "attention"
                    ? "text-red-700"
                    : "text-neutral-600"
                }`}
              >
                {detail}
              </p>
            ) : null}
          </div>
        </div>

        {done ? (
          <button
            type="button"
            className="btn mt-6 w-full"
            style={{ color: "#fff" }}
            onClick={handleDone}
          >
            Done
          </button>
        ) : (
          <p className="mt-6 text-xs text-neutral-500">This can take a moment…</p>
        )}
      </div>
    </div>,
    document.body
  );
}
