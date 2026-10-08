import type Stripe from "stripe";

/** Minimal DB surface used for historical Connect destination recovery. */
export type ConnectReusePrisma = {
  transferOperation: {
    findMany: (args: {
      where: { memberId: string; stripeTransferId: { not: null } };
      select: { stripeTransferId: true };
      orderBy: { createdAt: "desc" };
      take: number;
    }) => Promise<Array<{ stripeTransferId: string | null }>>;
  };
  sellerReturnEntitlementOperation: {
    findMany: (args: {
      where: { memberId: string; stripeDestinationAccountId: { not: null } };
      select: { stripeDestinationAccountId: true };
      orderBy: { createdAt: "desc" };
      take: number;
    }) => Promise<Array<{ stripeDestinationAccountId: string | null }>>;
  };
  storeOrder: {
    findMany: (args: {
      where: { sellerId: string; stripeSellerTransferId: { not: null } };
      select: { stripeSellerTransferId: true };
      orderBy: { createdAt: "desc" };
      take: number;
    }) => Promise<Array<{ stripeSellerTransferId: string | null }>>;
  };
};

export type ConnectReuseCandidate = {
  id: string;
  balanceCents: number;
  charges: number;
  payouts: number;
  details: number;
  created: number;
};

function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function accountEmails(acct: Stripe.Account): string[] {
  const emails = new Set<string>();
  const top = normalizeEmail(acct.email);
  if (top.includes("@")) emails.add(top);
  const individual = normalizeEmail(
    (acct.individual as Stripe.Person | null | undefined)?.email ?? null
  );
  if (individual.includes("@")) emails.add(individual);
  return [...emails];
}

/**
 * Score Connect accounts so reconnect prefers the funded / completed Express
 * account instead of a newer empty duplicate.
 */
export function rankConnectReuseCandidates(
  candidates: ConnectReuseCandidate[]
): ConnectReuseCandidate[] {
  return [...candidates].sort(
    (a, b) =>
      b.balanceCents - a.balanceCents ||
      b.charges - a.charges ||
      b.payouts - a.payouts ||
      b.details - a.details ||
      a.created - b.created
  );
}

export async function scoreConnectAccount(
  stripe: Stripe,
  acct: Stripe.Account
): Promise<ConnectReuseCandidate> {
  let balanceCents = 0;
  try {
    const bal = await stripe.balance.retrieve({ stripeAccount: acct.id });
    for (const row of [...(bal.available ?? []), ...(bal.pending ?? [])]) {
      if (row.currency === "usd") balanceCents += row.amount ?? 0;
    }
  } catch {
    // Unfinished / restricted accounts may fail balance reads.
  }
  return {
    id: acct.id,
    balanceCents,
    charges: acct.charges_enabled ? 1 : 0,
    payouts: acct.payouts_enabled ? 1 : 0,
    details: acct.details_submitted ? 1 : 0,
    created: acct.created ?? 0,
  };
}

/**
 * Collect Connect account ids this seller already received transfers on
 * (marketplace platform only). Survives email mismatches on Express profiles.
 */
export async function collectKnownConnectAccountIdsForMember(
  prisma: ConnectReusePrisma,
  stripe: Stripe,
  memberId: string
): Promise<string[]> {
  const ids = new Set<string>();

  const [transferOps, entitlementOps, sellerOrders] = await Promise.all([
    prisma.transferOperation.findMany({
      where: { memberId, stripeTransferId: { not: null } },
      select: { stripeTransferId: true },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
    prisma.sellerReturnEntitlementOperation.findMany({
      where: { memberId, stripeDestinationAccountId: { not: null } },
      select: { stripeDestinationAccountId: true },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
    prisma.storeOrder.findMany({
      where: { sellerId: memberId, stripeSellerTransferId: { not: null } },
      select: { stripeSellerTransferId: true },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
  ]);

  for (const row of entitlementOps) {
    const id = row.stripeDestinationAccountId?.trim();
    if (id?.startsWith("acct_")) ids.add(id);
  }

  const transferIds = [
    ...transferOps.map((r) => r.stripeTransferId?.trim()).filter(Boolean),
    ...sellerOrders.map((r) => r.stripeSellerTransferId?.trim()).filter(Boolean),
  ] as string[];

  const uniqueTransferIds = [...new Set(transferIds)].slice(0, 25);
  await Promise.all(
    uniqueTransferIds.map(async (transferId) => {
      try {
        const tr = await stripe.transfers.retrieve(transferId);
        const dest =
          typeof tr.destination === "string"
            ? tr.destination
            : tr.destination && typeof tr.destination === "object" && "id" in tr.destination
              ? String((tr.destination as { id?: string }).id ?? "")
              : "";
        if (dest.startsWith("acct_")) ids.add(dest);
      } catch {
        // Transfer may be from another Stripe account / deleted.
      }
    })
  );

  return [...ids];
}

/**
 * Find the preferred marketplace Express account for this seller so reconnect
 * does not create a second Connect account and strand funds.
 *
 * Candidates: email match, individual email match, metadata.memberId, and any
 * known destination ids from prior transfers.
 *
 * Preference: highest available+pending balance, then charges/payouts enabled,
 * then details_submitted, then oldest created.
 */
export async function findExistingConnectAccountIdForEmail(
  stripe: Stripe,
  email: string,
  opts?: {
    memberId?: string | null;
    knownAccountIds?: string[] | null;
  }
): Promise<string | null> {
  const want = normalizeEmail(email);
  const memberId = opts?.memberId?.trim() || null;
  const knownIds = new Set(
    (opts?.knownAccountIds ?? [])
      .map((id) => id.trim())
      .filter((id) => id.startsWith("acct_"))
  );

  if (!want.includes("@") && !memberId && knownIds.size === 0) return null;

  const byId = new Map<string, Stripe.Account>();

  for (const knownId of knownIds) {
    try {
      const acct = await stripe.accounts.retrieve(knownId);
      byId.set(acct.id, acct);
    } catch {
      // Stale destination from another platform or deleted account.
    }
  }

  let startingAfter: string | undefined;
  for (let page = 0; page < 20; page++) {
    const list = await stripe.accounts.list({
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    for (const acct of list.data) {
      const emailMatch =
        want.includes("@") && accountEmails(acct).some((e) => e === want);
      const metaMatch = Boolean(memberId && acct.metadata?.memberId === memberId);
      const knownMatch = knownIds.has(acct.id);
      if (emailMatch || metaMatch || knownMatch) {
        byId.set(acct.id, acct);
      }
    }
    if (!list.has_more || list.data.length === 0) break;
    startingAfter = list.data[list.data.length - 1]!.id;
  }

  const matches = [...byId.values()];
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0]!.id;

  const scored = await Promise.all(matches.map((acct) => scoreConnectAccount(stripe, acct)));
  const ranked = rankConnectReuseCandidates(scored);
  return ranked[0]?.id ?? null;
}

/** Stamp memberId on a reused Express account so future reconnects match without email. */
export async function ensureConnectAccountMemberMetadata(
  stripe: Stripe,
  accountId: string,
  memberId: string
): Promise<void> {
  const id = memberId.trim();
  if (!id || !accountId.startsWith("acct_")) return;
  try {
    const acct = await stripe.accounts.retrieve(accountId);
    if (acct.metadata?.memberId === id) return;
    await stripe.accounts.update(accountId, {
      metadata: { ...(acct.metadata ?? {}), memberId: id },
    });
  } catch (err) {
    console.warn("[stripe-connect-reuse] failed to stamp memberId metadata", {
      accountId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Intentionally a no-op. Deleting empty Express duplicates caused Stripe
 * `account.application.deauthorized` noise and risked clearing seller Connect
 * links. Orphan empty accounts are harmless; prefer reattach over delete.
 */
export async function maybeDeleteEmptyDuplicateConnectAccount(
  _stripe: Stripe,
  _emptyAccountId: string | null | undefined,
  _preferredAccountId: string
): Promise<void> {
  return;
}
