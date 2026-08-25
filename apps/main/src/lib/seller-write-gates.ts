import { prisma } from "database";

export function isSellerTimeAwayActive(
  ta: { startAt: Date; endAt: Date } | null | undefined,
  now = new Date()
): boolean {
  if (!ta) return false;
  const start = new Date(ta.startAt);
  const end = new Date(ta.endAt);
  return now >= start && now <= end;
}

export async function sellerIsAwayFromOrders(memberId: string): Promise<boolean> {
  const ta = await prisma.sellerTimeAway.findUnique({
    where: { memberId },
    select: { startAt: true, endAt: true },
  });
  return isSellerTimeAwayActive(ta);
}

export async function sellerAcceptsListingMessages(memberId: string): Promise<boolean> {
  const row = await prisma.member.findUnique({
    where: { id: memberId },
    select: { acceptMessagesForListings: true },
  });
  return row?.acceptMessagesForListings !== false;
}
