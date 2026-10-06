import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getActiveWixConnectionForMember, prisma } from "database";
import { isWixConfigured } from "@/lib/wix/config";

export const dynamic = "force-dynamic";

export type WixIntegrationStatus = {
  configured: boolean;
  connected: boolean;
  connection: {
    id: string;
    siteId: string;
    shopName: string | null;
    catalogVersion: string;
    status: string;
    createdAt: string;
  } | null;
  stats: {
    totalListings: number;
    synced: number;
    syncing: number;
    actionRequired: number;
    connectionRequired: number;
  };
  health: {
    overall: "healthy" | "degraded" | "disconnected" | "not_configured";
    pendingJobs: number;
    issueCount: number;
  };
};

/**
 * GET /api/wix/status
 * Return the Wix integration status summary for the current user.
 * Used by the Apps Airport UI to show integration health.
 */
export async function GET(): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status: WixIntegrationStatus = {
    configured: isWixConfigured(),
    connected: false,
    connection: null,
    stats: {
      totalListings: 0,
      synced: 0,
      syncing: 0,
      actionRequired: 0,
      connectionRequired: 0,
    },
    health: {
      overall: "not_configured",
      pendingJobs: 0,
      issueCount: 0,
    },
  };

  if (!isWixConfigured()) {
    return NextResponse.json(status);
  }

  // Get active connection
  const connection = await getActiveWixConnectionForMember(prisma, session.user.id);

  if (!connection) {
    status.health.overall = "disconnected";
    return NextResponse.json(status);
  }

  status.connected = true;
  status.connection = {
    id: connection.id,
    siteId: connection.siteId,
    shopName: connection.shopName,
    catalogVersion: connection.catalogVersion,
    status: connection.status,
    createdAt: connection.connectedAt.toISOString(),
  };

  // Get listing stats by readiness
  const listingStats = await prisma.wixListingLink.groupBy({
    by: ["readiness"],
    where: { wixConnectionId: connection.id },
    _count: true,
  });

  for (const stat of listingStats) {
    status.stats.totalListings += stat._count;
    switch (stat.readiness) {
      case "READY_TO_PUBLISH":
        status.stats.synced += stat._count;
        break;
      case "SYNCING":
        status.stats.syncing += stat._count;
        break;
      case "ACTION_REQUIRED":
        status.stats.actionRequired += stat._count;
        break;
      case "CONNECTION_REQUIRED":
        status.stats.connectionRequired += stat._count;
        break;
    }
  }

  // Get pending jobs count
  status.health.pendingJobs = await prisma.wixSyncJob.count({
    where: {
      wixConnectionId: connection.id,
      state: { in: ["PENDING", "RETRY_WAIT"] },
    },
  });

  // Get issue count
  status.health.issueCount = await prisma.wixListingLink.count({
    where: {
      wixConnectionId: connection.id,
      issueCode: { not: null },
    },
  });

  // Determine overall health
  if (status.stats.actionRequired > 0 || status.health.issueCount > 5) {
    status.health.overall = "degraded";
  } else if (status.stats.syncing > 0 || status.health.pendingJobs > 10) {
    status.health.overall = "degraded";
  } else {
    status.health.overall = "healthy";
  }

  return NextResponse.json(status);
}
