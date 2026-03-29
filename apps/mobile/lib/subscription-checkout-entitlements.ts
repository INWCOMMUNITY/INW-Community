import { apiGet, apiPost } from "@/lib/api";

const PAID_ACCESS = new Set(["active", "trialing", "past_due"]);

export function memberHasPaidPlan(
  member: { subscriptions?: { plan: string; status: string }[] } | null | undefined,
  planId: string
): boolean {
  return (
    member?.subscriptions?.some((s) => s.plan === planId && PAID_ACCESS.has(s.status)) ?? false
  );
}

/** Pull Stripe subscriptions into our DB (webhook safety net). */
export async function syncStripeSubscriptionsFromClient(): Promise<void> {
  await apiPost("/api/stripe/sync-subscriptions", {}).catch(() => {});
}

/**
 * After checkout, ensure /api/me reflects the new plan (webhooks can lag).
 * Returns true if the plan appears with a paid-access status.
 */
export async function waitForMemberPlanAfterCheckout(
  planId: string,
  opts?: { maxAttempts?: number; delayMs?: number }
): Promise<boolean> {
  const maxAttempts = opts?.maxAttempts ?? 14;
  const delayMs = opts?.delayMs ?? 450;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const m = await apiGet<{ subscriptions?: { plan: string; status: string }[] }>("/api/me");
      if (memberHasPaidPlan(m, planId)) return true;
    } catch {
      /* retry */
    }
    if (i < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return false;
}
