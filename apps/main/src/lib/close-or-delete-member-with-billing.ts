import { prisma, closeOrDeleteMemberAccount } from "database";
import type { MemberAccountLifecycleResult } from "database";
import { cancelMemberActiveSubscriptions } from "@/lib/cancel-member-active-subscriptions";

export type MemberAccountLifecycleWithBilling =
  | { ok: false; error: "not_found" }
  | { ok: true; outcome: "deleted" | "closed"; billingCleanupPending: boolean };

/**
 * Close or hard-delete the Member, then (for retained close only) attempt Stripe
 * subscription cancellation. Stripe is never called inside the Prisma transaction.
 */
export async function closeOrDeleteMemberAccountWithBilling(
  memberId: string
): Promise<MemberAccountLifecycleWithBilling> {
  const lifecycle: MemberAccountLifecycleResult = await closeOrDeleteMemberAccount(
    prisma,
    memberId
  );
  if (!lifecycle.ok) {
    return lifecycle;
  }
  if (lifecycle.outcome === "deleted") {
    return { ok: true, outcome: "deleted", billingCleanupPending: false };
  }

  const cancel = await cancelMemberActiveSubscriptions(memberId);
  return {
    ok: true,
    outcome: "closed",
    billingCleanupPending: cancel.billingCleanupPending,
  };
}
