import type {
  Prisma,
  PrismaClient,
  ShopifyImportBatch,
  ShopifyImportStockModePolicy,
} from "@prisma/client";

export type ShopifyImportBatchDb = PrismaClient | Prisma.TransactionClient;

export type ShopifyImportBatchFailure = {
  shopifyProductId: string;
  message: string;
};

const MAX_FAILURES_KEPT = 40;
/** Seed until the first item finishes (GraphQL re-read + mapping + bootstrap). */
export const SHOPIFY_IMPORT_BATCH_DEFAULT_ITEM_MS = 15_000;

export function shopifyImportBatchDedupeKey(connectionId: string, batchId: string): string {
  return `IMPORT_BATCH:${connectionId}:${batchId}`;
}

export function parseShopifyImportBatchQueue(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const id = entry.trim();
    if (!id.startsWith("gid://shopify/Product/") || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function parseShopifyImportBatchFailures(raw: unknown): ShopifyImportBatchFailure[] {
  if (!Array.isArray(raw)) return [];
  const out: ShopifyImportBatchFailure[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as { shopifyProductId?: unknown; message?: unknown };
    const shopifyProductId =
      typeof rec.shopifyProductId === "string" ? rec.shopifyProductId.trim() : "";
    const message = typeof rec.message === "string" ? rec.message.trim() : "";
    if (!shopifyProductId || !message) continue;
    out.push({ shopifyProductId, message: message.slice(0, 400) });
    if (out.length >= MAX_FAILURES_KEPT) break;
  }
  return out;
}

export function appendShopifyImportBatchFailures(
  existing: unknown,
  next: ShopifyImportBatchFailure[]
): ShopifyImportBatchFailure[] {
  const merged = [...parseShopifyImportBatchFailures(existing), ...next];
  return merged.slice(-MAX_FAILURES_KEPT);
}

export function resolveShopifyImportStockMode(
  policy: ShopifyImportStockModePolicy,
  recommended: "PHYSICAL" | "MADE_TO_ORDER" | null | undefined
): "PHYSICAL" | "MADE_TO_ORDER" {
  if (policy === "PHYSICAL" || policy === "MADE_TO_ORDER") return policy;
  return recommended === "MADE_TO_ORDER" ? "MADE_TO_ORDER" : "PHYSICAL";
}

export type ShopifyImportBatchProgressView = {
  id: string;
  state: ShopifyImportBatch["state"];
  stockModePolicy: ShopifyImportStockModePolicy;
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
  failures: ShopifyImportBatchFailure[];
};

export function shopifyImportBatchProgressView(
  batch: ShopifyImportBatch
): ShopifyImportBatchProgressView {
  const processed = batch.completed + batch.failed + batch.skipped;
  const queueLen = parseShopifyImportBatchQueue(batch.queueJson).length;
  const remaining = batch.discoverComplete
    ? Math.max(0, batch.total - processed)
    : Math.max(queueLen, Math.max(0, batch.total - processed));
  const scanning = !batch.discoverComplete && batch.total === 0 && processed === 0;
  const avgItemMs =
    batch.avgItemMs ?? (processed > 0 ? null : SHOPIFY_IMPORT_BATCH_DEFAULT_ITEM_MS);
  const etaSeconds =
    remaining > 0 && avgItemMs != null
      ? Math.max(1, Math.ceil((remaining * avgItemMs) / 1000))
      : null;
  const percent =
    batch.total > 0
      ? Math.min(100, Math.round((processed / batch.total) * 100))
      : scanning
        ? null
        : 0;

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
    failures: parseShopifyImportBatchFailures(batch.failuresJson),
  };
}

export function nextShopifyImportBatchAvgItemMs(
  prevAvgMs: number | null | undefined,
  processedBefore: number,
  itemMs: number
): number {
  const sample = Math.max(100, Math.min(itemMs, 180_000));
  if (prevAvgMs == null || processedBefore <= 0) return sample;
  return Math.round(prevAvgMs * 0.7 + sample * 0.3);
}

export async function findActiveShopifyImportBatch(
  db: ShopifyImportBatchDb,
  connectionId: string
): Promise<ShopifyImportBatch | null> {
  return db.shopifyImportBatch.findFirst({
    where: {
      shopifyConnectionId: connectionId,
      state: { in: ["PENDING", "RUNNING"] },
    },
    orderBy: { createdAt: "desc" },
  });
}
