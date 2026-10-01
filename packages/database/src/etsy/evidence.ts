import { createHash } from "crypto";
import type { Prisma, PrismaClient, EtsyProviderEvidence } from "@prisma/client";
import { enqueueEtsySyncJob, etsyEvidenceJobDedupeKey } from "./jobs";

export type EtsyEvidenceDb = PrismaClient | Prisma.TransactionClient;

export const ETSY_ORDER_WEBHOOK_TOPICS = new Set([
  "order.paid",
  "order.canceled",
  "order.shipped",
  "order.delivered",
]);

export type IngestEtsyWebhookEvidenceInput = {
  shopId: string;
  topic: string;
  webhookId: string;
  eventId?: string | null;
  triggeredAt: Date;
  rawBody: string;
  enqueueProcessingJob?: boolean;
};

export type IngestEtsyWebhookEvidenceResult = {
  status: "CREATED" | "DUPLICATE";
  evidence: EtsyProviderEvidence;
  jobId: string | null;
};

export class EtsyEvidenceIngestError extends Error {
  readonly code: "INVALID_TIMESTAMP" | "INVALID_SHOP" | "INVALID_WEBHOOK_ID" | "UNSUPPORTED_TOPIC";
  constructor(code: EtsyEvidenceIngestError["code"], message: string) {
    super(message);
    this.name = "EtsyEvidenceIngestError";
    this.code = code;
  }
}

export class EtsyEvidenceInvariantError extends Error {
  readonly code = "EVIDENCE_INVARIANT" as const;
  constructor(message: string) {
    super(message);
    this.name = "EtsyEvidenceInvariantError";
  }
}

export function normalizeEtsyWebhookTopic(topic: string): string {
  return topic.trim().toLowerCase().replace(/_/g, ".");
}

export function hashEtsyWebhookPayload(rawBody: string): string {
  return createHash("sha256").update(rawBody, "utf8").digest("hex");
}

/**
 * Resolve the connection generation that owned the shop at triggeredAt.
 * Never binds a pre-reconnect event to a newer ACTIVE generation.
 */
export async function resolveEtsyConnectionForWebhook(
  db: EtsyEvidenceDb,
  input: { shopId: string; triggeredAt: Date }
): Promise<string | null> {
  const rows = await db.etsyConnection.findMany({
    where: {
      shopId: input.shopId,
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

function isEtsyWebhookIdUniqueConflict(error: unknown): boolean {
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
      (field) =>
        field === "webhook_id" ||
        field === "webhookId" ||
        field === "etsy_provider_evidence_webhook_id_key"
    );
  }
  return false;
}

async function loadDuplicateEvidenceResult(
  db: PrismaClient,
  webhookId: string,
  expectProcessingJob: boolean
): Promise<IngestEtsyWebhookEvidenceResult> {
  const evidence = await db.etsyProviderEvidence.findUnique({ where: { webhookId } });
  if (!evidence) {
    throw new EtsyEvidenceInvariantError(
      "Etsy webhook unique conflict occurred but evidence was not found"
    );
  }
  const job = await db.etsySyncJob.findUnique({
    where: { evidenceId: evidence.id },
    select: { id: true },
  });
  if (expectProcessingJob && !job) {
    throw new EtsyEvidenceInvariantError(
      "Etsy provider evidence exists without its required processing job"
    );
  }
  return { status: "DUPLICATE", evidence, jobId: job?.id ?? null };
}

/**
 * Persist verified webhook evidence and optionally enqueue PROCESS_PROVIDER_EVIDENCE.
 * Caller must verify signature before invoking. No Etsy API calls.
 */
export async function ingestEtsyWebhookEvidence(
  db: PrismaClient,
  input: IngestEtsyWebhookEvidenceInput
): Promise<IngestEtsyWebhookEvidenceResult> {
  if (!input.webhookId?.trim()) {
    throw new EtsyEvidenceIngestError("INVALID_WEBHOOK_ID", "Webhook id is required");
  }
  if (!input.shopId?.trim() || !/^\d+$/.test(input.shopId.trim())) {
    throw new EtsyEvidenceIngestError("INVALID_SHOP", "Shop id is required");
  }
  if (!(input.triggeredAt instanceof Date) || Number.isNaN(input.triggeredAt.getTime())) {
    throw new EtsyEvidenceIngestError("INVALID_TIMESTAMP", "Triggered-at is required");
  }

  const webhookId = input.webhookId.trim();
  const shopId = input.shopId.trim();
  const topic = normalizeEtsyWebhookTopic(input.topic);
  if (!ETSY_ORDER_WEBHOOK_TOPICS.has(topic)) {
    throw new EtsyEvidenceIngestError("UNSUPPORTED_TOPIC", `Unsupported Etsy topic: ${topic}`);
  }

  const payloadHash = hashEtsyWebhookPayload(input.rawBody);
  const existing = await db.etsyProviderEvidence.findUnique({ where: { webhookId } });
  if (existing) {
    const expectJob =
      input.enqueueProcessingJob !== false &&
      Boolean(existing.etsyConnectionId) &&
      existing.processState !== "IGNORED";
    return loadDuplicateEvidenceResult(db, webhookId, expectJob);
  }

  const connectionId = await resolveEtsyConnectionForWebhook(db, {
    shopId,
    triggeredAt: input.triggeredAt,
  });
  const unbound = !connectionId;
  const shouldEnqueue =
    input.enqueueProcessingJob !== false && Boolean(connectionId) && !unbound;

  try {
    return await db.$transaction(async (tx) => {
      const raced = await tx.etsyProviderEvidence.findUnique({ where: { webhookId } });
      if (raced) {
        const job = await tx.etsySyncJob.findUnique({
          where: { evidenceId: raced.id },
          select: { id: true },
        });
        if (shouldEnqueue && !job) {
          throw new EtsyEvidenceInvariantError(
            "Etsy provider evidence exists without its required processing job"
          );
        }
        return { status: "DUPLICATE" as const, evidence: raced, jobId: job?.id ?? null };
      }

      const processState = unbound ? "IGNORED" : "RECEIVED";
      const evidence = await tx.etsyProviderEvidence.create({
        data: {
          etsyConnectionId: connectionId,
          shopId,
          topic,
          webhookId,
          eventId: input.eventId?.trim() || null,
          triggeredAt: input.triggeredAt,
          rawBody: input.rawBody,
          payloadHash,
          processState,
          processedAt: processState === "IGNORED" ? new Date() : null,
          lastErrorCode: unbound ? "UNBOUND_GENERATION" : null,
          lastErrorMessage: unbound
            ? "No Etsy connection generation matched the webhook trigger time"
            : null,
        },
      });

      if (!shouldEnqueue || !connectionId) {
        return { status: "CREATED" as const, evidence, jobId: null };
      }

      const job = await enqueueEtsySyncJob(tx, {
        etsyConnectionId: connectionId,
        kind: "PROCESS_PROVIDER_EVIDENCE",
        dedupeKey: etsyEvidenceJobDedupeKey(webhookId),
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
    if (error instanceof EtsyEvidenceInvariantError) throw error;
    if (!isEtsyWebhookIdUniqueConflict(error)) throw error;
    return loadDuplicateEvidenceResult(db, webhookId, shouldEnqueue);
  }
}
