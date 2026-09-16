import { prisma, Prisma } from "database";
import { normalizeListingSku, generateListingSku } from "./listing-sku";
import { normalizeVariantMatrix, type VariantMatrix } from "./listing-variant-matrix";

/**
 * Normalize SKU to a canonical key for comparison.
 * This is a case-insensitive, trimmed version of the SKU.
 */
function skuOwnerKey(sku: string | null | undefined): string | null {
  if (!sku) return null;
  const normalized = sku.trim().toLowerCase();
  return normalized || null;
}

/**
 * Ensure all sellable items have SKUs.
 * Generates SKUs for the parent item and variant rows if they don't have them.
 */
function ensureSellableSkus(
  item: { id: string; sku: string | null; variants: unknown },
  usedKeys: Set<string>
): { sku: string | null; variants: unknown; changed: boolean } {
  let changed = false;
  let parentSku = item.sku;

  // Ensure parent SKU
  if (!parentSku) {
    parentSku = generateUniqueSku(item.id, usedKeys);
    usedKeys.add(skuOwnerKey(parentSku)!);
    changed = true;
  }

  // Ensure variant SKUs
  const matrix = normalizeVariantMatrix(item.variants);
  if (matrix && matrix.skus.length > 0) {
    const updatedSkus = matrix.skus.map((row, index) => {
      if (row.sku) return row;
      // Create a key from the options or fallback to index
      const optionKey = Object.values(row.options || {}).join("-") || String(index);
      const newSku = generateUniqueSku(`${item.id}-${optionKey}`, usedKeys);
      usedKeys.add(skuOwnerKey(newSku)!);
      changed = true;
      return { ...row, sku: newSku };
    });
    if (changed) {
      return {
        sku: parentSku,
        variants: { ...matrix, skus: updatedSkus },
        changed: true,
      };
    }
  }

  return { sku: parentSku, variants: item.variants, changed };
}

/**
 * Generate a unique SKU that's not in the used set.
 */
function generateUniqueSku(seed: string, usedKeys: Set<string>): string {
  let sku = generateListingSku(seed);
  let attempt = 0;
  while (usedKeys.has(skuOwnerKey(sku)!)) {
    attempt++;
    sku = generateListingSku(`${seed}-${attempt}`);
  }
  return sku;
}

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

/** Mint or canonicalize join keys on INW, then persist. */
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
