"use client";

import { useEffect, useRef, useState } from "react";
import {
  importProgressLabel,
  importProgressPercent,
  type ImportBatchProgress,
} from "@/components/apps-airport/import-progress";

export function ChannelImportProgress({
  channel,
  onProgress,
}: {
  channel: "etsy" | "shopify";
  onProgress?: (processed: number) => void;
}) {
  const [batch, setBatch] = useState<ImportBatchProgress | null>(null);
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;
  const lastProcessed = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const endpoint = channel === "etsy" ? "/api/etsy/import/batch" : "/api/shopify/import/batch";

    async function poll() {
      try {
        const response = await fetch(endpoint, { credentials: "include" });
        if (!response.ok) return;
        const body = (await response.json()) as { batch?: ImportBatchProgress | null };
        if (cancelled) return;
        const next = body.batch ?? null;
        setBatch(next);
        const active = next != null && (next.state === "PENDING" || next.state === "RUNNING");
        if (active && lastProcessed.current !== next.processed) {
          lastProcessed.current = next.processed;
          onProgressRef.current?.(next.processed);
        }
      } catch {
        /* The bar hides if the status request fails. */
      }
    }

    void poll();
    const id = window.setInterval(() => void poll(), 2500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [channel]);

  const label = batch ? importProgressLabel(batch) : null;
  if (!batch || !label) return null;

  return (
    <div className="mb-6" role="status" aria-live="polite">
      <p className="mb-1.5 text-sm font-medium" style={{ color: "var(--color-heading)" }}>
        {label}
      </p>
      <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-200">
        <div
          className="h-full rounded-full transition-[width] duration-300"
          style={{
            width: `${importProgressPercent(batch)}%`,
            backgroundColor: "var(--color-primary)",
          }}
        />
      </div>
    </div>
  );
}
