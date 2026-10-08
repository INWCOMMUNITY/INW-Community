import type Stripe from "stripe";
import { prisma } from "database";
import {
  collectKnownConnectAccountIdsForMember,
  ensureConnectAccountMemberMetadata,
  findExistingConnectAccountIdForEmail,
} from "@/lib/stripe-connect-reuse-account";

/**
 * True only when Stripe confirms the Connect account id itself is missing.
 * Do NOT treat generic "invalid id" / balance / permission errors as gone —
 * those were falsely clearing sellers' Connect links and blocking listings.
 */
export function isStripeConnectAccountMissingError(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  const msg = (e?.message ?? (err instanceof Error ? err.message : String(err))).toLowerCase();
  if (/no such customer|no such charge|no such transfer|no such payout|no such balance/i.test(msg)) {
    return false;
  }
  if (e?.code === "resource_missing" && /account/i.test(msg)) {
    return true;
  }
  return /no such account/i.test(msg);
}

export type ConnectHealResult =
  | { ok: true; accountId: string; healed: boolean; account: Stripe.Account }
  | { ok: false; cleared: boolean; reason: string };

/**
 * Load the member's Connect account. On a confirmed missing account, try to
 * reattach their preferred marketplace Express account from history/email.
 * Only clears stripeConnectAccountId when the account is confirmed gone and
 * nothing can be reattached — never on transient Stripe errors.
 */
export async function retrieveConnectAccountOrHeal(opts: {
  stripe: Stripe;
  memberId: string;
  email: string;
  accountId: string;
}): Promise<ConnectHealResult> {
  const currentId = opts.accountId.trim();
  if (!currentId.startsWith("acct_")) {
    return { ok: false, cleared: false, reason: "invalid_account_id_format" };
  }

  try {
    const account = await opts.stripe.accounts.retrieve(currentId);
    return { ok: true, accountId: currentId, healed: false, account };
  } catch (err) {
    if (!isStripeConnectAccountMissingError(err)) {
      console.warn("[stripe-connect] retrieve failed; leaving Connect link intact", {
        memberId: opts.memberId,
        accountId: currentId,
        error: err instanceof Error ? err.message : String(err),
      });
      return { ok: false, cleared: false, reason: "transient_or_unknown_error" };
    }
  }

  // Confirmed missing — try to reattach a known / preferred Express account.
  try {
    const knownAccountIds = await collectKnownConnectAccountIdsForMember(
      prisma,
      opts.stripe,
      opts.memberId
    );
    const preferredId = await findExistingConnectAccountIdForEmail(opts.stripe, opts.email, {
      memberId: opts.memberId,
      knownAccountIds,
    });
    if (preferredId && preferredId !== currentId) {
      const account = await opts.stripe.accounts.retrieve(preferredId);
      await prisma.member.update({
        where: { id: opts.memberId },
        data: { stripeConnectAccountId: preferredId },
      });
      await ensureConnectAccountMemberMetadata(opts.stripe, preferredId, opts.memberId);
      console.info("[stripe-connect] reattached preferred Connect account after missing id", {
        memberId: opts.memberId,
        previousAccountId: currentId,
        preferredAccountId: preferredId,
      });
      return { ok: true, accountId: preferredId, healed: true, account };
    }
  } catch (healErr) {
    console.warn("[stripe-connect] heal after missing account failed", {
      memberId: opts.memberId,
      error: healErr instanceof Error ? healErr.message : String(healErr),
    });
  }

  await prisma.member
    .update({
      where: { id: opts.memberId },
      data: { stripeConnectAccountId: null },
    })
    .catch(() => {});
  console.warn("[stripe-connect] cleared Connect link; account confirmed missing and no preferred found", {
    memberId: opts.memberId,
    accountId: currentId,
  });
  return { ok: false, cleared: true, reason: "account_missing_no_preferred" };
}
