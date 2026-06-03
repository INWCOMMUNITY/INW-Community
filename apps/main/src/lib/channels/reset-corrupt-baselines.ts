import { prisma } from "database";
import {
  clampSaneInventoryQty,
  isCorruptBaselineQty,
  isSaneInventoryQty,
} from "./inventory-sanity";

/** Reset poisoned syncBaselineQty values (e.g. inflation loop) to match current INW quantity. */
export async function resetCorruptBaselinesForConnection(args: {
  connectionId: string;
  memberId?: string;
}): Promise<{ reset: number; linkIds: string[] }> {
  const links = await prisma.channelListingLink.findMany({
    where: {
      connectionId: args.connectionId,
      syncEnabled: true,
      ...(args.memberId ? { storeItem: { memberId: args.memberId } } : {}),
    },
    select: {
      id: true,
      syncBaselineQty: true,
      storeItem: { select: { quantity: true } },
    },
  });

  const linkIds: string[] = [];
  for (const link of links) {
    if (!isCorruptBaselineQty(link.syncBaselineQty)) continue;
    const sane = clampSaneInventoryQty(link.storeItem.quantity);
    if (sane == null) continue;
    await prisma.channelListingLink.update({
      where: { id: link.id },
      data: {
        syncBaselineQty: sane,
        syncBaselineAt: new Date(),
        syncError: null,
        syncStatus: "synced",
      },
    });
    linkIds.push(link.id);
  }

  if (linkIds.length > 0) {
    console.info("[channels] reset corrupt baselines", {
      connectionId: args.connectionId,
      count: linkIds.length,
    });
  }
  return { reset: linkIds.length, linkIds };
}

export function effectiveBaselineQty(
  baselineQty: number | null | undefined,
  inwQty: number
): number | null {
  if (isCorruptBaselineQty(baselineQty)) {
    return clampSaneInventoryQty(inwQty);
  }
  if (baselineQty != null && isSaneInventoryQty(baselineQty)) {
    return baselineQty;
  }
  return null;
}
