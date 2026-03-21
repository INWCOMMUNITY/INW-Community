import { prisma } from "database";

/** Mark accepted offers past checkout deadline as expired and remove their cart lines. */
export async function expireStaleResaleOffers(): Promise<void> {
  const now = new Date();
  const stale = await prisma.resaleOffer.findMany({
    where: { status: "accepted", checkoutDeadlineAt: { lt: now } },
    select: { id: true },
  });
  if (stale.length === 0) return;
  const ids = stale.map((s) => s.id);
  await prisma.resaleOffer.updateMany({
    where: { id: { in: ids } },
    data: { status: "expired" },
  });
  await prisma.cartItem.deleteMany({
    where: { resaleOfferId: { in: ids } },
  });
}
