import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockPrisma,
  beginFoundationReturnEntitlementAttempt,
  persistFoundationReturnEntitlementSuccess,
  persistFoundationReturnEntitlementOutcome,
  persistFoundationReturnEntitlementPreflightFailure,
  completeFoundationSellerReturnEntitlementLedger,
  classifyStripeTransferFailure,
} = vi.hoisted(() => {
  return {
    mockPrisma: {
      storeOrder: { findUnique: vi.fn() },
      member: { findUnique: vi.fn() },
      sellerReturnEntitlementOperation: { findUnique: vi.fn() },
    },
    beginFoundationReturnEntitlementAttempt: vi.fn(),
    persistFoundationReturnEntitlementSuccess: vi.fn(),
    persistFoundationReturnEntitlementOutcome: vi.fn(),
    persistFoundationReturnEntitlementPreflightFailure: vi.fn(),
    completeFoundationSellerReturnEntitlementLedger: vi.fn(),
    classifyStripeTransferFailure: vi.fn((err: unknown) =>
      err && typeof err === "object" && (err as { uncertain?: boolean }).uncertain ? "uncertain" : "failed"
    ),
  };
});

vi.mock("database", () => ({
  prisma: mockPrisma,
  beginFoundationReturnEntitlementAttempt,
  persistFoundationReturnEntitlementSuccess,
  persistFoundationReturnEntitlementOutcome,
  persistFoundationReturnEntitlementPreflightFailure,
  completeFoundationSellerReturnEntitlementLedger,
  classifyStripeTransferFailure,
  FOUNDATION_TRANSFER_SUCCEEDED_WITHOUT_ID: "succeeded_without_stripe_transfer_id",
  FOUNDATION_RETURN_ENTITLEMENT_SNAPSHOT_MISSING_AFTER_ATTEMPT: "provider_snapshot_missing_after_attempt",
}));

import { executeSellerReturnEntitlement } from "./seller-return-entitlement";

const KEY = "nwc_store_return_entitlement_ord-1";
const SALE_KEY = "nwc_store_transfer_ord-1";
const FROZEN_DEST = "acct_A";
const FROZEN_CHARGE = "ch_A";

function entitlementOp(overrides: Record<string, unknown> = {}) {
  return {
    id: "sreo_1",
    memberId: "seller-1",
    storeOrderId: "ord-1",
    storeReturnId: "ret-1",
    providerIdempotencyKey: KEY,
    stripeTransferId: null,
    stripeDestinationAccountId: null,
    stripeSourceChargeId: null,
    amountCents: 1000,
    currency: "usd",
    status: "PENDING",
    retryCount: 0,
    lastError: null,
    lastAttemptAt: null,
    succeededAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function processingOp(overrides: Record<string, unknown> = {}) {
  return entitlementOp({
    status: "PROCESSING",
    retryCount: 1,
    lastAttemptAt: new Date("2026-01-01T00:00:01.000Z"),
    stripeDestinationAccountId: FROZEN_DEST,
    stripeSourceChargeId: FROZEN_CHARGE,
    ...overrides,
  });
}

function stripeStub(transferId = "tr_ent_1") {
  return {
    paymentIntents: {
      retrieve: vi.fn().mockResolvedValue({ latest_charge: "ch_checkout_1" }),
    },
    transfers: {
      create: vi.fn().mockResolvedValue({ id: transferId }),
      createReversal: vi.fn(),
    },
    refunds: {
      create: vi.fn(),
    },
  };
}

function mockFirstAttemptBegin() {
  beginFoundationReturnEntitlementAttempt.mockImplementation(
    async (_db: unknown, args: { providerSnapshot?: { stripeDestinationAccountId: string; stripeSourceChargeId: string } }) => {
      if (!args.providerSnapshot) {
        return { action: "needs_provider_snapshot", operation: entitlementOp() };
      }
      return {
        action: "provider_create",
        operation: processingOp({
          stripeDestinationAccountId: args.providerSnapshot.stripeDestinationAccountId,
          stripeSourceChargeId: args.providerSnapshot.stripeSourceChargeId,
        }),
      };
    }
  );
}

function seedHappyPath(op = entitlementOp()) {
  mockPrisma.storeOrder.findUnique.mockResolvedValue({
    id: "ord-1",
    sellerId: "seller-1",
    stripePaymentIntentId: "pi_checkout_1",
    status: "refunded",
  });
  mockPrisma.sellerReturnEntitlementOperation.findUnique.mockResolvedValue(op);
  mockPrisma.member.findUnique.mockResolvedValue({ stripeConnectAccountId: "acct_live_1" });
  mockFirstAttemptBegin();
  persistFoundationReturnEntitlementSuccess.mockImplementation(
    async (_db: unknown, args: { stripeTransferId: string }) =>
      entitlementOp({
        status: "SUCCEEDED",
        stripeTransferId: args.stripeTransferId,
        retryCount: 1,
        stripeDestinationAccountId: FROZEN_DEST,
        stripeSourceChargeId: FROZEN_CHARGE,
        succeededAt: new Date(),
      })
  );
  completeFoundationSellerReturnEntitlementLedger.mockResolvedValue({ ledgerCreated: true });
}

function seedReplayPath(op = processingOp()) {
  mockPrisma.storeOrder.findUnique.mockResolvedValue({
    id: "ord-1",
    sellerId: "seller-1",
    stripePaymentIntentId: "pi_checkout_1",
    status: "refunded",
  });
  mockPrisma.sellerReturnEntitlementOperation.findUnique.mockResolvedValue(op);
  mockPrisma.member.findUnique.mockResolvedValue({ stripeConnectAccountId: "acct_B" });
  beginFoundationReturnEntitlementAttempt.mockResolvedValue({
    action: "provider_create",
    operation: processingOp({
      ...op,
      status: "PROCESSING",
      retryCount: (typeof op.retryCount === "number" ? op.retryCount : 1) + 1,
      stripeDestinationAccountId: op.stripeDestinationAccountId ?? FROZEN_DEST,
      stripeSourceChargeId: op.stripeSourceChargeId ?? FROZEN_CHARGE,
    }),
  });
  persistFoundationReturnEntitlementSuccess.mockImplementation(
    async (_db: unknown, args: { stripeTransferId: string }) =>
      entitlementOp({
        status: "SUCCEEDED",
        stripeTransferId: args.stripeTransferId,
        retryCount: 2,
        stripeDestinationAccountId: op.stripeDestinationAccountId ?? FROZEN_DEST,
        stripeSourceChargeId: op.stripeSourceChargeId ?? FROZEN_CHARGE,
        succeededAt: new Date(),
      })
  );
  completeFoundationSellerReturnEntitlementLedger.mockResolvedValue({ ledgerCreated: true });
}

describe("executeSellerReturnEntitlement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    classifyStripeTransferFailure.mockImplementation((err: unknown) =>
      err && typeof err === "object" && (err as { uncertain?: boolean }).uncertain ? "uncertain" : "failed"
    );
  });

  it("allows a first PENDING retryCount 0 attempt regardless of operation age", async () => {
    const createdAt = new Date("2020-01-01T00:00:00.000Z");
    seedHappyPath(entitlementOp({ createdAt, retryCount: 0, status: "PENDING" }));
    const stripe = stripeStub();
    const now = new Date("2026-09-21T00:00:00.000Z");
    const result = await executeSellerReturnEntitlement(stripe as never, { storeOrderId: "ord-1", now });
    expect(result.kind).toBe("SUCCEEDED");
    expect(beginFoundationReturnEntitlementAttempt).toHaveBeenNthCalledWith(1, expect.anything(), {
      storeOrderId: "ord-1",
      now,
    });
    expect(beginFoundationReturnEntitlementAttempt).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        storeOrderId: "ord-1",
        now,
        providerSnapshot: {
          stripeDestinationAccountId: "acct_live_1",
          stripeSourceChargeId: "ch_checkout_1",
        },
      })
    );
    expect(stripe.transfers.create).toHaveBeenCalledTimes(1);
  });

  it("calls Stripe exactly once on first PENDING attempt with frozen amount, currency, live destination, charge, key, and metadata", async () => {
    seedHappyPath();
    const stripe = stripeStub();
    const result = await executeSellerReturnEntitlement(stripe as never, { storeOrderId: "ord-1" });
    expect(result.kind).toBe("SUCCEEDED");
    expect(stripe.transfers.create).toHaveBeenCalledTimes(1);
    expect(stripe.transfers.create.mock.calls[0][0]).toEqual({
      amount: 1000,
      currency: "usd",
      destination: "acct_live_1",
      source_transaction: "ch_checkout_1",
      metadata: {
        orderId: "ord-1",
        storeReturnId: "ret-1",
        sellerReturnEntitlementOperationId: "sreo_1",
      },
    });
    expect(stripe.transfers.create.mock.calls[0][1]).toEqual({ idempotencyKey: KEY });
    expect(stripe.transfers.create.mock.calls[0][1].idempotencyKey).not.toBe(SALE_KEY);
    expect(stripe.transfers.create.mock.calls[0][0].source_transaction).toMatch(/^ch_/);
    expect(stripe.transfers.create.mock.calls[0][0].source_transaction).not.toMatch(/^pi_/);
    expect(persistFoundationReturnEntitlementSuccess).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ storeOrderId: "ord-1", stripeTransferId: "tr_ent_1" })
    );
    expect(completeFoundationSellerReturnEntitlementLedger).toHaveBeenCalledTimes(1);
    expect(stripe.refunds.create).not.toHaveBeenCalled();
    expect(stripe.transfers.createReversal).not.toHaveBeenCalled();
  });

  it("uses the seller's current live Connect account, not a caller destination", async () => {
    seedHappyPath();
    mockPrisma.member.findUnique.mockResolvedValue({ stripeConnectAccountId: "acct_rotated" });
    const stripe = stripeStub();
    await executeSellerReturnEntitlement(stripe as never, { storeOrderId: "ord-1" });
    expect(stripe.transfers.create.mock.calls[0][0].destination).toBe("acct_rotated");
  });

  it("persists Stripe transfer ID and runs ledger after provider success", async () => {
    seedHappyPath();
    const stripe = stripeStub("tr_saved");
    const result = await executeSellerReturnEntitlement(stripe as never, { storeOrderId: "ord-1" });
    expect(result.kind).toBe("SUCCEEDED");
    if (result.kind !== "SUCCEEDED") return;
    expect(result.stripeTransferId).toBe("tr_saved");
    expect(result.ledgerCreated).toBe(true);
    expect(persistFoundationReturnEntitlementSuccess).toHaveBeenCalledTimes(1);
    expect(completeFoundationSellerReturnEntitlementLedger).toHaveBeenCalledTimes(1);
  });

  it("SUCCEEDED with transfer ID performs zero Stripe create and repairs missing ledger", async () => {
    const succeeded = entitlementOp({
      status: "SUCCEEDED",
      stripeTransferId: "tr_exist",
      retryCount: 1,
      stripeDestinationAccountId: FROZEN_DEST,
      stripeSourceChargeId: FROZEN_CHARGE,
    });
    mockPrisma.storeOrder.findUnique.mockResolvedValue({
      id: "ord-1",
      sellerId: "seller-1",
      stripePaymentIntentId: "pi_checkout_1",
    });
    mockPrisma.sellerReturnEntitlementOperation.findUnique.mockResolvedValue(succeeded);
    mockPrisma.member.findUnique.mockResolvedValue({ stripeConnectAccountId: "acct_live_1" });
    beginFoundationReturnEntitlementAttempt.mockResolvedValue({
      action: "already_succeeded",
      operation: succeeded,
    });
    completeFoundationSellerReturnEntitlementLedger.mockResolvedValue({ ledgerCreated: true });
    const stripe = stripeStub();
    const result = await executeSellerReturnEntitlement(stripe as never, { storeOrderId: "ord-1" });
    expect(result.kind).toBe("ALREADY_SUCCEEDED");
    if (result.kind !== "ALREADY_SUCCEEDED") return;
    expect(result.ledgerCreated).toBe(true);
    expect(stripe.transfers.create).not.toHaveBeenCalled();
    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
    expect(mockPrisma.member.findUnique).not.toHaveBeenCalled();
    expect(completeFoundationSellerReturnEntitlementLedger).toHaveBeenCalledTimes(1);
  });

  it("SUCCEEDED with ledger present performs zero Stripe create and zero duplicate ledger credit", async () => {
    const succeeded = entitlementOp({
      status: "SUCCEEDED",
      stripeTransferId: "tr_exist",
      retryCount: 1,
      stripeDestinationAccountId: FROZEN_DEST,
      stripeSourceChargeId: FROZEN_CHARGE,
    });
    mockPrisma.storeOrder.findUnique.mockResolvedValue({
      id: "ord-1",
      sellerId: "seller-1",
      stripePaymentIntentId: "pi_checkout_1",
    });
    mockPrisma.sellerReturnEntitlementOperation.findUnique.mockResolvedValue(succeeded);
    mockPrisma.member.findUnique.mockResolvedValue({ stripeConnectAccountId: "acct_live_1" });
    beginFoundationReturnEntitlementAttempt.mockResolvedValue({
      action: "already_succeeded",
      operation: succeeded,
    });
    completeFoundationSellerReturnEntitlementLedger.mockResolvedValue({ ledgerCreated: false });
    const stripe = stripeStub();
    const result = await executeSellerReturnEntitlement(stripe as never, { storeOrderId: "ord-1" });
    expect(result.kind).toBe("ALREADY_SUCCEEDED");
    if (result.kind !== "ALREADY_SUCCEEDED") return;
    expect(result.ledgerCreated).toBe(false);
    expect(stripe.transfers.create).not.toHaveBeenCalled();
    expect(completeFoundationSellerReturnEntitlementLedger).toHaveBeenCalledTimes(1);
  });

  it("fresh PROCESSING performs zero Stripe create", async () => {
    const inflight = processingOp();
    mockPrisma.storeOrder.findUnique.mockResolvedValue({
      id: "ord-1",
      sellerId: "seller-1",
      stripePaymentIntentId: "pi_checkout_1",
    });
    mockPrisma.sellerReturnEntitlementOperation.findUnique.mockResolvedValue(inflight);
    mockPrisma.member.findUnique.mockResolvedValue({ stripeConnectAccountId: "acct_live_1" });
    beginFoundationReturnEntitlementAttempt.mockResolvedValue({
      action: "skip_in_flight",
      operation: inflight,
    });
    const stripe = stripeStub();
    const result = await executeSellerReturnEntitlement(stripe as never, { storeOrderId: "ord-1" });
    expect(result.kind).toBe("IN_FLIGHT");
    expect(stripe.transfers.create).not.toHaveBeenCalled();
    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
    expect(mockPrisma.member.findUnique).not.toHaveBeenCalled();
    expect(persistFoundationReturnEntitlementSuccess).not.toHaveBeenCalled();
  });

  it("stale PROCESSING inside the replay window retries the same persisted key", async () => {
    seedReplayPath(processingOp({ lastAttemptAt: new Date("2026-01-01T00:00:00.000Z") }));
    const stripe = stripeStub("tr_replay");
    const now = new Date("2026-01-01T00:02:00.000Z");
    await executeSellerReturnEntitlement(stripe as never, { storeOrderId: "ord-1", now });
    expect(stripe.transfers.create).toHaveBeenCalledTimes(1);
    expect(stripe.transfers.create.mock.calls[0][1]).toEqual({ idempotencyKey: KEY });
    expect(beginFoundationReturnEntitlementAttempt).toHaveBeenCalledWith(expect.anything(), {
      storeOrderId: "ord-1",
      now,
    });
    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
    expect(mockPrisma.member.findUnique).not.toHaveBeenCalled();
  });

  it("stale PROCESSING outside the replay window performs zero Stripe create", async () => {
    const aged = processingOp({ createdAt: new Date("2026-01-01T00:00:00.000Z") });
    mockPrisma.storeOrder.findUnique.mockResolvedValue({
      id: "ord-1",
      sellerId: "seller-1",
      stripePaymentIntentId: "pi_checkout_1",
    });
    mockPrisma.sellerReturnEntitlementOperation.findUnique.mockResolvedValue(aged);
    beginFoundationReturnEntitlementAttempt.mockResolvedValue({
      action: "operator_required",
      operation: aged,
      reason: "uncertain_replay_window_elapsed",
    });
    const stripe = stripeStub();
    const now = new Date("2026-01-02T06:00:00.000Z");
    const result = await executeSellerReturnEntitlement(stripe as never, { storeOrderId: "ord-1", now });
    expect(result.kind).toBe("REPLAY_WINDOW_EXPIRED");
    expect(stripe.transfers.create).not.toHaveBeenCalled();
    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
  });

  it("UNCERTAIN inside the replay window retries the same persisted key", async () => {
    seedReplayPath(
      entitlementOp({
        status: "UNCERTAIN",
        retryCount: 1,
        lastError: "timeout",
        stripeDestinationAccountId: FROZEN_DEST,
        stripeSourceChargeId: FROZEN_CHARGE,
      })
    );
    const stripe = stripeStub("tr_same");
    await executeSellerReturnEntitlement(stripe as never, { storeOrderId: "ord-1" });
    expect(stripe.transfers.create).toHaveBeenCalledTimes(1);
    expect(stripe.transfers.create.mock.calls[0][1]).toEqual({ idempotencyKey: KEY });
    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
    expect(mockPrisma.member.findUnique).not.toHaveBeenCalled();
  });

  it("UNCERTAIN outside the replay window performs zero Stripe create", async () => {
    const aged = entitlementOp({
      status: "UNCERTAIN",
      retryCount: 1,
      lastError: "timeout",
      stripeDestinationAccountId: FROZEN_DEST,
      stripeSourceChargeId: FROZEN_CHARGE,
    });
    mockPrisma.storeOrder.findUnique.mockResolvedValue({
      id: "ord-1",
      sellerId: "seller-1",
      stripePaymentIntentId: "pi_checkout_1",
    });
    mockPrisma.sellerReturnEntitlementOperation.findUnique.mockResolvedValue(aged);
    beginFoundationReturnEntitlementAttempt.mockResolvedValue({
      action: "operator_required",
      operation: aged,
      reason: "uncertain_replay_window_elapsed",
    });
    const stripe = stripeStub();
    const result = await executeSellerReturnEntitlement(stripe as never, { storeOrderId: "ord-1" });
    expect(result.kind).toBe("REPLAY_WINDOW_EXPIRED");
    expect(stripe.transfers.create).not.toHaveBeenCalled();
  });

  it("FAILED performs zero Stripe create and requires reset", async () => {
    const failed = entitlementOp({ status: "FAILED", lastError: "missing_connect_account", retryCount: 0 });
    mockPrisma.storeOrder.findUnique.mockResolvedValue({
      id: "ord-1",
      sellerId: "seller-1",
      stripePaymentIntentId: "pi_checkout_1",
    });
    mockPrisma.sellerReturnEntitlementOperation.findUnique.mockResolvedValue(failed);
    beginFoundationReturnEntitlementAttempt.mockResolvedValue({
      action: "skip_failed",
      operation: failed,
    });
    const stripe = stripeStub();
    const result = await executeSellerReturnEntitlement(stripe as never, { storeOrderId: "ord-1" });
    expect(result.kind).toBe("FAILED_REQUIRES_RESET");
    expect(stripe.transfers.create).not.toHaveBeenCalled();
    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
    expect(mockPrisma.member.findUnique).not.toHaveBeenCalled();
  });

  it("SUCCEEDED without a transfer ID fails closed with zero Stripe create", async () => {
    const broken = entitlementOp({ status: "SUCCEEDED", stripeTransferId: null });
    mockPrisma.storeOrder.findUnique.mockResolvedValue({
      id: "ord-1",
      sellerId: "seller-1",
      stripePaymentIntentId: "pi_checkout_1",
    });
    mockPrisma.sellerReturnEntitlementOperation.findUnique.mockResolvedValue(broken);
    beginFoundationReturnEntitlementAttempt.mockResolvedValue({
      action: "operator_required",
      operation: broken,
      reason: "succeeded_without_stripe_transfer_id",
    });
    const stripe = stripeStub();
    const result = await executeSellerReturnEntitlement(stripe as never, { storeOrderId: "ord-1" });
    expect(result.kind).toBe("SUCCEEDED_WITHOUT_TRANSFER_ID");
    expect(stripe.transfers.create).not.toHaveBeenCalled();
  });

  it("missing Connect account performs zero Stripe create and persists a definitive failure", async () => {
    seedHappyPath();
    mockPrisma.member.findUnique.mockResolvedValue({ stripeConnectAccountId: null });
    persistFoundationReturnEntitlementPreflightFailure.mockResolvedValue({
      kind: "failed",
      operation: entitlementOp({ status: "FAILED", lastError: "missing_connect_account" }),
    });
    const stripe = stripeStub();
    const result = await executeSellerReturnEntitlement(stripe as never, { storeOrderId: "ord-1" });
    expect(result.kind).toBe("FAILED");
    if (result.kind !== "FAILED") return;
    expect(result.lastError).toBe("missing_connect_account");
    expect(stripe.transfers.create).not.toHaveBeenCalled();
    expect(beginFoundationReturnEntitlementAttempt).toHaveBeenCalledTimes(1);
    expect(persistFoundationReturnEntitlementPreflightFailure).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ storeOrderId: "ord-1", lastError: "missing_connect_account" })
    );
    expect(persistFoundationReturnEntitlementOutcome).not.toHaveBeenCalled();
  });

  it("missing charge performs zero Stripe create and persists a definitive failure", async () => {
    seedHappyPath();
    const stripe = stripeStub();
    stripe.paymentIntents.retrieve.mockResolvedValue({ latest_charge: null });
    persistFoundationReturnEntitlementPreflightFailure.mockResolvedValue({
      kind: "failed",
      operation: entitlementOp({ status: "FAILED", lastError: "missing_charge" }),
    });
    const result = await executeSellerReturnEntitlement(stripe as never, { storeOrderId: "ord-1" });
    expect(result.kind).toBe("FAILED");
    if (result.kind !== "FAILED") return;
    expect(result.lastError).toBe("missing_charge");
    expect(stripe.transfers.create).not.toHaveBeenCalled();
    expect(beginFoundationReturnEntitlementAttempt).toHaveBeenCalledTimes(1);
    expect(persistFoundationReturnEntitlementPreflightFailure).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ storeOrderId: "ord-1", lastError: "missing_charge" })
    );
  });

  it("classifies a strong no-create Stripe error as FAILED", async () => {
    seedHappyPath();
    const stripe = stripeStub();
    stripe.transfers.create.mockRejectedValue({
      type: "StripeInvalidRequestError",
      statusCode: 400,
      code: "balance_insufficient",
      message: "Insufficient available funds",
    });
    persistFoundationReturnEntitlementOutcome.mockResolvedValue(
      entitlementOp({
        status: "FAILED",
        lastError: "Insufficient available funds",
        retryCount: 1,
        stripeDestinationAccountId: "acct_live_1",
        stripeSourceChargeId: "ch_checkout_1",
      })
    );
    const result = await executeSellerReturnEntitlement(stripe as never, { storeOrderId: "ord-1" });
    expect(classifyStripeTransferFailure).toHaveBeenCalled();
    expect(result.kind).toBe("FAILED");
    expect(persistFoundationReturnEntitlementOutcome).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ storeOrderId: "ord-1", status: "FAILED" })
    );
  });

  it("classifies an ambiguous Stripe error as UNCERTAIN", async () => {
    seedHappyPath();
    classifyStripeTransferFailure.mockReturnValue("uncertain");
    const stripe = stripeStub();
    stripe.transfers.create.mockRejectedValue({
      uncertain: true,
      type: "StripeConnectionError",
      message: "timeout",
    });
    persistFoundationReturnEntitlementOutcome.mockResolvedValue(
      entitlementOp({
        status: "UNCERTAIN",
        lastError: "timeout",
        retryCount: 1,
        stripeDestinationAccountId: "acct_live_1",
        stripeSourceChargeId: "ch_checkout_1",
      })
    );
    const result = await executeSellerReturnEntitlement(stripe as never, { storeOrderId: "ord-1" });
    expect(result.kind).toBe("UNCERTAIN");
    expect(persistFoundationReturnEntitlementOutcome).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ storeOrderId: "ord-1", status: "UNCERTAIN" })
    );
  });

  it("provider success then persist failure retries the same frozen request and does not create a second economic transfer", async () => {
    seedHappyPath();
    persistFoundationReturnEntitlementSuccess
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce(
        entitlementOp({
          status: "SUCCEEDED",
          stripeTransferId: "tr_ent_1",
          retryCount: 2,
          stripeDestinationAccountId: "acct_live_1",
          stripeSourceChargeId: "ch_checkout_1",
        })
      );
    completeFoundationSellerReturnEntitlementLedger.mockResolvedValue({ ledgerCreated: true });
    const stripe = stripeStub("tr_ent_1");
    const first = await executeSellerReturnEntitlement(stripe as never, { storeOrderId: "ord-1" });
    expect(first.kind).toBe("UNCERTAIN");
    expect(stripe.transfers.create).toHaveBeenCalledTimes(1);
    expect(stripe.transfers.create.mock.calls[0][1]).toEqual({ idempotencyKey: KEY });
    expect(stripe.transfers.create.mock.calls[0][0].destination).toBe("acct_live_1");
    expect(stripe.transfers.create.mock.calls[0][0].source_transaction).toBe("ch_checkout_1");

    seedReplayPath(
      processingOp({
        lastAttemptAt: new Date("2026-01-01T00:00:00.000Z"),
        stripeDestinationAccountId: "acct_live_1",
        stripeSourceChargeId: "ch_checkout_1",
      })
    );
    mockPrisma.member.findUnique.mockResolvedValue({ stripeConnectAccountId: "acct_B" });
    stripe.paymentIntents.retrieve.mockResolvedValue({ latest_charge: "ch_B" });
    const second = await executeSellerReturnEntitlement(stripe as never, { storeOrderId: "ord-1" });
    expect(second.kind).toBe("SUCCEEDED");
    expect(stripe.transfers.create).toHaveBeenCalledTimes(2);
    expect(stripe.transfers.create.mock.calls[1][1]).toEqual({ idempotencyKey: KEY });
    expect(stripe.transfers.create.mock.calls[1][0]).toEqual(stripe.transfers.create.mock.calls[0][0]);
    expect(stripe.transfers.create.mock.calls[1][0].destination).toBe("acct_live_1");
    expect(stripe.transfers.create.mock.calls[1][0].source_transaction).toBe("ch_checkout_1");
    expect(stripe.paymentIntents.retrieve).toHaveBeenCalledTimes(1);
    expect((await stripe.transfers.create.mock.results[0].value).id).toBe("tr_ent_1");
    expect((await stripe.transfers.create.mock.results[1].value).id).toBe("tr_ent_1");
  });

  it("retryCount 0 first attempt on a row older than 23h is still allowed", async () => {
    const createdAt = new Date(Date.now() - 48 * 60 * 60 * 1000);
    seedHappyPath(entitlementOp({ createdAt, retryCount: 0, status: "PENDING" }));
    const stripe = stripeStub();
    const result = await executeSellerReturnEntitlement(stripe as never, { storeOrderId: "ord-1" });
    expect(result.kind).toBe("SUCCEEDED");
    expect(stripe.transfers.create).toHaveBeenCalledTimes(1);
    expect(stripe.transfers.create.mock.calls[0][1]).toEqual({ idempotencyKey: KEY });
  });

  it("retryCount >= 1 older than 23h is blocked with zero Stripe create", async () => {
    const aged = entitlementOp({
      status: "UNCERTAIN",
      retryCount: 2,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      stripeDestinationAccountId: FROZEN_DEST,
      stripeSourceChargeId: FROZEN_CHARGE,
    });
    mockPrisma.storeOrder.findUnique.mockResolvedValue({
      id: "ord-1",
      sellerId: "seller-1",
      stripePaymentIntentId: "pi_checkout_1",
    });
    mockPrisma.sellerReturnEntitlementOperation.findUnique.mockResolvedValue(aged);
    beginFoundationReturnEntitlementAttempt.mockResolvedValue({
      action: "operator_required",
      operation: aged,
      reason: "uncertain_replay_window_elapsed",
    });
    const stripe = stripeStub();
    const now = new Date("2026-01-03T00:00:00.000Z");
    const result = await executeSellerReturnEntitlement(stripe as never, { storeOrderId: "ord-1", now });
    expect(result.kind).toBe("REPLAY_WINDOW_EXPIRED");
    expect(stripe.transfers.create).not.toHaveBeenCalled();
  });

  it("does not manufacture an operation when no entitlement row exists", async () => {
    mockPrisma.storeOrder.findUnique.mockResolvedValue({
      id: "ord-1",
      sellerId: "seller-1",
      stripePaymentIntentId: "pi_checkout_1",
    });
    mockPrisma.sellerReturnEntitlementOperation.findUnique.mockResolvedValue(null);
    mockPrisma.member.findUnique.mockResolvedValue({ stripeConnectAccountId: "acct_live_1" });
    const stripe = stripeStub();
    const result = await executeSellerReturnEntitlement(stripe as never, { storeOrderId: "ord-1" });
    expect(result.kind).toBe("NOT_FOUND");
    expect(stripe.transfers.create).not.toHaveBeenCalled();
    expect(beginFoundationReturnEntitlementAttempt).not.toHaveBeenCalled();
  });

  it("does not require StoreReturn received or StoreOrder paid on provider execution", async () => {
    seedHappyPath();
    mockPrisma.storeOrder.findUnique.mockResolvedValue({
      id: "ord-1",
      sellerId: "seller-1",
      stripePaymentIntentId: "pi_checkout_1",
      status: "refunded",
    });
    const stripe = stripeStub();
    const result = await executeSellerReturnEntitlement(stripe as never, { storeOrderId: "ord-1" });
    expect(result.kind).toBe("SUCCEEDED");
    expect(stripe.transfers.create).toHaveBeenCalledTimes(1);
  });

  it("replay after Connect rotation uses the frozen destination, not the live account", async () => {
    seedReplayPath();
    mockPrisma.member.findUnique.mockResolvedValue({ stripeConnectAccountId: "acct_B" });
    const stripe = stripeStub("tr_ent_1");
    const result = await executeSellerReturnEntitlement(stripe as never, { storeOrderId: "ord-1" });
    expect(result.kind).toBe("SUCCEEDED");
    expect(stripe.transfers.create.mock.calls[0][0].destination).toBe(FROZEN_DEST);
    expect(stripe.transfers.create.mock.calls[0][0].destination).not.toBe("acct_B");
    expect(stripe.transfers.create.mock.calls[0][0].source_transaction).toBe(FROZEN_CHARGE);
    expect(stripe.transfers.create.mock.calls[0][1]).toEqual({ idempotencyKey: KEY });
    expect(mockPrisma.member.findUnique).not.toHaveBeenCalled();
    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
  });

  it("replay after live charge change uses the frozen source_transaction", async () => {
    seedReplayPath();
    const stripe = stripeStub("tr_ent_1");
    stripe.paymentIntents.retrieve.mockResolvedValue({ latest_charge: "ch_B" });
    await executeSellerReturnEntitlement(stripe as never, { storeOrderId: "ord-1" });
    expect(stripe.transfers.create.mock.calls[0][0].source_transaction).toBe(FROZEN_CHARGE);
    expect(stripe.transfers.create.mock.calls[0][0].source_transaction).not.toBe("ch_B");
    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
  });

  it("replay with missing live Connect still uses the frozen destination and is not FAILED", async () => {
    seedReplayPath();
    mockPrisma.member.findUnique.mockResolvedValue({ stripeConnectAccountId: null });
    const stripe = stripeStub("tr_ent_1");
    const result = await executeSellerReturnEntitlement(stripe as never, { storeOrderId: "ord-1" });
    expect(result.kind).toBe("SUCCEEDED");
    expect(stripe.transfers.create.mock.calls[0][0].destination).toBe(FROZEN_DEST);
    expect(persistFoundationReturnEntitlementPreflightFailure).not.toHaveBeenCalled();
    expect(persistFoundationReturnEntitlementOutcome).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "FAILED", lastError: "missing_connect_account" })
    );
    expect(mockPrisma.member.findUnique).not.toHaveBeenCalled();
  });

  it("replay with missing live charge still uses the frozen source_transaction and is not FAILED", async () => {
    seedReplayPath();
    const stripe = stripeStub("tr_ent_1");
    stripe.paymentIntents.retrieve.mockResolvedValue({ latest_charge: null });
    const result = await executeSellerReturnEntitlement(stripe as never, { storeOrderId: "ord-1" });
    expect(result.kind).toBe("SUCCEEDED");
    expect(stripe.transfers.create.mock.calls[0][0].source_transaction).toBe(FROZEN_CHARGE);
    expect(persistFoundationReturnEntitlementPreflightFailure).not.toHaveBeenCalled();
    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
  });

  it("attempted row missing a durable snapshot is UNCERTAIN with zero Stripe create", async () => {
    const broken = entitlementOp({
      status: "UNCERTAIN",
      retryCount: 1,
      stripeDestinationAccountId: "",
      stripeSourceChargeId: "",
      lastError: "provider_snapshot_missing_after_attempt",
    });
    mockPrisma.storeOrder.findUnique.mockResolvedValue({
      id: "ord-1",
      sellerId: "seller-1",
      stripePaymentIntentId: "pi_checkout_1",
    });
    mockPrisma.sellerReturnEntitlementOperation.findUnique.mockResolvedValue(broken);
    beginFoundationReturnEntitlementAttempt.mockResolvedValue({
      action: "operator_required",
      operation: broken,
      reason: "provider_snapshot_missing_after_attempt",
    });
    const stripe = stripeStub();
    const result = await executeSellerReturnEntitlement(stripe as never, { storeOrderId: "ord-1" });
    expect(result.kind).toBe("UNCERTAIN");
    if (result.kind !== "UNCERTAIN") return;
    expect(result.lastError).toBe("provider_snapshot_missing_after_attempt");
    expect(stripe.transfers.create).not.toHaveBeenCalled();
    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
    expect(mockPrisma.member.findUnique).not.toHaveBeenCalled();
  });

  it("Stripe create arguments come from the persisted begin operation, not live lookup variables", async () => {
    seedHappyPath();
    mockPrisma.member.findUnique.mockResolvedValue({ stripeConnectAccountId: "acct_live_1" });
    const stripe = stripeStub();
    await executeSellerReturnEntitlement(stripe as never, { storeOrderId: "ord-1" });
    const beginResult = await beginFoundationReturnEntitlementAttempt.mock.results[1].value;
    expect(beginResult.action).toBe("provider_create");
    expect(stripe.transfers.create.mock.calls[0][0].destination).toBe(
      beginResult.operation.stripeDestinationAccountId
    );
    expect(stripe.transfers.create.mock.calls[0][0].source_transaction).toBe(
      beginResult.operation.stripeSourceChargeId
    );
    expect(stripe.transfers.create.mock.calls[0][0].amount).toBe(beginResult.operation.amountCents);
    expect(stripe.transfers.create.mock.calls[0][0].currency).toBe(beginResult.operation.currency);
    expect(stripe.transfers.create.mock.calls[0][1].idempotencyKey).toBe(
      beginResult.operation.providerIdempotencyKey
    );
  });
});
