import { prisma } from "database";

/**
 * A listing is publicly sellable on the storefront only when Connect is on the owning member.
 * POST/PATCH already block creates/edits without Connect; this models the same rule for checks.
 */
export async function memberHasStripeConnectForStorefront(memberId: string): Promise<boolean> {
  const row = await prisma.member.findUnique({
    where: { id: memberId },
    select: { stripeConnectAccountId: true },
  });
  return Boolean(row?.stripeConnectAccountId?.trim());
}

/** After update fields merged with existing row: would this row appear on public browse (same gates as GET /api/store-items)? */
export function wouldBePubliclyBrowsableLive(
  existing: { status: string; quantity: number },
  patch: { status?: string; quantity?: number }
): boolean {
  const status = patch.status !== undefined ? patch.status : existing.status;
  const quantity = patch.quantity !== undefined ? patch.quantity : existing.quantity;
  return status === "active" && quantity > 0;
}

/**
 * Sets active listings to inactive when the member has no Stripe Connect (repair DB drift).
 */
export async function deactivateActiveListingsIfMemberLacksConnect(memberId: string): Promise<void> {
  const has = await memberHasStripeConnectForStorefront(memberId);
  if (has) return;
  await prisma.storeItem.updateMany({
    where: { memberId, status: "active" },
    data: { status: "inactive" },
  });
}
