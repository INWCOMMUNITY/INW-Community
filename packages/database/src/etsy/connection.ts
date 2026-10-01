import type { EtsyConnection, Prisma, PrismaClient } from "@prisma/client";

export type EtsyDb = PrismaClient | Prisma.TransactionClient;

export type EtsyInstallInput = {
  memberId: string;
  etsyUserId: string;
  shopId: string;
  shopName?: string | null;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
  grantedScopes: string;
  connectedAt?: Date;
};

export type EtsyPublicConnection = {
  id: string;
  memberId: string;
  etsyUserId: string;
  shopId: string;
  shopName: string | null;
  generation: number;
  grantedScopes: string;
  status: EtsyConnection["status"];
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
  etsyUserId: true,
  shopId: true,
  shopName: true,
  generation: true,
  grantedScopes: true,
  status: true,
  connectedAt: true,
  disconnectedAt: true,
  accessTokenExpiresAt: true,
  refreshTokenExpiresAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

function shopLockKey(shopId: string): string {
  return `etsy-shop:${shopId}`;
}

function userLockKey(etsyUserId: string): string {
  return `etsy-user:${etsyUserId}`;
}

/** Cleared auth/profile fields so a disconnected generation cannot be reused without OAuth. */
function etsyDisconnectWipeData(at: Date) {
  return {
    status: "DISCONNECTED" as const,
    disconnectedAt: at,
    accessTokenEncrypted: "",
    refreshTokenEncrypted: "",
    accessTokenExpiresAt: at,
    refreshTokenExpiresAt: at,
    grantedScopes: "",
    shopName: null,
    defaultTaxonomyId: null,
    defaultShippingProfileId: null,
    listingContentLastPolledAt: null,
    listingContentPollLeaseExpiresAt: null,
  };
}

export class EtsyShopOwnershipConflictError extends Error {
  constructor() {
    super("Etsy shop is already connected to another INW account.");
    this.name = "EtsyShopOwnershipConflictError";
  }
}

export async function createEtsyOAuthState(
  db: EtsyDb,
  input: {
    nonce: string;
    memberId: string;
    browserBindingHash: string;
    codeVerifierEncrypted: string;
    expiresAt: Date;
  }
) {
  return db.etsyOAuthState.create({
    data: {
      nonce: input.nonce,
      memberId: input.memberId,
      browserBindingHash: input.browserBindingHash,
      codeVerifierEncrypted: input.codeVerifierEncrypted,
      expiresAt: input.expiresAt,
    },
  });
}

/** Hash for an unconsumed, unexpired state. Null when the state cannot be used. */
export async function readEtsyOAuthBrowserBindingHash(
  db: EtsyDb,
  input: { nonce: string; memberId: string; now?: Date }
): Promise<string | null> {
  const row = await db.etsyOAuthState.findFirst({
    where: {
      nonce: input.nonce,
      memberId: input.memberId,
      consumedAt: null,
      expiresAt: { gt: input.now ?? new Date() },
    },
    select: { browserBindingHash: true },
  });
  return row?.browserBindingHash ?? null;
}

/**
 * Atomically consume a matching unexpired state and return the encrypted PKCE verifier.
 * A second call returns rejected.
 */
export async function consumeEtsyOAuthState(
  db: EtsyDb,
  input: { nonce: string; memberId: string; now?: Date }
): Promise<
  | { status: "ok"; codeVerifierEncrypted: string }
  | { status: "rejected" }
> {
  const now = input.now ?? new Date();
  const rows = await db.$queryRaw<Array<{ code_verifier_encrypted: string }>>`
    UPDATE "etsy_oauth_state"
    SET "consumed_at" = ${now}
    WHERE "nonce" = ${input.nonce}
      AND "member_id" = ${input.memberId}
      AND "consumed_at" IS NULL
      AND "expires_at" > ${now}
    RETURNING "code_verifier_encrypted"
  `;
  const row = rows[0];
  if (!row?.code_verifier_encrypted) return { status: "rejected" };
  return { status: "ok", codeVerifierEncrypted: row.code_verifier_encrypted };
}

/**
 * Insert the next generation for member+shop and retire any current ACTIVE row.
 * Serialized with transaction advisory locks so concurrent callbacks cannot
 * both remain ACTIVE or reuse a generation number.
 */
export async function persistEtsyInstall(
  db: PrismaClient,
  input: EtsyInstallInput
): Promise<EtsyPublicConnection> {
  const connectedAt = input.connectedAt ?? new Date();
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${shopLockKey(input.shopId)}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userLockKey(input.etsyUserId)}))`;
    const otherOwner = await tx.etsyConnection.findFirst({
      where: {
        status: "ACTIVE",
        NOT: { memberId: input.memberId },
        OR: [{ shopId: input.shopId }, { etsyUserId: input.etsyUserId }],
      },
      select: { id: true },
    });
    if (otherOwner) throw new EtsyShopOwnershipConflictError();
    const latest = await tx.etsyConnection.findFirst({
      where: { memberId: input.memberId, shopId: input.shopId },
      orderBy: { generation: "desc" },
      select: { generation: true },
    });
    const generation = (latest?.generation ?? 0) + 1;
    await tx.etsyConnection.updateMany({
      where: {
        memberId: input.memberId,
        shopId: input.shopId,
        status: "ACTIVE",
      },
      data: etsyDisconnectWipeData(connectedAt),
    });
    return tx.etsyConnection.create({
      data: {
        memberId: input.memberId,
        etsyUserId: input.etsyUserId,
        shopId: input.shopId,
        shopName: input.shopName ?? null,
        generation,
        accessTokenEncrypted: input.accessTokenEncrypted,
        refreshTokenEncrypted: input.refreshTokenEncrypted,
        accessTokenExpiresAt: input.accessTokenExpiresAt,
        refreshTokenExpiresAt: input.refreshTokenExpiresAt,
        grantedScopes: input.grantedScopes,
        status: "ACTIVE",
        connectedAt,
      },
      select: publicSelect,
    });
  });
}

export async function listEtsyConnectionsForMember(
  db: EtsyDb,
  memberId: string
): Promise<EtsyPublicConnection[]> {
  return db.etsyConnection.findMany({
    where: { memberId },
    orderBy: [{ shopName: "asc" }, { generation: "desc" }],
    select: publicSelect,
  });
}

export async function getEtsyConnectionForMember(
  db: EtsyDb,
  memberId: string,
  connectionId: string
): Promise<EtsyPublicConnection | null> {
  return db.etsyConnection.findFirst({
    where: { id: connectionId, memberId },
    select: publicSelect,
  });
}

export async function getActiveEtsyConnectionForMember(
  db: EtsyDb,
  memberId: string,
  connectionId: string
) {
  return db.etsyConnection.findFirst({
    where: { id: connectionId, memberId, status: "ACTIVE" },
  });
}

export async function disconnectEtsyConnection(
  db: EtsyDb,
  input: { memberId: string; connectionId: string; at?: Date }
): Promise<EtsyPublicConnection | null> {
  const at = input.at ?? new Date();
  const updated = await db.etsyConnection.updateMany({
    where: { id: input.connectionId, memberId: input.memberId, status: "ACTIVE" },
    data: etsyDisconnectWipeData(at),
  });
  if (updated.count !== 1) return null;
  return getEtsyConnectionForMember(db, input.memberId, input.connectionId);
}

/**
 * Rotate encrypted token material only when the stored refresh ciphertext still matches.
 * A lost race returns null so the caller re-reads instead of overwriting a newer token.
 */
export async function rotateEtsyTokenMaterial(
  db: EtsyDb,
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
  const updated = await db.etsyConnection.updateMany({
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
