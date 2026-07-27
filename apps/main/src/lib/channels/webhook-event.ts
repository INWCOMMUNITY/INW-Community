import { prisma, Prisma } from "database";
import type { ChannelProvider } from "./types";

export type WebhookEventStatus = "pending" | "processing" | "completed" | "failed";

/**
 * Log a webhook event before processing to ensure delivery guarantee.
 * Returns the event ID for status updates.
 */
export async function logWebhookEvent(
  provider: ChannelProvider,
  eventType: string,
  payload?: unknown,
  externalEventId?: string
): Promise<string> {
  const event = await prisma.channelWebhookEvent.create({
    data: {
      provider,
      eventType,
      externalEventId: externalEventId ?? null,
      payload: payload ? (payload as object) : Prisma.JsonNull,
      status: "pending",
    },
  });
  return event.id;
}

/**
 * Mark a webhook event as processing.
 */
export async function markWebhookProcessing(eventId: string): Promise<void> {
  await prisma.channelWebhookEvent
    .update({
      where: { id: eventId },
      data: { status: "processing" },
    })
    .catch(() => {});
}

/**
 * Mark a webhook event as completed.
 */
export async function markWebhookCompleted(eventId: string): Promise<void> {
  await prisma.channelWebhookEvent
    .update({
      where: { id: eventId },
      data: {
        status: "completed",
        processedAt: new Date(),
      },
    })
    .catch(() => {});
}

/**
 * Mark a webhook event as failed.
 */
export async function markWebhookFailed(eventId: string, error: string): Promise<void> {
  await prisma.channelWebhookEvent
    .update({
      where: { id: eventId },
      data: {
        status: "failed",
        error: error.slice(0, 1000),
        processedAt: new Date(),
      },
    })
    .catch(() => {});
}

/**
 * Find stale pending webhook events (older than 5 minutes) for reprocessing.
 */
export async function findStaleWebhookEvents(limit = 50): Promise<
  Array<{
    id: string;
    provider: string;
    eventType: string;
    externalEventId: string | null;
    payload: unknown;
  }>
> {
  const cutoff = new Date(Date.now() - 5 * 60 * 1000);
  return prisma.channelWebhookEvent.findMany({
    where: {
      status: "pending",
      createdAt: { lt: cutoff },
    },
    select: {
      id: true,
      provider: true,
      eventType: true,
      externalEventId: true,
      payload: true,
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
}

/**
 * Clean up old completed/failed webhook events (older than 7 days).
 */
export async function cleanupOldWebhookEvents(): Promise<number> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const result = await prisma.channelWebhookEvent.deleteMany({
    where: {
      status: { in: ["completed", "failed"] },
      createdAt: { lt: cutoff },
    },
  });
  return result.count;
}
