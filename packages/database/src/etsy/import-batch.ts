import type { EtsyImportBatch, EtsyImportStockModePolicy, Prisma, PrismaClient } from "@prisma/client";

export type EtsyImportBatchDb = PrismaClient | Prisma.TransactionClient;

export type EtsyImportBatchFailure = {
  etsyListingId: string;
  message: string;
};

const MAX_FAILURES_KEPT = 40;
/** Seed until the first item finishes (~photo rehost + mapping). */
export const ETSY_IMPORT_BATCH_DEFAULT_ITEM_MS = 12_000;

export function etsyImportBatchDedupeKey(connectionId: string, batchId: string): string {
  return `IMPORT_BATCH:${connectionId}:${batchId}`;
}

export function parseEtsyImportBatchQueue(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const id = entry.trim();
    if (!/^\d+$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function parseEtsyImportBatchFailures(raw: unknown): EtsyImportBatchFailure[] {
  if (!Array.isArray(raw)) return [];
  const out: EtsyImportBatchFailure[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as { etsyListingId?: unknown; message?: unknown };
    const etsyListingId =
      typeof rec.etsyListingId === "string" ? rec.etsyListingId.trim() : "";
    const message = typeof rec.message === "string" ? rec.message.trim() : "";
    if (!etsyListingId || !message) continue;
    out.push({ etsyListingId, message: message.slice(0, 400) });
    if (out.length >= MAX_FAILURES_KEPT) break;
  }
  return out;
}

export function appendEtsyImportBatchFailures(
  existing: unknown,
  next: EtsyImportBatchFailure[]
): EtsyImportBatchFailure[] {
  const merged = [...parseEtsyImportBatchFailures(existing), ...next];
  return merged.slice(-MAX_FAILURES_KEPT);
}

export function resolveEtsyImportStockMode(
  policy: EtsyImportStockModePolicy,
  recommended: "PHYSICAL" | "MADE_TO_ORDER" | null | undefined
): "PHYSICAL" | "MADE_TO_ORDER" {
  if (policy === "PHYSICAL" || policy === "MADE_TO_ORDER") return policy;
  return recommended === "MADE_TO_ORDER" ? "MADE_TO_ORDER" : "PHYSICAL";
}

export type EtsyImportBatchProgressView = {
  id: string;
  state: EtsyImportBatch["state"];
  stockModePolicy: EtsyImportStockModePolicy;
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  processed: number;
  remaining: number;
  discoverComplete: boolean;
  scanning: boolean;
  percent: number | null;
  avgItemMs: number | null;
  etaSeconds: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  lastProgressAt: string | null;
  lastError: string | null;
  cancelRequested: boolean;
  failures: EtsyImportBatchFailure[];
};

export function etsyImportBatchProgressView(batch: EtsyImportBatch): EtsyImportBatchProgressView {
  const processed = batch.completed + batch.failed + batch.skipped;
  const queueLen = parseEtsyImportBatchQueue(batch.queueJson).length;
  const remaining = batch.discoverComplete
    ? Math.max(0, batch.total - processed)
    : Math.max(queueLen, Math.max(0, batch.total - processed));
  const scanning = !batch.discoverComplete && batch.total === 0 && processed === 0;
  const avgItemMs = batch.avgItemMs ?? (processed > 0 ? null : ETSY_IMPORT_BATCH_DEFAULT_ITEM_MS);
  const etaSeconds =
    remaining > 0 && avgItemMs != null ? Math.max(1, Math.ceil((remaining * avgItemMs) / 1000)) : null;
  const percent =
    batch.total > 0 ? Math.min(100, Math.round((processed / batch.total) * 100)) : scanning ? null : 0;

  return {
    id: batch.id,
    state: batch.state,
    stockModePolicy: batch.stockModePolicy,
    total: batch.total,
    completed: batch.completed,
    failed: batch.failed,
    skipped: batch.skipped,
    processed,
    remaining,
    discoverComplete: batch.discoverComplete,
    scanning,
    percent,
    avgItemMs: batch.avgItemMs,
    etaSeconds,
    startedAt: batch.startedAt?.toISOString() ?? null,
    finishedAt: batch.finishedAt?.toISOString() ?? null,
    lastProgressAt: batch.lastProgressAt?.toISOString() ?? null,
    lastError: batch.lastError,
    cancelRequested: batch.cancelRequested,
    failures: parseEtsyImportBatchFailures(batch.failuresJson),
  };
}

export function nextEtsyImportBatchAvgItemMs(
  prevAvgMs: number | null | undefined,
  processedBefore: number,
  itemMs: number
): number {
  const sample = Math.max(100, Math.min(itemMs, 120_000));
  if (prevAvgMs == null || processedBefore <= 0) return sample;
  // Exponential moving average — recent items weigh more.
  return Math.round(prevAvgMs * 0.7 + sample * 0.3);
}

export async function findActiveEtsyImportBatch(
  db: EtsyImportBatchDb,
  connectionId: string
): Promise<EtsyImportBatch | null> {
  return db.etsyImportBatch.findFirst({
    where: {
      etsyConnectionId: connectionId,
      state: { in: ["PENDING", "RUNNING"] },
    },
    orderBy: { createdAt: "desc" },
  });
}
