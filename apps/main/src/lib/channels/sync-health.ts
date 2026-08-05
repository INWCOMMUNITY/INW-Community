/**
 * Sync Health Calculator
 * Provides health metrics for multi-platform channel sync.
 */

import { prisma } from "database";
import type { ChannelProvider } from "./types";

export interface ChannelHealthSummary {
  provider: ChannelProvider;
  connectionId: string;
  connectionStatus: string;
  status: "healthy" | "warning" | "error";
  lastSyncAt: Date | null;
  pendingRetries: number;
  errorCount24h: number;
  totalLinkedItems: number;
  itemsWithErrors: number;
  itemsWithConflicts: number;
  categoriesMapped: number;
  categoriesUnmapped: number;
  lastError: string | null;
}

export interface SyncIssue {
  id: string;
  storeItemId: string;
  storeItemTitle: string;
  provider: ChannelProvider;
  issueType: "error" | "conflict" | "pending_retry";
  syncStatus: string;
  syncError: string | null;
  conflictResolution: string | null;
  lastConflictAt: Date | null;
  nextRetryAt: Date | null;
  retryAttempts: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Calculate health summary for a single channel connection.
 */
async function calculateConnectionHealth(
  connection: {
    id: string;
    provider: string;
    status: string;
    lastError: string | null;
    lastReconciledAt: Date | null;
  },
  memberId: string
): Promise<ChannelHealthSummary> {
  const provider = connection.provider as ChannelProvider;

  // Get linked items stats
  const [
    totalLinked,
    itemsWithErrors,
    itemsWithConflicts,
    pendingRetries,
    errorLogs24h,
    categoriesStats,
  ] = await Promise.all([
    // Total linked items
    prisma.channelListingLink.count({
      where: { connectionId: connection.id },
    }),
    // Items with sync errors
    prisma.channelListingLink.count({
      where: { connectionId: connection.id, syncStatus: "error" },
    }),
    // Items with pending conflicts
    prisma.channelListingLink.count({
      where: { connectionId: connection.id, conflictResolution: "pending" },
    }),
    // Pending retries
    prisma.channelSyncRetry.count({
      where: {
        link: { connectionId: connection.id },
        nextRetryAt: { gt: new Date() },
      },
    }),
    // Error logs in last 24 hours
    prisma.channelSyncLog.count({
      where: {
        memberId,
        provider,
        action: { in: ["error", "error_permanent", "retry_exhausted"] },
        createdAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    }),
    // Categories stats
    prisma.channelListingLink.findMany({
      where: { connectionId: connection.id },
      select: {
        storeItem: {
          select: { category: true },
        },
      },
    }),
  ]);

  // Count mapped vs unmapped categories
  let categoriesMapped = 0;
  let categoriesUnmapped = 0;
  for (const link of categoriesStats) {
    if (link.storeItem?.category) {
      categoriesMapped++;
    } else {
      categoriesUnmapped++;
    }
  }

  // Determine overall health status
  let status: "healthy" | "warning" | "error" = "healthy";
  if (connection.status === "error" || connection.status === "disconnected") {
    status = "error";
  } else if (itemsWithErrors > 0 || errorLogs24h > 5) {
    status = "error";
  } else if (pendingRetries > 0 || itemsWithConflicts > 0 || errorLogs24h > 0) {
    status = "warning";
  }

  return {
    provider,
    connectionId: connection.id,
    connectionStatus: connection.status,
    status,
    lastSyncAt: connection.lastReconciledAt,
    pendingRetries,
    errorCount24h: errorLogs24h,
    totalLinkedItems: totalLinked,
    itemsWithErrors,
    itemsWithConflicts,
    categoriesMapped,
    categoriesUnmapped,
    lastError: connection.lastError,
  };
}

/**
 * Get health summary for all connected channels for a seller.
 */
export async function calculateChannelHealth(
  memberId: string
): Promise<ChannelHealthSummary[]> {
  const connections = await prisma.channelConnection.findMany({
    where: { memberId },
    select: {
      id: true,
      provider: true,
      status: true,
      lastError: true,
      lastReconciledAt: true,
    },
  });

  const results = await Promise.all(
    connections.map((conn) => calculateConnectionHealth(conn, memberId))
  );

  return results;
}

/**
 * Get detailed sync issues for a seller.
 */
export async function getSyncIssues(params: {
  memberId: string;
  provider?: ChannelProvider;
  issueType?: "error" | "conflict" | "pending_retry";
  limit?: number;
  offset?: number;
}): Promise<{ issues: SyncIssue[]; total: number }> {
  const { memberId, provider, issueType, limit = 50, offset = 0 } = params;

  // Build where clause for links
  const linkWhere: Record<string, unknown> = {
    connection: { memberId },
  };
  if (provider) {
    linkWhere.provider = provider;
  }

  // Filter by issue type
  if (issueType === "error") {
    linkWhere.syncStatus = "error";
  } else if (issueType === "conflict") {
    linkWhere.conflictResolution = "pending";
  }
  // pending_retry handled separately via ChannelSyncRetry

  const [links, retries, totalLinks, totalRetries] = await Promise.all([
    // Get links with issues
    prisma.channelListingLink.findMany({
      where: {
        ...linkWhere,
        OR: issueType
          ? undefined
          : [{ syncStatus: "error" }, { conflictResolution: "pending" }],
      },
      include: {
        storeItem: { select: { title: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: issueType === "pending_retry" ? 0 : limit,
      skip: issueType === "pending_retry" ? 0 : offset,
    }),
    // Get pending retries
    issueType === "error" || issueType === "conflict"
      ? []
      : prisma.channelSyncRetry.findMany({
          where: {
            link: {
              connection: { memberId },
              ...(provider ? { provider } : {}),
            },
            nextRetryAt: { gt: new Date() },
          },
          include: {
            link: {
              include: {
                storeItem: { select: { title: true } },
              },
            },
          },
          orderBy: { nextRetryAt: "asc" },
          take: issueType === "pending_retry" ? limit : limit - links.length,
          skip: issueType === "pending_retry" ? offset : 0,
        }),
    prisma.channelListingLink.count({
      where: {
        ...linkWhere,
        OR: issueType
          ? undefined
          : [{ syncStatus: "error" }, { conflictResolution: "pending" }],
      },
    }),
    prisma.channelSyncRetry.count({
      where: {
        link: {
          connection: { memberId },
          ...(provider ? { provider } : {}),
        },
        nextRetryAt: { gt: new Date() },
      },
    }),
  ]);

  const issues: SyncIssue[] = [];

  // Map links to issues
  for (const link of links) {
    issues.push({
      id: link.id,
      storeItemId: link.storeItemId,
      storeItemTitle: link.storeItem?.title ?? "Unknown Item",
      provider: link.provider as ChannelProvider,
      issueType: link.conflictResolution === "pending" ? "conflict" : "error",
      syncStatus: link.syncStatus,
      syncError: link.syncError,
      conflictResolution: link.conflictResolution,
      lastConflictAt: link.lastConflictAt,
      nextRetryAt: null,
      retryAttempts: 0,
      createdAt: link.createdAt,
      updatedAt: link.updatedAt,
    });
  }

  // Map retries to issues
  for (const retry of retries) {
    issues.push({
      id: retry.id,
      storeItemId: retry.storeItemId,
      storeItemTitle: retry.link.storeItem?.title ?? "Unknown Item",
      provider: retry.provider as ChannelProvider,
      issueType: "pending_retry",
      syncStatus: "pending",
      syncError: retry.lastError,
      conflictResolution: null,
      lastConflictAt: null,
      nextRetryAt: retry.nextRetryAt,
      retryAttempts: retry.attempts,
      createdAt: retry.createdAt,
      updatedAt: retry.createdAt,
    });
  }

  // Sort combined issues by updated time
  issues.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  return {
    issues: issues.slice(0, limit),
    total:
      issueType === "pending_retry"
        ? totalRetries
        : issueType
          ? totalLinks
          : totalLinks + totalRetries,
  };
}

/**
 * Get overall platform health for admin dashboard.
 */
export async function getPlatformSyncHealth(): Promise<{
  totalConnections: number;
  healthyConnections: number;
  warningConnections: number;
  errorConnections: number;
  totalLinkedItems: number;
  itemsWithErrors: number;
  errorLogs24h: number;
  byProvider: Record<string, { connections: number; errors: number }>;
}> {
  const [
    connections,
    totalLinkedItems,
    itemsWithErrors,
    errorLogs24h,
  ] = await Promise.all([
    prisma.channelConnection.findMany({
      select: {
        provider: true,
        status: true,
        _count: {
          select: {
            listingLinks: { where: { syncStatus: "error" } },
          },
        },
      },
    }),
    prisma.channelListingLink.count(),
    prisma.channelListingLink.count({ where: { syncStatus: "error" } }),
    prisma.channelSyncLog.count({
      where: {
        action: { in: ["error", "error_permanent", "retry_exhausted"] },
        createdAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    }),
  ]);

  let healthyConnections = 0;
  let warningConnections = 0;
  let errorConnections = 0;
  const byProvider: Record<string, { connections: number; errors: number }> = {};

  for (const conn of connections) {
    const provider = conn.provider;
    if (!byProvider[provider]) {
      byProvider[provider] = { connections: 0, errors: 0 };
    }
    byProvider[provider].connections++;
    byProvider[provider].errors += conn._count.listingLinks;

    if (conn.status === "error" || conn.status === "disconnected") {
      errorConnections++;
    } else if (conn._count.listingLinks > 0) {
      warningConnections++;
    } else {
      healthyConnections++;
    }
  }

  return {
    totalConnections: connections.length,
    healthyConnections,
    warningConnections,
    errorConnections,
    totalLinkedItems,
    itemsWithErrors,
    errorLogs24h,
    byProvider,
  };
}

/**
 * Retry all failed syncs for a connection.
 */
export async function retryFailedSyncs(
  connectionId: string
): Promise<{ retriedCount: number }> {
  // Get all error links for this connection
  const errorLinks = await prisma.channelListingLink.findMany({
    where: { connectionId, syncStatus: "error" },
    select: { id: true, storeItemId: true },
  });

  // Mark them as pending to trigger retry on next sync
  await prisma.channelListingLink.updateMany({
    where: { connectionId, syncStatus: "error" },
    data: { syncStatus: "pending", syncError: null },
  });

  return { retriedCount: errorLinks.length };
}
