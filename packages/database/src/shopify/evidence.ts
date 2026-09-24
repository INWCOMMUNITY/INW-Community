import { createHash } from "crypto";
import type { Prisma, PrismaClient, ShopifyProviderEvidence } from "@prisma/client";
import { enqueueShopifySyncJob, shopifyEvidenceJobDedupeKey } from "./jobs";

export type ShopifyEvidenceDb = PrismaClient | Prisma.TransactionClient;

export type IngestShopifyWebhookEvidenceInput = {
  shopDomain: string;
  topic: string;
  webhookId: string;
  eventId?: string | null;
  triggeredAt: Date;
  apiVersion?: string | null;
  rawBody: string;
  /** When false, persist IGNORED unbound evidence and do not enqueue. */
  enqueueProcessingJob?: boolean;
};

export type IngestShopifyWebhookEvidenceResult = {
  status: "CREATED" | "DUPLICATE";
  evidence: ShopifyProviderEvidence;
  jobId: string | null;
};

export class ShopifyEvidenceIngestError extends Error {
  readonly code: "INVALID_TIMESTAMP" | "INVALID_SHOP" | "INVALID_WEBHOOK_ID";
  constructor(code: ShopifyEvidenceIngestError["code"], message: string) {
    super(message);
    this.name = "ShopifyEvidenceIngestError";
    this.code = code;
  }
}

export class ShopifyEvidenceInvariantError extends Error {
  readonly code = "EVIDENCE_INVARIANT" as const;
  constructor(message: string) {
    super(message);
    this.name = "ShopifyEvidenceInvariantError";
  }
}

/** Topics handled by a dedicated S1 route. Generic inbox must not process them. */
export const SHOPIFY_DEDICATED_WEBHOOK_TOPICS = new Set(["app/uninstalled"]);

export function hashShopifyWebhookPayload(rawBody: string): string {
  return createHash("sha256").update(rawBody, "utf8").digest("hex");
}

/**
 * Resolve the exact connection generation that owned the shop at triggeredAt.
 * Never binds a pre-reconnect event to a newer ACTIVE generation.
 */
export async function resolveShopifyConnectionForWebhook(
  db: ShopifyEvidenceDb,
  input: { shopDomain: string; triggeredAt: Date }
): Promise<string | null> {
  const rows = await db.shopifyConnection.findMany({
    where: {
      shopDomain: input.shopDomain,
      connectedAt: { lte: input.triggeredAt },
    },
    orderBy: { connectedAt: "desc" },
    select: {
      id: true,
      connectedAt: true,
      disconnectedAt: true,
      status: true,
    },
  });

  for (const row of rows) {
    const endedAt = row.disconnectedAt;
    if (endedAt && endedAt.getTime() < input.triggeredAt.getTime()) continue;
    return row.id;
  }
  return null;
}

function isShopifyWebhookIdUniqueConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ((error as { code?: string }).code !== "P2002") return false;
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  if (typeof target === "string") {
    return (
      target === "webhook_id" ||
      target === "webhookId" ||
      target.includes("webhook_id") ||
      target.includes("webhookId")
    );
  }
  if (Array.isArray(target)) {
    return target.some(
      (field) => field === "webhook_id" || field === "webhookId" || field === "shopify_provider_evidence_webhook_id_key"
    );
  }
  return false;
}

async function loadDuplicateEvidenceResult(
  db: PrismaClient,
  webhookId: string,
  expectProcessingJob: boolean
): Promise<IngestShopifyWebhookEvidenceResult> {
  const evidence = await db.shopifyProviderEvidence.findUnique({ where: { webhookId } });
  if (!evidence) {
    throw new ShopifyEvidenceInvariantError(
      "Shopify webhook unique conflict occurred but evidence was not found"
    );
  }
  const job = await db.shopifySyncJob.findUnique({
    where: { evidenceId: evidence.id },
    select: { id: true },
  });
  if (expectProcessingJob && !job) {
    throw new ShopifyEvidenceInvariantError(
      "Shopify provider evidence exists without its required processing job"
    );
  }
  return { status: "DUPLICATE", evidence, jobId: job?.id ?? null };
}

/**
 * Persist verified webhook evidence and optionally enqueue PROCESS_PROVIDER_EVIDENCE.
 * Caller must verify HMAC before invoking. No Shopify Admin API calls.
 * Concurrent duplicate webhookId deliveries converge to DUPLICATE after unique conflict.
 */
export async function ingestShopifyWebhookEvidence(
  db: PrismaClient,
  input: IngestShopifyWebhookEvidenceInput
): Promise<IngestShopifyWebhookEvidenceResult> {
  if (!input.webhookId?.trim()) {
    throw new ShopifyEvidenceIngestError("INVALID_WEBHOOK_ID", "Webhook id is required");
  }
  if (!input.shopDomain?.trim()) {
    throw new ShopifyEvidenceIngestError("INVALID_SHOP", "Shop domain is required");
  }
  if (!(input.triggeredAt instanceof Date) || Number.isNaN(input.triggeredAt.getTime())) {
    throw new ShopifyEvidenceIngestError("INVALID_TIMESTAMP", "Triggered-at is required");
  }

  const webhookId = input.webhookId.trim();
  const topic = input.topic.trim().toLowerCase();
  const payloadHash = hashShopifyWebhookPayload(input.rawBody);
  const existing = await db.shopifyProviderEvidence.findUnique({ where: { webhookId } });
  if (existing) {
    const dedicated = SHOPIFY_DEDICATED_WEBHOOK_TOPICS.has(existing.topic);
    const expectJob =
      input.enqueueProcessingJob !== false &&
      Boolean(existing.shopifyConnectionId) &&
      !dedicated &&
      existing.processState !== "IGNORED";
    return loadDuplicateEvidenceResult(db, webhookId, expectJob);
  }

  const connectionId = await resolveShopifyConnectionForWebhook(db, {
    shopDomain: input.shopDomain,
    triggeredAt: input.triggeredAt,
  });

  const dedicated = SHOPIFY_DEDICATED_WEBHOOK_TOPICS.has(topic);
  const unbound = !connectionId;
  const shouldEnqueue =
    input.enqueueProcessingJob !== false && Boolean(connectionId) && !dedicated && !unbound;

  try {
    return await db.$transaction(async (tx) => {
      const raced = await tx.shopifyProviderEvidence.findUnique({ where: { webhookId } });
      if (raced) {
        const job = await tx.shopifySyncJob.findUnique({
          where: { evidenceId: raced.id },
          select: { id: true },
        });
        if (shouldEnqueue && !job) {
          throw new ShopifyEvidenceInvariantError(
            "Shopify provider evidence exists without its required processing job"
          );
        }
        return { status: "DUPLICATE" as const, evidence: raced, jobId: job?.id ?? null };
      }

      const processState = dedicated || unbound ? "IGNORED" : "RECEIVED";
      const evidence = await tx.shopifyProviderEvidence.create({
        data: {
          shopifyConnectionId: connectionId,
          shopDomain: input.shopDomain,
          topic,
          webhookId,
          eventId: input.eventId?.trim() || null,
          triggeredAt: input.triggeredAt,
          apiVersion: input.apiVersion?.trim() || null,
          rawBody: input.rawBody,
          payloadHash,
          processState,
          processedAt: processState === "IGNORED" ? new Date() : null,
          lastErrorCode: dedicated
            ? "DEDICATED_ROUTE"
            : unbound
              ? "UNBOUND_GENERATION"
              : null,
          lastErrorMessage: dedicated
            ? "Topic is handled by a dedicated Shopify route"
            : unbound
              ? "No Shopify connection generation matched the webhook trigger time"
              : null,
        },
      });

      if (!shouldEnqueue || !connectionId) {
        return { status: "CREATED" as const, evidence, jobId: null };
      }

      const job = await enqueueShopifySyncJob(tx, {
        shopifyConnectionId: connectionId,
        kind: "PROCESS_PROVIDER_EVIDENCE",
        dedupeKey: shopifyEvidenceJobDedupeKey(webhookId),
        evidenceId: evidence.id,
        payload: {
          evidenceId: evidence.id,
          webhookId,
          topic,
        } satisfies Prisma.InputJsonValue,
      });
      return { status: "CREATED" as const, evidence, jobId: job.id };
    });
  } catch (error) {
    if (error instanceof ShopifyEvidenceInvariantError) throw error;
    if (!isShopifyWebhookIdUniqueConflict(error)) throw error;
    // Transaction is aborted; re-read on a fresh connection after the winner commits.
    return loadDuplicateEvidenceResult(db, webhookId, shouldEnqueue);
  }
}
