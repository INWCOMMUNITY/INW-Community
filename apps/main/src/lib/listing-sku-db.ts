import { prisma, Prisma } from "database";
import { normalizeListingSku } from "./listing-sku";
import { ensureSellableSkus, skuOwnerKey } from "./channels/sku-identity";
import { normalizeVariantMatrix } from "./listing-variant-matrix";

export async function findConflictingStoreItemSku(args: {
  memberId: string;
  sku: string;
  excludeItemId?: string;
}): Promise<{ id: string } | null> {
  return findConflictingMemberSku(args);
}

/** Parent StoreItem.sku and combo row SKUs, case-insensitive. */
export async function findConflictingMemberSku(args: {
  memberId: string;
  sku: string;
  excludeItemId?: string;
}): Promise<{ id: string } | null> {
  const sku = normalizeListingSku(args.sku);
  if (!sku) return null;
  const want = skuOwnerKey(sku);
  if (!want) return null;

  const parent = await prisma.storeItem.findFirst({
    where: {
      memberId: args.memberId,
      sku: { equals: sku, mode: "insensitive" },
      ...(args.excludeItemId ? { id: { not: args.excludeItemId } } : {}),
    },
    select: { id: true },
  });
  if (parent) return parent;

  const items = await prisma.storeItem.findMany({
    where: {
      memberId: args.memberId,
      ...(args.excludeItemId ? { id: { not: args.excludeItemId } } : {}),
    },
    select: { id: true, variants: true },
  });
  for (const item of items) {
    const matrix = normalizeVariantMatrix(item.variants);
    for (const row of matrix?.skus ?? []) {
      if (skuOwnerKey(row.sku) === want) return { id: item.id };
    }
  }
  return null;
}

export async function loadMemberSkuOwnerSet(
  memberId: string,
  excludeItemId?: string
): Promise<Set<string>> {
  const used = new Set<string>();
  const items = await prisma.storeItem.findMany({
    where: {
      memberId,
      ...(excludeItemId ? { id: { not: excludeItemId } } : {}),
    },
    select: { sku: true, variants: true },
  });
  for (const item of items) {
    const parent = skuOwnerKey(item.sku);
    if (parent) used.add(parent);
    const matrix = normalizeVariantMatrix(item.variants);
    for (const row of matrix?.skus ?? []) {
      const key = skuOwnerKey(row.sku);
      if (key) used.add(key);
    }
  }
  return used;
}

/** Mint or canonicalize join keys on INW, then persist so every channel copies the same string. */
export async function ensureMemberItemJoinKeys(args: {
  memberId: string;
  id: string;
  sku: string | null;
  variants: unknown;
}): Promise<{ sku: string | null; variants: unknown; changed: boolean }> {
  const used = await loadMemberSkuOwnerSet(args.memberId, args.id);
  const result = ensureSellableSkus(
    { id: args.id, sku: args.sku, variants: args.variants },
    used
  );
  if (!result.changed) return result;
  await prisma.storeItem.update({
    where: { id: args.id },
    data: {
      sku: result.sku,
      variants:
        result.variants == null
          ? Prisma.JsonNull
          : (result.variants as Prisma.InputJsonValue),
    },
  });
  return result;
}
