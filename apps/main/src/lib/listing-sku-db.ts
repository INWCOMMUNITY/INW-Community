import { prisma } from "database";
import { normalizeListingSku } from "./listing-sku";
import { skuOwnerKey } from "./channels/sku-identity";
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
