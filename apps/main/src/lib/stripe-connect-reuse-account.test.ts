import { describe, expect, it, vi } from "vitest";
import {
  findExistingConnectAccountIdForEmail,
  rankConnectReuseCandidates,
} from "./stripe-connect-reuse-account";

describe("rankConnectReuseCandidates", () => {
  it("prefers highest balance over newer empty accounts", () => {
    const ranked = rankConnectReuseCandidates([
      {
        id: "acct_empty",
        balanceCents: 0,
        charges: 1,
        payouts: 1,
        details: 1,
        created: 200,
      },
      {
        id: "acct_funded",
        balanceCents: 229,
        charges: 1,
        payouts: 1,
        details: 1,
        created: 100,
      },
    ]);
    expect(ranked[0]?.id).toBe("acct_funded");
  });
});

describe("findExistingConnectAccountIdForEmail", () => {
  it("includes known transfer destinations even when Express email differs", async () => {
    const stripe = {
      accounts: {
        retrieve: vi.fn(async (id: string) => {
          if (id === "acct_funded") {
            return {
              id: "acct_funded",
              email: "express-other@example.com",
              charges_enabled: true,
              payouts_enabled: true,
              details_submitted: true,
              created: 100,
              metadata: {},
            };
          }
          throw new Error("no such account");
        }),
        list: vi.fn(async () => ({
          data: [
            {
              id: "acct_empty",
              email: "member@example.com",
              charges_enabled: true,
              payouts_enabled: true,
              details_submitted: true,
              created: 200,
              metadata: { memberId: "mem_1" },
            },
          ],
          has_more: false,
        })),
      },
      balance: {
        retrieve: vi.fn(async ({ stripeAccount }: { stripeAccount: string }) => {
          if (stripeAccount === "acct_funded") {
            return {
              available: [{ currency: "usd", amount: 229 }],
              pending: [],
            };
          }
          return { available: [{ currency: "usd", amount: 0 }], pending: [] };
        }),
      },
    };

    const preferred = await findExistingConnectAccountIdForEmail(
      stripe as never,
      "member@example.com",
      {
        memberId: "mem_1",
        knownAccountIds: ["acct_funded"],
      }
    );

    expect(preferred).toBe("acct_funded");
  });

  it("returns null when nothing matches", async () => {
    const stripe = {
      accounts: {
        retrieve: vi.fn(),
        list: vi.fn(async () => ({ data: [], has_more: false })),
      },
      balance: { retrieve: vi.fn() },
    };
    const preferred = await findExistingConnectAccountIdForEmail(
      stripe as never,
      "nobody@example.com",
      { memberId: "mem_x" }
    );
    expect(preferred).toBeNull();
  });
});
