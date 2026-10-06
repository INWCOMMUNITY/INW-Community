import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  getActiveWixConnectionForMember,
  prisma,
  toPublicWixListingStatus,
} from "database";
import { isWixConfigured } from "@/lib/wix/config";

export const dynamic = "force-dynamic";

/**
 * GET /api/wix/diagnostic
 * Return diagnostic information about the Wix integration for the current user.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const verbose = url.searchParams.get("verbose") === "true";

  const diagnostic: Record<string, unknown> = {
    configured: isWixConfigured(),
    timestamp: new Date().toISOString(),
  };

  if (!isWixConfigured()) {
    return NextResponse.json(diagnostic);
  }

  // Get active connection
  const connection = await getActiveWixConnectionForMember(prisma, session.user.id);

  if (!connection) {
    diagnostic.connection = null;
    diagnostic.summary = "No active Wix connection";
    return NextResponse.json(diagnostic);
  }

  const storeItemId = url.searchParams.get("storeItemId");
  if (storeItemId) {
    const storeItem = await prisma.storeItem.findUnique({
      where: { id: storeItemId },
      select: { memberId: true, title: true },
    });
    if (!storeItem || storeItem.memberId !== session.user.id) {
      return NextResponse.json({ error: "Store item not found" }, { status: 404 });
    }

    const link = await prisma.wixListingLink.findFirst({
      where: { wixConnectionId: connection.id, storeItemId },
      include: {
        variantMaps: {
          select: {
            id: true,
            storeVariantId: true,
            wixVariantId: true,
            inventoryDesiredAvailable: true,
            inventoryAppliedAvailable: true,
            inventoryDesiredVersion: true,
            inventoryAppliedVersion: true,
          },
        },
      },
    });
    if (!link) {
      return NextResponse.json({
        configured: true,
        storeItemId,
        title: storeItem.title,
        linked: false,
      });
    }

    const recentJobs = await prisma.wixSyncJob.findMany({
      where: { wixConnectionId: connection.id },
      orderBy: { updatedAt: "desc" },
      take: 25,
      select: {
        id: true,
        kind: true,
        state: true,
        payload: true,
        lastErrorCode: true,
        updatedAt: true,
      },
    });
    const latestJob =
      recentJobs.find((job) => {
        const payload = job.payload as { listingLinkId?: string; storeItemId?: string } | null;
        return payload?.listingLinkId === link.id || payload?.storeItemId === storeItemId;
      }) ?? null;
    const publicStatus = toPublicWixListingStatus(link);

    return NextResponse.json({
      configured: true,
      storeItemId,
      title: storeItem.title,
      linked: true,
      link: {
        id: link.id,
        wixProductId: link.wixProductId,
        readiness: publicStatus.readiness,
        canSync: publicStatus.canSync,
        issueMessage: publicStatus.issueMessage,
        contentHealth: link.contentHealth,
        inventoryHealth: link.inventoryHealth,
        remoteProductVisible: link.remoteProductVisible,
        desiredProductContentVersion: link.desiredProductContentVersion,
        appliedProductContentVersion: link.appliedProductContentVersion,
      },
      variantMaps: link.variantMaps,
      latestJob: latestJob
        ? {
            id: latestJob.id,
            kind: latestJob.kind,
            state: latestJob.state,
            lastErrorCode: latestJob.lastErrorCode,
            updatedAt: latestJob.updatedAt,
          }
        : null,
    });
  }

  diagnostic.connection = {
    id: connection.id.slice(0, 8),
    siteId: connection.siteId,
    shopName: connection.shopName,
    catalogVersion: connection.catalogVersion,
    status: connection.status,
    generation: connection.generation,
    connectedAt: connection.connectedAt,
  };

  // Get listing stats
  const listingStats = await prisma.wixListingLink.groupBy({
    by: ["readiness"],
    where: { wixConnectionId: connection.id },
    _count: true,
  });

  diagnostic.listings = {
    total: listingStats.reduce((sum, s) => sum + s._count, 0),
    byReadiness: Object.fromEntries(listingStats.map((s) => [s.readiness, s._count])),
  };

  // Get recent sync job stats
  const jobStats = await prisma.wixSyncJob.groupBy({
    by: ["state"],
    where: {
      wixConnectionId: connection.id,
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
    _count: true,
  });

  diagnostic.jobs24h = Object.fromEntries(jobStats.map((s) => [s.state, s._count]));

  // Get pending jobs
  const pendingJobs = await prisma.wixSyncJob.count({
    where: {
      wixConnectionId: connection.id,
      state: { in: ["PENDING", "RETRY_WAIT"] },
    },
  });

  diagnostic.pendingJobs = pendingJobs;

  // Get recent evidence stats
  const evidenceStats = await prisma.wixProviderEvidence.groupBy({
    by: ["processState"],
    where: {
      wixConnectionId: connection.id,
      receivedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
    _count: true,
  });

  diagnostic.webhooks24h = Object.fromEntries(evidenceStats.map((s) => [s.processState, s._count]));

  // Get issues
  const issues = await prisma.wixListingLink.findMany({
    where: {
      wixConnectionId: connection.id,
      issueCode: { not: null },
    },
    select: {
      id: true,
      storeItemId: true,
      wixProductId: true,
      issueCode: true,
      issueMessage: true,
      issueSeverity: true,
      issueFirstSeenAt: true,
    },
    take: verbose ? 50 : 10,
    orderBy: { issueFirstSeenAt: "desc" },
  });

  diagnostic.issues = {
    count: issues.length,
    recent: issues.map((issue) => ({
      listingId: issue.id.slice(0, 8),
      code: issue.issueCode,
      severity: issue.issueSeverity,
      message: issue.issueMessage,
      since: issue.issueFirstSeenAt,
    })),
  };

  // Get listings needing attention
  const actionRequired = await prisma.wixListingLink.findMany({
    where: {
      wixConnectionId: connection.id,
      readiness: "ACTION_REQUIRED",
    },
    select: {
      id: true,
      storeItem: { select: { title: true } },
      issueCode: true,
      issueMessage: true,
    },
    take: 10,
  });

  diagnostic.actionRequired = actionRequired.map((l) => ({
    listingId: l.id.slice(0, 8),
    title: l.storeItem?.title?.slice(0, 50),
    issue: l.issueMessage,
  }));

  return NextResponse.json(diagnostic);
}
