import Stripe from "stripe";
import { prisma } from "database";

const cache = new Map<string, { enabled: boolean; at: number }>();
const CACHE_MS = 60_000;

function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key?.startsWith("sk_")) return null;
  return new Stripe(key, { apiVersion: "2024-11-20.acacia" as "2023-10-16" });
}

export async function connectAccountPayoutsEnabled(accountId: string): Promise<boolean> {
  const id = accountId.trim();
  if (!id) return false;
  const cached = cache.get(id);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.enabled;

  const stripe = stripeClient();
  if (!stripe) return false;
  try {
    const account = await stripe.accounts.retrieve(id);
    const enabled = Boolean(account.payouts_enabled);
    cache.set(id, { enabled, at: Date.now() });
    return enabled;
  } catch (e) {
    console.warn("[stripe-connect] payouts_enabled retrieve failed", {
      error: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
}

export async function memberHasConnectPayoutsEnabled(memberId: string): Promise<boolean> {
  const row = await prisma.member.findUnique({
    where: { id: memberId },
    select: { stripeConnectAccountId: true },
  });
  const accountId = row?.stripeConnectAccountId?.trim();
  if (!accountId) return false;
  return connectAccountPayoutsEnabled(accountId);
}

export function _clearConnectPayoutsCacheForTests() {
  cache.clear();
}
