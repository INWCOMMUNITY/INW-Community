import type { Prisma, PrismaClient, ShopifyConnection } from "@prisma/client";

export type ShopifyDb = PrismaClient | Prisma.TransactionClient;

export type ShopifyInstallInput = {
  memberId: string;
  shopDomain: string;
  shopId: string;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
  grantedScopes: string;
  primaryLocationId: string | null;
  connectedAt?: Date;
};

export type ShopifyPublicConnection = {
  id: string;
  memberId: string;
  shopDomain: string;
  shopId: string;
  generation: number;
  grantedScopes: string;
  status: ShopifyConnection["status"];
  primaryLocationId: string | null;
  connectedAt: Date;
  disconnectedAt: Date | null;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

const publicSelect = {
  id: true,
  memberId: true,
  shopDomain: true,
  shopId: true,
  generation: true,
  grantedScopes: true,
  status: true,
  primaryLocationId: true,
  connectedAt: true,
  disconnectedAt: true,
  accessTokenExpiresAt: true,
  refreshTokenExpiresAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

function domainLockKey(shopDomain: string): string {
  return `shopify-domain:${shopDomain}`;
}

function shopLockKey(shopId: string): string {
  return `shopify-shop:${shopId}`;
}

export class ShopifyShopOwnershipConflictError extends Error {
  constructor() {
    super("Shopify store is already connected to another INW account.");
    this.name = "ShopifyShopOwnershipConflictError";
  }
}

export async function createShopifyOAuthState(
  db: ShopifyDb,
  input: {
    nonce: string;
    memberId: string;
    shopDomain: string;
    browserBindingHash: string;
    expiresAt: Date;
  }
) {
  return db.shopifyOAuthState.create({
    data: {
      nonce: input.nonce,
      memberId: input.memberId,
      shopDomain: input.shopDomain,
      browserBindingHash: input.browserBindingHash,
      expiresAt: input.expiresAt,
    },
  });
}

/** Hash for an unconsumed, unexpired state. Null when the state cannot be used. */
export async function readShopifyOAuthBrowserBindingHash(
  db: ShopifyDb,
  input: { nonce: string; memberId: string; shopDomain: string; now?: Date }
): Promise<string | null> {
  const row = await db.shopifyOAuthState.findFirst({
    where: {
      nonce: input.nonce,
      memberId: input.memberId,
      shopDomain: input.shopDomain,
      consumedAt: null,
      expiresAt: { gt: input.now ?? new Date() },
    },
    select: { browserBindingHash: true },
  });
  return row?.browserBindingHash ?? null;
}

/**
 * Atomically consume a matching unexpired state. A second call returns "rejected".
 */
export async function consumeShopifyOAuthState(
  db: ShopifyDb,
  input: { nonce: string; memberId: string; shopDomain: string; now?: Date }
): Promise<"ok" | "rejected"> {
  const now = input.now ?? new Date();
  const updated = await db.shopifyOAuthState.updateMany({
    where: {
      nonce: input.nonce,
      memberId: input.memberId,
      shopDomain: input.shopDomain,
      consumedAt: null,
      expiresAt: { gt: now },
    },
    data: { consumedAt: now },
  });
  return updated.count === 1 ? "ok" : "rejected";
}

/**
 * Insert the next generation for member+shop and retire any current ACTIVE row.
 * Serialized with a transaction advisory lock so concurrent callbacks cannot
 * both remain ACTIVE or reuse a generation number.
 */
export async function persistShopifyInstall(
  db: PrismaClient,
  input: ShopifyInstallInput
): Promise<ShopifyPublicConnection> {
  const connectedAt = input.connectedAt ?? new Date();
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${domainLockKey(input.shopDomain)}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${shopLockKey(input.shopId)}))`;
    const otherOwner = await tx.shopifyConnection.findFirst({
      where: {
        status: "ACTIVE",
        NOT: { memberId: input.memberId },
        OR: [{ shopDomain: input.shopDomain }, { shopId: input.shopId }],
      },
      select: { id: true },
    });
    if (otherOwner) throw new ShopifyShopOwnershipConflictError();
    const latest = await tx.shopifyConnection.findFirst({
      where: { memberId: input.memberId, shopDomain: input.shopDomain },
      orderBy: { generation: "desc" },
      select: { generation: true },
    });
    const generation = (latest?.generation ?? 0) + 1;
    await tx.shopifyConnection.updateMany({
      where: {
        memberId: input.memberId,
        shopDomain: input.shopDomain,
        status: "ACTIVE",
      },
      data: { status: "DISCONNECTED", disconnectedAt: connectedAt },
    });
    return tx.shopifyConnection.create({
      data: {
        memberId: input.memberId,
        shopDomain: input.shopDomain,
        shopId: input.shopId,
        generation,
        accessTokenEncrypted: input.accessTokenEncrypted,
        refreshTokenEncrypted: input.refreshTokenEncrypted,
        accessTokenExpiresAt: input.accessTokenExpiresAt,
        refreshTokenExpiresAt: input.refreshTokenExpiresAt,
        grantedScopes: input.grantedScopes,
        status: "ACTIVE",
        primaryLocationId: input.primaryLocationId,
        connectedAt,
      },
      select: publicSelect,
    });
  });
}

export async function listShopifyConnectionsForMember(
  db: ShopifyDb,
  memberId: string
): Promise<ShopifyPublicConnection[]> {
  return db.shopifyConnection.findMany({
    where: { memberId },
    orderBy: [{ shopDomain: "asc" }, { generation: "desc" }],
    select: publicSelect,
  });
}

export async function getShopifyConnectionForMember(
  db: ShopifyDb,
  memberId: string,
  connectionId: string
): Promise<ShopifyPublicConnection | null> {
  return db.shopifyConnection.findFirst({
    where: { id: connectionId, memberId },
    select: publicSelect,
  });
}

export async function getActiveShopifyConnectionForMember(
  db: ShopifyDb,
  memberId: string,
  connectionId: string
) {
  return db.shopifyConnection.findFirst({
    where: { id: connectionId, memberId, status: "ACTIVE" },
  });
}

export async function disconnectShopifyConnection(
  db: ShopifyDb,
  input: { memberId: string; connectionId: string; at?: Date }
): Promise<ShopifyPublicConnection | null> {
  const at = input.at ?? new Date();
  const updated = await db.shopifyConnection.updateMany({
    where: { id: input.connectionId, memberId: input.memberId, status: "ACTIVE" },
    data: { status: "DISCONNECTED", disconnectedAt: at },
  });
  if (updated.count !== 1) return null;
  return getShopifyConnectionForMember(db, input.memberId, input.connectionId);
}

/**
 * Revoke ACTIVE generations for this shop that were connected at or before the webhook trigger.
 * A newer reconnect (connectedAt after triggeredAt) is left unchanged.
 */
export async function revokeActiveShopifyConnectionsForShop(
  db: ShopifyDb,
  shopDomain: string,
  triggeredAt: Date
): Promise<number> {
  const updated = await db.shopifyConnection.updateMany({
    where: { shopDomain, status: "ACTIVE", connectedAt: { lte: triggeredAt } },
    data: { status: "REVOKED", disconnectedAt: triggeredAt },
  });
  return updated.count;
}

export async function setShopifyPrimaryLocation(
  db: ShopifyDb,
  input: { memberId: string; connectionId: string; locationId: string }
): Promise<ShopifyPublicConnection | null> {
  const updated = await db.shopifyConnection.updateMany({
    where: { id: input.connectionId, memberId: input.memberId, status: "ACTIVE" },
    data: { primaryLocationId: input.locationId },
  });
  if (updated.count !== 1) return null;
  return getShopifyConnectionForMember(db, input.memberId, input.connectionId);
}

/**
 * Rotate encrypted token material only when the stored refresh ciphertext still matches.
 * A lost race returns null so the caller re-reads instead of overwriting a newer token.
 */
export async function rotateShopifyTokenMaterial(
  db: ShopifyDb,
  input: {
    memberId: string;
    connectionId: string;
    expectedRefreshTokenEncrypted: string;
    accessTokenEncrypted: string;
    refreshTokenEncrypted: string;
    accessTokenExpiresAt: Date;
    refreshTokenExpiresAt: Date;
    grantedScopes?: string;
  }
): Promise<boolean> {
  const updated = await db.shopifyConnection.updateMany({
    where: {
      id: input.connectionId,
      memberId: input.memberId,
      status: "ACTIVE",
      refreshTokenEncrypted: input.expectedRefreshTokenEncrypted,
    },
    data: {
      accessTokenEncrypted: input.accessTokenEncrypted,
      refreshTokenEncrypted: input.refreshTokenEncrypted,
      accessTokenExpiresAt: input.accessTokenExpiresAt,
      refreshTokenExpiresAt: input.refreshTokenExpiresAt,
      ...(input.grantedScopes ? { grantedScopes: input.grantedScopes } : {}),
    },
  });
  return updated.count === 1;
}
