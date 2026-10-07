import type Stripe from "stripe";

/**
 * Find an existing Express/connected account on this platform for the given email
 * (and optional memberId metadata). Used so re-onboarding does not create a second
 * Connect account (and strand funds).
 *
 * Preference when multiple match: highest available+pending balance, then payouts_enabled,
 * then details_submitted, then oldest created.
 */
export async function findExistingConnectAccountIdForEmail(
  stripe: Stripe,
  email: string,
  opts?: { memberId?: string | null }
): Promise<string | null> {
  const want = email.trim().toLowerCase();
  const memberId = opts?.memberId?.trim() || null;
  if (!want.includes("@") && !memberId) return null;

  const matches: Stripe.Account[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < 20; page++) {
    const list = await stripe.accounts.list({
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    for (const acct of list.data) {
      const emailMatch = want.includes("@") && (acct.email ?? "").trim().toLowerCase() === want;
      const metaMatch = Boolean(memberId && acct.metadata?.memberId === memberId);
      if (emailMatch || metaMatch) {
        matches.push(acct);
      }
    }
    if (!list.has_more || list.data.length === 0) break;
    startingAfter = list.data[list.data.length - 1]!.id;
  }

  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0]!.id;

  const scored = await Promise.all(
    matches.map(async (acct) => {
      let balanceCents = 0;
      try {
        const bal = await stripe.balance.retrieve({ stripeAccount: acct.id });
        for (const row of [...(bal.available ?? []), ...(bal.pending ?? [])]) {
          if (row.currency === "usd") balanceCents += row.amount ?? 0;
        }
      } catch {
        // Account may still be unfinished; keep score at 0.
      }
      return {
        id: acct.id,
        balanceCents,
        payouts: acct.payouts_enabled ? 1 : 0,
        details: acct.details_submitted ? 1 : 0,
        created: acct.created ?? 0,
      };
    })
  );

  scored.sort(
    (a, b) =>
      b.balanceCents - a.balanceCents ||
      b.payouts - a.payouts ||
      b.details - a.details ||
      a.created - b.created
  );
  return scored[0]?.id ?? null;
}
