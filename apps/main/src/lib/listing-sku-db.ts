import { prisma } from "database";
import { normalizeListingSku } from "./listing-sku";

export async function findConflictingStoreItemSku(args: {
  memberId: string;
  sku: string;
  excludeItemId?: string;
}): Promise<{ id: string } | null> {
  const sku = normalizeListingSku(args.sku);
  if (!sku) return null;
  return prisma.storeItem.findFirst({
    where: {
      memberId: args.memberId,
      sku: { equals: sku, mode: "insensitive" },
      ...(args.excludeItemId ? { id: { not: args.excludeItemId } } : {}),
    },
    select: { id: true },
  });
}
