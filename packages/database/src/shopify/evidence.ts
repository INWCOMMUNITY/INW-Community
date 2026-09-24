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

export type IngestShopifyWebhookEvidenceResult =
  | {
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

/**
 * Persist verified webhook evidence and optionally enqueue PROCESS_PROVIDER_EVIDENCE.
 * Caller must verify HMAC before invoking. No Shopify Admin API calls.
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
    const job = existing.id
      ? await db.shopifySyncJob.findUnique({ where: { evidenceId: existing.id }, select: { id: true } })
      : null;
    return { status: "DUPLICATE", evidence: existing, jobId: job?.id ?? null };
  }

  const connectionId = await resolveShopifyConnectionForWebhook(db, {
    shopDomain: input.shopDomain,
    triggeredAt: input.triggeredAt,
  });

  const dedicated = SHOPIFY_DEDICATED_WEBHOOK_TOPICS.has(topic);
  const unbound = !connectionId;
  const shouldEnqueue =
    input.enqueueProcessingJob !== false && Boolean(connectionId) && !dedicated && !unbound;

  return db.$transaction(async (tx) => {
    const raced = await tx.shopifyProviderEvidence.findUnique({ where: { webhookId } });
    if (raced) {
      const job = await tx.shopifySyncJob.findUnique({
        where: { evidenceId: raced.id },
        select: { id: true },
      });
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
}
