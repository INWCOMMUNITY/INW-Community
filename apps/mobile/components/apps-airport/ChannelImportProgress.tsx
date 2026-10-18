import React, { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { theme } from "@/lib/theme";
import { apiGet } from "@/lib/api";

export type ImportBatchSnapshot = {
  state: string;
  total: number;
  processed: number;
  remaining?: number;
  scanning?: boolean;
  percent?: number | null;
  avgItemMs?: number | null;
  etaSeconds?: number | null;
  startedAt?: string | null;
  lastProgressAt?: string | null;
  lastError?: string | null;
  cancelRequested?: boolean;
};

export const IMPORT_LEAVE_NOTE =
  "You can leave this page — import continues in the background.";

function batchIsActive(batch: ImportBatchSnapshot | null): boolean {
  return batch != null && (batch.state === "PENDING" || batch.state === "RUNNING");
}

export function formatImportEta(seconds: number | null | undefined): string {
  if (seconds == null) return "Calculating…";
  if (seconds < 60) return `About ${seconds}s remaining`;
  const mins = Math.ceil(seconds / 60);
  if (mins < 60) return `About ${mins} min remaining`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `About ${hrs}h ${rem}m remaining` : `About ${hrs}h remaining`;
}

/** Fills while the current listing is still importing, then snaps ahead as each one finishes. */
export function importBarPercent(batch: ImportBatchSnapshot, nowMs: number): number {
  if (batch.state === "COMPLETED" || batch.state === "CANCELLED") return 100;
  if (batch.scanning) {
    const wave = (Math.sin(nowMs / 450) + 1) / 2;
    return 10 + wave * 22;
  }
  const total = Math.max(1, batch.total);
  const done = batch.processed;
  if (!batchIsActive(batch)) return batch.percent ?? Math.round((done / total) * 100);
  const anchor = batch.lastProgressAt ?? batch.startedAt;
  const elapsed = anchor ? Math.max(0, nowMs - new Date(anchor).getTime()) : 0;
  const itemMs = batch.avgItemMs && batch.avgItemMs > 0 ? batch.avgItemMs : 12_000;
  const remaining =
    typeof batch.remaining === "number" ? batch.remaining : Math.max(0, batch.total - done);
  const slice = remaining > 0 ? Math.min(0.9, elapsed / itemMs) : 0;
  return Math.min(99, ((done + slice) / total) * 100);
}

function progressLabel(batch: ImportBatchSnapshot): string | null {
  if (!batchIsActive(batch)) return null;
  if (batch.cancelRequested) return "Cancelling import…";
  if (batch.scanning || batch.total <= 0) return "Finding listings…";
  const done = Math.min(batch.processed, batch.total);
  return `${done}/${batch.total} listings imported`;
}

export function ImportProgressTrack({ percent }: { percent: number }) {
  const width = Math.max(0, Math.min(100, percent));
  return (
    <View style={styles.track} accessibilityRole="progressbar">
      <View style={[styles.fill, { width: `${width}%` }]} />
    </View>
  );
}

export function LiveImportBar({ batch }: { batch: ImportBatchSnapshot }) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const active = batchIsActive(batch);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNowMs(Date.now()), 400);
    return () => clearInterval(id);
  }, [active]);
  return <ImportProgressTrack percent={importBarPercent(batch, nowMs)} />;
}

/** Hub bar while an Etsy or Shopify import is still running after the seller leaves Import. */
export function ChannelImportProgress({
  channel,
  onProgress,
}: {
  channel: "etsy" | "shopify";
  onProgress?: (processed: number) => void;
}) {
  const [batch, setBatch] = useState<ImportBatchSnapshot | null>(null);
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;
  const lastProcessed = useRef<number | null>(null);

  const poll = useCallback(async () => {
    const endpoint = channel === "etsy" ? "/api/etsy/import/batch" : "/api/shopify/import/batch";
    try {
      const body = await apiGet<{ batch?: ImportBatchSnapshot | null }>(endpoint);
      const next = body.batch ?? null;
      setBatch(next);
      if (next && batchIsActive(next) && lastProcessed.current !== next.processed) {
        lastProcessed.current = next.processed;
        onProgressRef.current?.(next.processed);
      }
    } catch {
      /* The bar hides if the status request fails. */
    }
  }, [channel]);

  useFocusEffect(
    useCallback(() => {
      void poll();
      const id = setInterval(() => void poll(), 2500);
      return () => clearInterval(id);
    }, [poll])
  );

  const label = batch ? progressLabel(batch) : null;
  if (!batch || !label) return null;

  return (
    <View style={styles.wrap} accessibilityRole="summary">
      <Text style={styles.label}>{label}</Text>
      <LiveImportBar batch={batch} />
      <Text style={styles.note}>
        {formatImportEta(batch.etaSeconds)}. {IMPORT_LEAVE_NOTE}
      </Text>
      {batch.lastError ? <Text style={styles.warn}>{batch.lastError}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: "700", color: theme.colors.heading, marginBottom: 8 },
  note: { marginTop: 8, fontSize: 13, lineHeight: 18, color: "#666" },
  warn: { marginTop: 6, fontSize: 13, lineHeight: 18, color: "#92400e" },
  track: {
    height: 10,
    borderRadius: 999,
    backgroundColor: "#e5e5e5",
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: theme.colors.primary,
  },
});
