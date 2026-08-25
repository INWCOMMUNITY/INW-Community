import { prisma, Prisma } from "database";
import type { ChannelProvider } from "./types";

export type ClaimChannelListingLinkInput = {
  storeItemId: string;
  memberId: string;
  connectionId: string;
  provider: ChannelProvider;
  externalListingId: string;
  externalShopId?: string | null;
  linkOrigin?: string | null;
  syncEnabled?: boolean;
  syncStatus?: string;
  syncError?: string | null;
  lastPushedHash?: string | null;
  lastPushedAt?: Date | null;
  lastPushedPhotos?: string[] | null;
  lastInboundAt?: Date | null;
  syncBaselineHash?: string | null;
  syncBaselineMetaHash?: string | null;
  syncBaselineVariantsHash?: string | null;
  syncBaselineQty?: number | null;
  syncBaselineAt?: Date | null;
};

export type ClaimChannelListingLinkResult = {
  id: string;
  storeItemId: string;
  created: boolean;
  stolenFromStoreItemId: string | null;
};

function prismaErrorCode(e: unknown): string | undefined {
  if (e && typeof e === "object" && "code" in e && typeof (e as { code: unknown }).code === "string") {
    return (e as { code: string }).code;
  }
  return undefined;
}

function uniqueTargetFields(e: unknown): string[] {
  if (!e || typeof e !== "object" || !("meta" in e)) return [];
  const target = (e as { meta?: { target?: unknown } }).meta?.target;
  if (Array.isArray(target)) return target.map(String);
  if (typeof target === "string") return [target];
  return [];
}

function normalizedUniqueFields(e: unknown): string[] {
  return uniqueTargetFields(e).map((f) => f.replace(/_/g, "").toLowerCase());
}

export function isProviderExternalListingUnique(e: unknown): boolean {
  const fields = normalizedUniqueFields(e);
  if (fields.length === 0) return false;
  return fields.includes("provider") && fields.some((f) => f.includes("externallistingid"));
}

export function isStoreItemProviderUnique(e: unknown): boolean {
  const fields = normalizedUniqueFields(e);
  if (fields.length === 0) return false;
  return (
    fields.includes("provider") &&
    fields.some((f) => f.includes("storeitemid")) &&
    !fields.some((f) => f.includes("externallisting"))
  );
}

function linkCreateData(input: ClaimChannelListingLinkInput): Prisma.ChannelListingLinkUncheckedCreateInput {
  const data: Prisma.ChannelListingLinkUncheckedCreateInput = {
    storeItemId: input.storeItemId,
    connectionId: input.connectionId,
    provider: input.provider,
    externalListingId: input.externalListingId,
    externalShopId: input.externalShopId ?? null,
    syncEnabled: input.syncEnabled ?? true,
    syncStatus: input.syncStatus ?? "synced",
    syncError: input.syncError ?? null,
  };
  if (input.linkOrigin != null) data.linkOrigin = input.linkOrigin;
  if (input.lastPushedHash !== undefined) data.lastPushedHash = input.lastPushedHash;
  if (input.lastPushedAt !== undefined) data.lastPushedAt = input.lastPushedAt;
  if (input.lastPushedPhotos !== undefined) {
    data.lastPushedPhotos =
      input.lastPushedPhotos === null
        ? Prisma.JsonNull
        : (input.lastPushedPhotos as Prisma.InputJsonValue);
  }
  if (input.lastInboundAt !== undefined) data.lastInboundAt = input.lastInboundAt;
  if (input.syncBaselineHash !== undefined) data.syncBaselineHash = input.syncBaselineHash;
  if (input.syncBaselineMetaHash !== undefined) data.syncBaselineMetaHash = input.syncBaselineMetaHash;
  if (input.syncBaselineVariantsHash !== undefined) {
    data.syncBaselineVariantsHash = input.syncBaselineVariantsHash;
  }
  if (input.syncBaselineQty !== undefined) data.syncBaselineQty = input.syncBaselineQty;
  if (input.syncBaselineAt !== undefined) data.syncBaselineAt = input.syncBaselineAt;
  return data;
}

function linkUpdateData(input: ClaimChannelListingLinkInput): Prisma.ChannelListingLinkUncheckedUpdateInput {
  return linkCreateData(input) as Prisma.ChannelListingLinkUncheckedUpdateInput;
}

async function maybeDeleteOrphanStoreItem(storeItemId: string): Promise<void> {
  const row = await prisma.storeItem.findUnique({
    where: { id: storeItemId },
    select: {
      _count: { select: { channelLinks: true, orderItems: true } },
    },
  });
  if (!row) return;
  if (row._count.channelLinks > 0 || row._count.orderItems > 0) return;
  await prisma.storeItem.delete({ where: { id: storeItemId } }).catch((e) => {
    console.warn("[channels] could not delete auto-imported orphan StoreItem", {
      storeItemId,
      error: String(e),
    });
  });
}

async function recoverExistingLink(
  input: ClaimChannelListingLinkInput,
  e: unknown
): Promise<ClaimChannelListingLinkResult | null> {
  if (prismaErrorCode(e) !== "P2002") return null;

  const existing = await prisma.channelListingLink.findUnique({
    where: {
      provider_externalListingId: {
        provider: input.provider,
        externalListingId: input.externalListingId,
      },
    },
    include: { storeItem: { select: { memberId: true } } },
  });
  if (existing) {
    if (!existing.storeItem) {
      await prisma.channelListingLink.delete({ where: { id: existing.id } }).catch(() => {});
      return null;
    }
    if (existing.storeItemId === input.storeItemId) {
      const updated = await prisma.channelListingLink.update({
        where: { id: existing.id },
        data: linkUpdateData(input),
      });
      return {
        id: updated.id,
        storeItemId: input.storeItemId,
        created: false,
        stolenFromStoreItemId: null,
      };
    }
    if (existing.storeItem.memberId !== input.memberId) {
      throw new Error(`This ${input.provider} listing is already linked to another INW account.`);
    }
    const orphanId = existing.storeItemId;
    const updated = await prisma.channelListingLink.update({
      where: { id: existing.id },
      data: linkUpdateData(input),
    });
    await maybeDeleteOrphanStoreItem(orphanId);
    console.info("[channels] claimed existing channel listing link", {
      provider: input.provider,
      externalListingId: input.externalListingId,
      storeItemId: input.storeItemId,
      stolenFromStoreItemId: orphanId,
    });
    return {
      id: updated.id,
      storeItemId: input.storeItemId,
      created: false,
      stolenFromStoreItemId: orphanId,
    };
  }

  const byItem = await prisma.channelListingLink.findUnique({
    where: { storeItemId_provider: { storeItemId: input.storeItemId, provider: input.provider } },
  });
  if (byItem) {
    const updated = await prisma.channelListingLink.update({
      where: { id: byItem.id },
      data: {
        ...linkUpdateData(input),
        // First writer keeps the remote id so a retry POST cannot steal the row.
        externalListingId: byItem.externalListingId,
      },
    });
    return {
      id: updated.id,
      storeItemId: input.storeItemId,
      created: false,
      stolenFromStoreItemId: null,
    };
  }

  return null;
}

/**
 * Create a ChannelListingLink, or recover from a unique collision:
 * - same store item → treat as success (idempotent retry)
 * - same member, different store item, same remote id → move the link (auto-import race)
 */
export async function claimChannelListingLink(
  input: ClaimChannelListingLinkInput
): Promise<ClaimChannelListingLinkResult> {
  try {
    const created = await prisma.channelListingLink.create({
      data: linkCreateData(input),
    });
    return {
      id: created.id,
      storeItemId: created.storeItemId,
      created: true,
      stolenFromStoreItemId: null,
    };
  } catch (e) {
    const recovered = await recoverExistingLink(input, e);
    if (recovered) return recovered;
    if (prismaErrorCode(e) === "P2002") {
      try {
        const created = await prisma.channelListingLink.create({
          data: linkCreateData(input),
        });
        return {
          id: created.id,
          storeItemId: created.storeItemId,
          created: true,
          stolenFromStoreItemId: null,
        };
      } catch (retryErr) {
        const recoveredRetry = await recoverExistingLink(input, retryErr);
        if (recoveredRetry) return recoveredRetry;
        throw retryErr;
      }
    }
    throw e;
  }
}
