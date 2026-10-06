import {
  assertLegacyInteractiveMutationAllowed,
  isCommerceFoundationCutoverBlockedError,
  prisma,
} from "database";
import { inactiveStoreItemData } from "@/lib/store-item-ended-status";

/**
 * Disconnects a member from Stripe Connect: clears stripeConnectAccountId and
 * disables all their currently listed (active) store items so they no longer
 * appear for sale. Sold items are left as-is. Allows re-onboarding afterward.
 *
 * Clearing the Connect id must succeed even during inventory cutover freeze so
 * sellers can re-onboard on a new marketplace Stripe account. Listing deactivation
 * still requires an allowed cutover mode; checkout already blocks sales without Connect.
 */
export async function disconnectStripeAndDisableListings(memberId: string): Promise<void> {
  await prisma.member.update({
    where: { id: memberId },
    data: { stripeConnectAccountId: null },
  });

  try {
    await assertLegacyInteractiveMutationAllowed(prisma);
  } catch (e) {
    if (isCommerceFoundationCutoverBlockedError(e)) {
      return;
    }
    throw e;
  }

  await prisma.storeItem.updateMany({
    where: { memberId, status: "active" },
    data: inactiveStoreItemData(),
  });
}
