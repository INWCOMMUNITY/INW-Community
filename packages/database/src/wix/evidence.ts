import { createHash } from "crypto";
import type { Prisma, PrismaClient, WixProviderEvidence } from "@prisma/client";
import { enqueueWixSyncJob, wixEvidenceJobDedupeKey } from "./jobs";

export type WixEvidenceDb = PrismaClient | Prisma.TransactionClient;

export class WixEvidenceIngestError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "WixEvidenceIngestError";
    this.code = code;
  }
}

export class WixEvidenceInvariantError extends Error {
  readonly code = "INVARIANT" as const;
  constructor(message: string) {
    super(message);
    this.name = "WixEvidenceInvariantError";
  }
}

/**
 * Webhook topics that require PROCESS_PROVIDER_EVIDENCE jobs for Wix.
 */
export const WIX_ORDER_WEBHOOK_TOPICS = [
  "wix.ecom.v1.order_approved",
  "wix.ecom.v1.order_canceled",
  "wix.stores.v2.order.new_order",
  "wix.stores.v2.order.paid",
] as const;

export const WIX_PRODUCT_WEBHOOK_TOPICS = [
  "wix.stores.v1.product_created",
  "wix.stores.v1.product_changed",
  "wix.stores.v1.product_deleted",
  "wix.stores.v3.product.created",
  "wix.stores.v3.product.updated",
  "wix.stores.v3.product.deleted",
] as const;

export const WIX_INVENTORY_WEBHOOK_TOPICS = [
  "wix.stores.v2.inventory_item_updated",
  "wix.stores.v3.inventory.inventory_item_updated",
  "wix.stores.v3.inventory.inventory_tracking_status_changed",
] as const;

export function hashWixWebhookPayload(rawBody: string): string {
  return createHash("sha256").update(rawBody, "utf8").digest("hex");
}

export function normalizeWixWebhookTopic(topic: string): string {
  return topic.toLowerCase().trim();
}

export type IngestWixWebhookEvidenceInput = {
  webhookId: string;
  topic: string;
  rawBody: string;
  /** App instance id from the verified JWT. Preferred connection lookup key. */
  instanceId?: string | null;
  /** Site id when the payload includes one. Fallback connection lookup key. */
  siteId?: string | null;
  eventId?: string | null;
  triggeredAt: Date;
};

export type IngestWixWebhookEvidenceResult =
  | { status: "CREATED"; evidenceId: string; jobId: string | null }
  | { status: "DUPLICATE"; evidenceId: string }
  | { status: "CONNECTION_NOT_FOUND"; siteId: string };

/**
 * Ingest a Wix webhook and enqueue a processing job.
 * Idempotent on webhookId.
 */
export async function ingestWixWebhookEvidence(
  db: PrismaClient,
  input: IngestWixWebhookEvidenceInput
): Promise<IngestWixWebhookEvidenceResult> {
  const topic = normalizeWixWebhookTopic(input.topic);
  const payloadHash = hashWixWebhookPayload(input.rawBody);

  // Check for duplicate
  const existing = await db.wixProviderEvidence.findUnique({
    where: { webhookId: input.webhookId },
    select: { id: true },
  });
  if (existing) {
    return { status: "DUPLICATE", evidenceId: existing.id };
  }

  const connection = await findActiveWixConnectionForWebhook(db, {
    instanceId: input.instanceId,
    siteId: input.siteId,
  });
  const storedSiteId = connection?.siteId ?? input.siteId ?? input.instanceId ?? "unknown";

  // Create evidence record
  let evidence: WixProviderEvidence;
  try {
    evidence = await db.wixProviderEvidence.create({
      data: {
        webhookId: input.webhookId,
        topic,
        siteId: storedSiteId,
        wixConnectionId: connection?.id ?? null,
        eventId: input.eventId ?? null,
        triggeredAt: input.triggeredAt,
        rawBody: input.rawBody,
        payloadHash,
        processState: "RECEIVED",
        receivedAt: new Date(),
      },
    });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      // Race condition - another process created the same evidence
      const raced = await db.wixProviderEvidence.findUnique({
        where: { webhookId: input.webhookId },
        select: { id: true },
      });
      if (raced) {
        return { status: "DUPLICATE", evidenceId: raced.id };
      }
    }
    throw error;
  }

  if (!connection) {
    return { status: "CONNECTION_NOT_FOUND", siteId: storedSiteId };
  }

  // Enqueue processing job
  const job = await enqueueWixSyncJob(db, {
    wixConnectionId: connection.id,
    kind: "PROCESS_PROVIDER_EVIDENCE",
    dedupeKey: wixEvidenceJobDedupeKey(input.webhookId),
    evidenceId: evidence.id,
    payload: { webhookId: input.webhookId, topic },
  });

  return { status: "CREATED", evidenceId: evidence.id, jobId: job.id };
}

/**
 * Resolve the active Wix connection for a webhook.
 * Instance id is the identity Wix puts on the JWT. Site id is the fallback.
 */
export async function resolveWixConnectionForWebhook(
  db: WixEvidenceDb,
  input: { instanceId?: string | null; siteId?: string | null }
): Promise<{ connectionId: string; memberId: string; siteId: string } | null> {
  const connection = await findActiveWixConnectionForWebhook(db, input);
  if (!connection) return null;
  return {
    connectionId: connection.id,
    memberId: connection.memberId,
    siteId: connection.siteId,
  };
}

async function findActiveWixConnectionForWebhook(
  db: WixEvidenceDb,
  input: { instanceId?: string | null; siteId?: string | null }
): Promise<{ id: string; memberId: string; siteId: string } | null> {
  if (input.instanceId) {
    const byInstance = await db.wixConnection.findFirst({
      where: { instanceId: input.instanceId, status: "ACTIVE" },
      select: { id: true, memberId: true, siteId: true },
    });
    if (byInstance) return byInstance;
  }
  if (input.siteId) {
    const bySite = await db.wixConnection.findFirst({
      where: { siteId: input.siteId, status: "ACTIVE" },
      select: { id: true, memberId: true, siteId: true },
    });
    if (bySite) return bySite;
  }
  return null;
}

/**
 * Mark evidence as processed successfully.
 */
export async function markWixEvidenceProcessed(
  db: WixEvidenceDb,
  evidenceId: string
): Promise<void> {
  await db.wixProviderEvidence.update({
    where: { id: evidenceId },
    data: {
      processState: "PROCESSED",
      processedAt: new Date(),
      lastErrorCode: null,
      lastErrorMessage: null,
    },
  });
}

/**
 * Mark evidence as ignored (e.g., topic not relevant).
 */
export async function markWixEvidenceIgnored(
  db: WixEvidenceDb,
  evidenceId: string,
  reason?: string
): Promise<void> {
  await db.wixProviderEvidence.update({
    where: { id: evidenceId },
    data: {
      processState: "IGNORED",
      processedAt: new Date(),
      lastErrorCode: reason?.slice(0, 64) ?? "IGNORED",
      lastErrorMessage: null,
    },
  });
}

/**
 * Mark evidence as errored for retry.
 */
export async function markWixEvidenceError(
  db: WixEvidenceDb,
  evidenceId: string,
  error: { code: string; message?: string }
): Promise<void> {
  await db.wixProviderEvidence.update({
    where: { id: evidenceId },
    data: {
      processState: "ERROR",
      lastErrorCode: error.code.slice(0, 64),
      lastErrorMessage: error.message?.slice(0, 2000) ?? null,
    },
  });
}

/**
 * Get evidence by ID with connection context.
 */
export async function getWixEvidenceWithConnection(
  db: WixEvidenceDb,
  evidenceId: string
): Promise<{
  evidence: WixProviderEvidence;
  connection: { id: string; memberId: string; catalogVersion: string } | null;
} | null> {
  const evidence = await db.wixProviderEvidence.findUnique({
    where: { id: evidenceId },
    include: {
      connection: {
        select: { id: true, memberId: true, catalogVersion: true },
      },
    },
  });
  if (!evidence) return null;
  return { evidence, connection: evidence.connection };
}
