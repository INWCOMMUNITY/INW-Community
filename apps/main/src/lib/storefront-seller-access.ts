import { prisma } from "database";

/**
 * Members with an active **subscribe** or **seller** plan may list on the storefront
 * (resale-only for subscribe; full seller for seller). Same cohort that may need Shippo.
 */
export async function memberHasStorefrontListingAccess(memberId: string): Promise<boolean> {
  const sub = await prisma.subscription.findFirst({
    where: {
      memberId,
      status: "active",
      plan: { in: ["seller", "subscribe"] },
    },
  });
  return Boolean(sub);
}
