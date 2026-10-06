import type { Prisma, PrismaClient, WixCatalogVersion, WixConnectionStatus } from "@prisma/client";

export type WixDb = PrismaClient | Prisma.TransactionClient;

export type WixPublicConnection = {
  id: string;
  instanceId: string;
  siteId: string;
  shopName: string | null;
  catalogVersion: WixCatalogVersion;
  generation: number;
  status: WixConnectionStatus;
  defaultLocationId: string | null;
  connectedAt: Date;
  disconnectedAt: Date | null;
};

export type WixInstallInput = {
  memberId: string;
  instanceId: string;
  siteId: string;
  shopName: string | null;
  catalogVersion: WixCatalogVersion;
  defaultLocationId?: string | null;
  connectedAt?: Date;
};

export class WixSiteOwnershipConflictError extends Error {
  readonly code = "WIX_SITE_OWNERSHIP_CONFLICT" as const;
  constructor(message = "Wix site is already connected to another INW account") {
    super(message);
    this.name = "WixSiteOwnershipConflictError";
  }
}

/**
 * Persist a Wix app installation.
 * Reconnect for the same member and site updates that row in place.
 * Fails if another member owns the same siteId.
 */
export async function persistWixInstall(
  db: WixDb,
  input: WixInstallInput
): Promise<WixPublicConnection> {
  const now = input.connectedAt ?? new Date();

  // Check if another member already owns this site
  const existingOther = await db.wixConnection.findFirst({
    where: {
      siteId: input.siteId,
      memberId: { not: input.memberId },
      status: "ACTIVE",
    },
    select: { id: true, memberId: true },
  });
  if (existingOther) {
    throw new WixSiteOwnershipConflictError();
  }

  // Same member + site keeps the same connection row so listing links stay valid.
  const existing = await db.wixConnection.findFirst({
    where: {
      memberId: input.memberId,
      siteId: input.siteId,
    },
    orderBy: { generation: "desc" },
  });

  if (existing) {
    await db.wixConnection.updateMany({
      where: {
        memberId: input.memberId,
        siteId: input.siteId,
        id: { not: existing.id },
        status: "ACTIVE",
      },
      data: {
        status: "DISCONNECTED",
        disconnectedAt: now,
      },
    });

    const connection = await db.wixConnection.update({
      where: { id: existing.id },
      data: {
        instanceId: input.instanceId,
        shopName: input.shopName,
        catalogVersion: input.catalogVersion,
        status: "ACTIVE",
        disconnectedAt: null,
        defaultLocationId: input.defaultLocationId ?? existing.defaultLocationId,
        connectedAt: existing.status === "ACTIVE" ? existing.connectedAt : now,
      },
    });

    return toPublicWixConnection(connection);
  }

  const connection = await db.wixConnection.create({
    data: {
      memberId: input.memberId,
      instanceId: input.instanceId,
      siteId: input.siteId,
      shopName: input.shopName,
      catalogVersion: input.catalogVersion,
      generation: 1,
      status: "ACTIVE",
      defaultLocationId: input.defaultLocationId ?? null,
      connectedAt: now,
    },
  });

  return toPublicWixConnection(connection);
}

function toPublicWixConnection(connection: {
  id: string;
  instanceId: string;
  siteId: string;
  shopName: string | null;
  catalogVersion: WixCatalogVersion;
  generation: number;
  status: WixConnectionStatus;
  defaultLocationId: string | null;
  connectedAt: Date;
  disconnectedAt: Date | null;
}): WixPublicConnection {
  return {
    id: connection.id,
    instanceId: connection.instanceId,
    siteId: connection.siteId,
    shopName: connection.shopName,
    catalogVersion: connection.catalogVersion,
    generation: connection.generation,
    status: connection.status,
    defaultLocationId: connection.defaultLocationId,
    connectedAt: connection.connectedAt,
    disconnectedAt: connection.disconnectedAt,
  };
}

/**
 * Disconnect a Wix connection by setting status to DISCONNECTED.
 * Does not delete remote products; that is a separate action.
 */
export async function disconnectWixConnection(
  db: WixDb,
  input: { connectionId: string; memberId: string; now?: Date }
): Promise<{ disconnected: boolean }> {
  const now = input.now ?? new Date();
  const updated = await db.wixConnection.updateMany({
    where: {
      id: input.connectionId,
      memberId: input.memberId,
      status: "ACTIVE",
    },
    data: {
      status: "DISCONNECTED",
      disconnectedAt: now,
    },
  });
  return { disconnected: updated.count === 1 };
}

/**
 * Get the currently active Wix connection for a member.
 */
export async function getActiveWixConnectionForMember(
  db: WixDb,
  memberId: string
): Promise<WixPublicConnection | null> {
  const connection = await db.wixConnection.findFirst({
    where: { memberId, status: "ACTIVE" },
    orderBy: { connectedAt: "desc" },
  });
  if (!connection) return null;
  return {
    id: connection.id,
    instanceId: connection.instanceId,
    siteId: connection.siteId,
    shopName: connection.shopName,
    catalogVersion: connection.catalogVersion,
    generation: connection.generation,
    status: connection.status,
    defaultLocationId: connection.defaultLocationId,
    connectedAt: connection.connectedAt,
    disconnectedAt: connection.disconnectedAt,
  };
}

/**
 * Get a specific Wix connection by ID for a member.
 */
export async function getWixConnectionForMember(
  db: WixDb,
  connectionId: string,
  memberId: string
): Promise<WixPublicConnection | null> {
  const connection = await db.wixConnection.findFirst({
    where: { id: connectionId, memberId },
  });
  if (!connection) return null;
  return {
    id: connection.id,
    instanceId: connection.instanceId,
    siteId: connection.siteId,
    shopName: connection.shopName,
    catalogVersion: connection.catalogVersion,
    generation: connection.generation,
    status: connection.status,
    defaultLocationId: connection.defaultLocationId,
    connectedAt: connection.connectedAt,
    disconnectedAt: connection.disconnectedAt,
  };
}

/**
 * List all Wix connections for a member (active and disconnected).
 */
export async function listWixConnectionsForMember(
  db: WixDb,
  memberId: string
): Promise<WixPublicConnection[]> {
  const connections = await db.wixConnection.findMany({
    where: { memberId },
    orderBy: { connectedAt: "desc" },
  });
  return connections.map((c) => ({
    id: c.id,
    instanceId: c.instanceId,
    siteId: c.siteId,
    shopName: c.shopName,
    catalogVersion: c.catalogVersion,
    generation: c.generation,
    status: c.status,
    defaultLocationId: c.defaultLocationId,
    connectedAt: c.connectedAt,
    disconnectedAt: c.disconnectedAt,
  }));
}

/**
 * Update the catalog version for a connection (on reconnect/version detection).
 */
export async function updateWixCatalogVersion(
  db: WixDb,
  input: { connectionId: string; memberId: string; catalogVersion: WixCatalogVersion }
): Promise<{ updated: boolean }> {
  const updated = await db.wixConnection.updateMany({
    where: {
      id: input.connectionId,
      memberId: input.memberId,
      status: "ACTIVE",
    },
    data: { catalogVersion: input.catalogVersion },
  });
  return { updated: updated.count === 1 };
}

/**
 * Set the default location ID for inventory operations.
 */
export async function setWixDefaultLocation(
  db: WixDb,
  input: { connectionId: string; memberId: string; locationId: string | null }
): Promise<{ updated: boolean }> {
  const updated = await db.wixConnection.updateMany({
    where: {
      id: input.connectionId,
      memberId: input.memberId,
      status: "ACTIVE",
    },
    data: { defaultLocationId: input.locationId },
  });
  return { updated: updated.count === 1 };
}

// OAuth state management

export async function createWixOAuthState(
  db: WixDb,
  input: {
    nonce: string;
    memberId: string;
    browserBindingHash: string;
    expiresAt: Date;
  }
): Promise<void> {
  await db.wixOAuthState.create({
    data: {
      nonce: input.nonce,
      memberId: input.memberId,
      browserBindingHash: input.browserBindingHash,
      expiresAt: input.expiresAt,
    },
  });
}

export async function readWixOAuthBrowserBindingHash(
  db: WixDb,
  input: { nonce: string; memberId: string; now?: Date }
): Promise<string | null> {
  const now = input.now ?? new Date();
  const state = await db.wixOAuthState.findFirst({
    where: {
      nonce: input.nonce,
      memberId: input.memberId,
      expiresAt: { gt: now },
      consumedAt: null,
    },
    select: { browserBindingHash: true },
  });
  return state?.browserBindingHash ?? null;
}

export async function consumeWixOAuthState(
  db: WixDb,
  input: { nonce: string; memberId: string; now?: Date }
): Promise<{ status: "ok" } | { status: "expired" } | { status: "consumed" } | { status: "not_found" }> {
  const now = input.now ?? new Date();
  const state = await db.wixOAuthState.findFirst({
    where: { nonce: input.nonce, memberId: input.memberId },
  });
  if (!state) return { status: "not_found" };
  if (state.consumedAt) return { status: "consumed" };
  if (state.expiresAt <= now) return { status: "expired" };

  await db.wixOAuthState.update({
    where: { id: state.id },
    data: { consumedAt: now },
  });
  return { status: "ok" };
}
