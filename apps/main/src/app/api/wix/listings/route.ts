import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";

export const dynamic = "force-dynamic";

function storeItemIdFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const id = (payload as { storeItemId?: unknown }).storeItemId;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

/**
 * GET /api/wix/listings
 * Mapped Wix listing links plus unmapped CREATE_LISTING jobs that still need attention.
 */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const memberId = session?.user?.id;
  if (!memberId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await memberHasStorefrontListingAccess(memberId))) {
    return NextResponse.json({ error: "Seller access required" }, { status: 403 });
  }

  const connection = await prisma.wixConnection.findFirst({
    where: { memberId, status: "ACTIVE" },
    orderBy: { connectedAt: "desc" },
    select: {
      id: true,
      siteId: true,
      shopName: true,
      catalogVersion: true,
    },
  });
  if (!connection) {
    return NextResponse.json({ connection: null, listings: [] });
  }

  const links = await prisma.wixListingLink.findMany({
    where: { wixConnectionId: connection.id, memberId },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: {
      id: true,
      storeItemId: true,
      wixProductId: true,
      readiness: true,
      contentHealth: true,
      inventoryHealth: true,
      issueCode: true,
      issueMessage: true,
      importSource: true,
      remoteProductVisible: true,
      updatedAt: true,
      storeItem: { select: { title: true, status: true, priceCents: true, quantity: true } },
    },
  });

  const mappedStoreItemIds = new Set(links.map((row) => row.storeItemId));

  const createJobs = await prisma.wixSyncJob.findMany({
    where: {
      wixConnectionId: connection.id,
      kind: "CREATE_LISTING",
      state: { in: ["DEAD", "RUNNING", "RETRY_WAIT", "PENDING"] },
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: {
      id: true,
      state: true,
      payload: true,
      lastErrorCode: true,
      lastErrorMessage: true,
      updatedAt: true,
    },
  });

  const pendingStoreItemIds = [
    ...new Set(
      createJobs
        .map((job) => storeItemIdFromPayload(job.payload))
        .filter((id): id is string => typeof id === "string" && !mappedStoreItemIds.has(id))
    ),
  ];
  const pendingItems =
    pendingStoreItemIds.length > 0
      ? await prisma.storeItem.findMany({
          where: { id: { in: pendingStoreItemIds }, memberId },
          select: { id: true, title: true, status: true, priceCents: true, quantity: true },
        })
      : [];
  const pendingById = new Map(pendingItems.map((item) => [item.id, item]));

  const mappedListings = links.map((row) => ({
    id: row.id,
    storeItemId: row.storeItemId,
    wixProductId: row.wixProductId,
    title: row.storeItem.title,
    storeItemStatus: row.storeItem.status,
    priceCents: row.storeItem.priceCents,
    quantity: row.storeItem.quantity,
    readiness: row.readiness,
    contentHealth: row.contentHealth,
    inventoryHealth: row.inventoryHealth,
    issueCode: row.issueCode,
    issueMessage: row.issueMessage,
    importSource: row.importSource,
    remoteProductVisible: row.remoteProductVisible,
    updatedAt: row.updatedAt,
    attentionKind: "mapped" as const,
  }));

  const pendingListings = createJobs.flatMap((job) => {
    const storeItemId = storeItemIdFromPayload(job.payload);
    if (!storeItemId || mappedStoreItemIds.has(storeItemId)) return [];
    const item = pendingById.get(storeItemId);
    if (!item) return [];
    const isDead = job.state === "DEAD";
    return [
      {
        id: `create-job:${job.id}`,
        storeItemId,
        wixProductId: "",
        title: item.title,
        storeItemStatus: item.status,
        priceCents: item.priceCents,
        quantity: item.quantity,
        readiness: isDead ? "ACTION_REQUIRED" : "SYNCING",
        contentHealth: isDead ? "DEGRADED" : "HEALTHY",
        inventoryHealth: "HEALTHY",
        issueCode: isDead
          ? job.lastErrorCode ?? "CREATE_LISTING_FAILED"
          : "CREATE_LISTING_PENDING",
        issueMessage: isDead
          ? job.lastErrorMessage ?? "Could not create listing on Wix"
          : "List on Wix is still syncing",
        importSource: "NATIVE" as const,
        remoteProductVisible: null as boolean | null,
        updatedAt: job.updatedAt,
        attentionKind: "unmapped_create" as const,
      },
    ];
  });

  const listings = [...pendingListings, ...mappedListings].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  return NextResponse.json({
    connection: {
      id: connection.id,
      siteId: connection.siteId,
      shopName: connection.shopName,
      catalogVersion: connection.catalogVersion,
      mappedListingCount: links.length,
      attentionListingCount: listings.filter(
        (row) => row.readiness === "ACTION_REQUIRED" || row.readiness === "CONNECTION_REQUIRED"
      ).length,
    },
    listings,
  });
}
