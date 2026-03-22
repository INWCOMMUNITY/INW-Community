import { prisma } from "database";

/**
 * One Stripe Customer per member so Billing Portal lists every active subscription together.
 * Prefer member.stripeCustomerId; otherwise use the stripeCustomerId that appears on the most
 * active subscription rows (handles legacy duplicates).
 */
export async function resolveStripeCustomerIdForMember(memberId: string): Promise<string | null> {
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: { stripeCustomerId: true },
  });
  const fromMember = member?.stripeCustomerId?.trim();
  if (fromMember) return fromMember;

  const subs = await prisma.subscription.findMany({
    where: { memberId, status: "active", stripeCustomerId: { not: null } },
    select: { stripeCustomerId: true },
  });
  const ids = subs
    .map((s) => s.stripeCustomerId?.trim())
    .filter((id): id is string => Boolean(id));
  if (ids.length === 0) return null;

  const freq = new Map<string, number>();
  for (const id of ids) freq.set(id, (freq.get(id) ?? 0) + 1);
  return [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0];
}
