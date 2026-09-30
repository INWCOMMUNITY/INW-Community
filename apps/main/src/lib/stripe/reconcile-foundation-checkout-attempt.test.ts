import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockPrisma,
  applyFoundationCheckoutProviderObservation,
  listFoundationCheckoutReconciliationCandidates,
  foundationSucceededPayoutLocalRepairOutstanding,
} = vi.hoisted(() => ({
    mockPrisma: {
      checkoutAttempt: {
        findUnique: vi.fn(),
      },
      storeOrder: {
        findMany: vi.fn(async () => []),
      },
      transferOperation: {
        findMany: vi.fn(async () => []),
      },
    },
    applyFoundationCheckoutProviderObservation: vi.fn(),
    listFoundationCheckoutReconciliationCandidates: vi.fn(),
    foundationSucceededPayoutLocalRepairOutstanding: vi.fn(async () => false),
  }));

vi.mock("database", () => ({
  applyFoundationCheckoutProviderObservation,
  foundationCheckoutReconciliationCronAllowed: (mode: string | null | undefined) =>
    mode === "FOUNDATION" || mode === "UNFROZEN",
  listFoundationCheckoutReconciliationCandidates,
  isFoundationBuyerSaleCompleteStatus: (status: string) =>
    status === "paid" || status === "shipped" || status === "delivered",
  foundationSucceededPayoutLocalRepairOutstanding,
}));

vi.mock("@/lib/stripe/fulfill-storefront-orders", () => ({
  fulfillStoreOrdersFromCheckoutSession: vi.fn(async () => ({ orderIds: [] })),
}));

import {
  checkoutReconciliationHttpContract,
  classifyStripeCheckoutRetrieveFailure,
  observationFromStripeCheckoutSession,
  reconcileFoundationCheckoutAttempt,
  reconcileFoundationCheckoutBatch,
} from "./reconcile-foundation-checkout-attempt";
import { fulfillStoreOrdersFromCheckoutSession } from "./fulfill-storefront-orders";

function attemptRow(overrides?: Record<string, unknown>) {
  return {
    id: "att_1",
    state: "SESSION_OPEN",
    paymentStatus: "UNPAID",
    stripeCheckoutSessionId: "cs_1",
    stripePaymentIntentId: null,
    ...overrides,
  };
}

function applied(classification: string, extras?: Record<string, unknown>) {
  return {
    classification,
    attemptId: "att_1",
    state: "SESSION_OPEN",
    paymentStatus: "UNPAID",
    stripeCheckoutSessionId: "cs_1",
    checkoutUrl: null,
    retryable: false,
    ...extras,
  };
}

describe("reconcileFoundationCheckoutAttempt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.checkoutAttempt.findUnique.mockResolvedValue(attemptRow());
  });

  it("retrieves an active Session outside the DB apply call and does not create", async () => {
    const retrieve = vi.fn(async () => ({
      id: "cs_1",
      status: "open",
      payment_status: "unpaid",
      url: "https://checkout.stripe.test/cs_1",
      payment_intent: null,
    }));
    applyFoundationCheckoutProviderObservation.mockResolvedValue(
      applied("ACTIVE", { checkoutUrl: "https://checkout.stripe.test/cs_1" })
    );
    const create = vi.fn();
    const result = await reconcileFoundationCheckoutAttempt({
      prisma: mockPrisma as never,
      stripe: { checkout: { sessions: { retrieve, create } } } as never,
      attemptId: "att_1",
    });
    expect(retrieve).toHaveBeenCalledWith("cs_1");
    expect(create).not.toHaveBeenCalled();
    expect(applyFoundationCheckoutProviderObservation).toHaveBeenCalledWith(
      mockPrisma,
      "att_1",
      expect.objectContaining({ kind: "session", stripeStatus: "open" })
    );
    expect(result.classification).toBe("ACTIVE");
    expect(result.checkoutUrl).toBe("https://checkout.stripe.test/cs_1");
  });

  it("complete+paid invokes fulfillment and never creates a second Session", async () => {
    const retrieve = vi.fn(async () => ({
      id: "cs_1",
      status: "complete",
      payment_status: "paid",
      url: null,
      payment_intent: "pi_1",
    }));
    applyFoundationCheckoutProviderObservation.mockResolvedValue(applied("PAID_NEEDS_FULFILLMENT", { paymentStatus: "PAID" }));
    mockPrisma.checkoutAttempt.findUnique
      .mockResolvedValueOnce(attemptRow())
      .mockResolvedValueOnce(attemptRow({ state: "PAID", paymentStatus: "PAID" }));
    const result = await reconcileFoundationCheckoutAttempt({
      prisma: mockPrisma as never,
      stripe: { checkout: { sessions: { retrieve, create: vi.fn() } } } as never,
      attemptId: "att_1",
    });
    expect(fulfillStoreOrdersFromCheckoutSession).toHaveBeenCalledTimes(1);
    expect(result.classification).toBe("PAID_FINALIZED");
  });

  it("keeps PI-only paid sales in fulfillment while TransferOperation is incomplete", async () => {
    const retrieve = vi.fn(async () => ({
      id: "cs_1",
      status: "complete",
      payment_status: "paid",
      url: null,
      payment_intent: "pi_1",
    }));
    applyFoundationCheckoutProviderObservation.mockResolvedValue(
      applied("PAID_NEEDS_FULFILLMENT", { paymentStatus: "PAID" })
    );
    mockPrisma.checkoutAttempt.findUnique
      .mockResolvedValueOnce(attemptRow())
      .mockResolvedValueOnce(attemptRow({ state: "PAID", paymentStatus: "PAID" }));
    mockPrisma.storeOrder.findMany.mockResolvedValue([{ status: "paid", commerceStatus: "FINALIZED" }]);
    mockPrisma.transferOperation.findMany.mockResolvedValue([{ status: "PENDING" }]);
    const result = await reconcileFoundationCheckoutAttempt({
      prisma: mockPrisma as never,
      stripe: { checkout: { sessions: { retrieve, create: vi.fn() } } } as never,
      attemptId: "att_1",
    });
    expect(fulfillStoreOrdersFromCheckoutSession).toHaveBeenCalledTimes(1);
    expect(result.classification).toBe("PAID_NEEDS_FULFILLMENT");
    expect(result.retryable).toBe(true);
  });

  it("keeps shipped and delivered FINALIZED sales in payout fulfillment while TransferOperation is incomplete", async () => {
    const retrieve = vi.fn(async () => ({
      id: "cs_1",
      status: "complete",
      payment_status: "paid",
      url: null,
      payment_intent: "pi_1",
    }));
    applyFoundationCheckoutProviderObservation.mockResolvedValue(
      applied("PAID_NEEDS_FULFILLMENT", { paymentStatus: "PAID" })
    );
    mockPrisma.checkoutAttempt.findUnique
      .mockResolvedValueOnce(attemptRow())
      .mockResolvedValueOnce(attemptRow({ state: "PAID", paymentStatus: "PAID" }));
    mockPrisma.storeOrder.findMany.mockResolvedValue([{ status: "shipped", commerceStatus: "FINALIZED" }]);
    mockPrisma.transferOperation.findMany.mockResolvedValue([{ status: "FAILED" }]);
    const result = await reconcileFoundationCheckoutAttempt({
      prisma: mockPrisma as never,
      stripe: { checkout: { sessions: { retrieve, create: vi.fn() } } } as never,
      attemptId: "att_1",
    });
    expect(result.classification).toBe("PAID_NEEDS_FULFILLMENT");
    expect(result.retryable).toBe(true);
  });

  it("invokes local payout repair for SUCCEEDED TransferOperation without a second provider retrieve create", async () => {
    const retrieve = vi.fn(async () => ({
      id: "cs_1",
      status: "complete",
      payment_status: "paid",
      url: null,
      payment_intent: "pi_1",
    }));
    applyFoundationCheckoutProviderObservation.mockResolvedValue(
      applied("PAID_NEEDS_FULFILLMENT", { paymentStatus: "PAID" })
    );
    mockPrisma.checkoutAttempt.findUnique
      .mockResolvedValueOnce(attemptRow())
      .mockResolvedValueOnce(attemptRow({ state: "PAID", paymentStatus: "PAID" }));
    mockPrisma.storeOrder.findMany.mockResolvedValue([{ status: "paid", commerceStatus: "FINALIZED" }]);
    mockPrisma.transferOperation.findMany.mockResolvedValue([{ status: "SUCCEEDED" }]);
    foundationSucceededPayoutLocalRepairOutstanding.mockResolvedValueOnce(true);
    const result = await reconcileFoundationCheckoutAttempt({
      prisma: mockPrisma as never,
      stripe: { checkout: { sessions: { retrieve, create: vi.fn() } } } as never,
      attemptId: "att_1",
    });
    expect(fulfillStoreOrdersFromCheckoutSession).toHaveBeenCalledTimes(1);
    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(result.classification).toBe("PAID_NEEDS_FULFILLMENT");
    expect(result.retryable).toBe(true);
  });

  it("PAID_NOT_CONVERTIBLE does not invoke fulfillment", async () => {
    const retrieve = vi.fn(async () => ({
      id: "cs_1",
      status: "complete",
      payment_status: "paid",
      url: null,
      payment_intent: "pi_1",
    }));
    applyFoundationCheckoutProviderObservation.mockResolvedValue(
      applied("PAID_NOT_CONVERTIBLE", { paymentStatus: "PAID", retryable: false })
    );
    const result = await reconcileFoundationCheckoutAttempt({
      prisma: mockPrisma as never,
      stripe: { checkout: { sessions: { retrieve, create: vi.fn() } } } as never,
      attemptId: "att_1",
    });
    expect(fulfillStoreOrdersFromCheckoutSession).not.toHaveBeenCalled();
    expect(result.classification).toBe("PAID_NOT_CONVERTIBLE");
  });

  it("SESSION_UNKNOWN without Session id does not retrieve or create", async () => {
    mockPrisma.checkoutAttempt.findUnique.mockResolvedValue(
      attemptRow({ state: "SESSION_UNKNOWN", stripeCheckoutSessionId: null })
    );
    applyFoundationCheckoutProviderObservation.mockResolvedValue(
      applied("NEEDS_OPERATOR", { stripeCheckoutSessionId: null, retryable: false })
    );
    const retrieve = vi.fn();
    const create = vi.fn();
    const result = await reconcileFoundationCheckoutAttempt({
      prisma: mockPrisma as never,
      stripe: { checkout: { sessions: { retrieve, create } } } as never,
      attemptId: "att_1",
    });
    expect(retrieve).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(applyFoundationCheckoutProviderObservation).toHaveBeenCalledWith(mockPrisma, "att_1", {
      kind: "missing_session_id",
    });
    expect(result.classification).toBe("NEEDS_OPERATOR");
  });

  it("transient retrieve errors leave state untouched", async () => {
    const retrieve = vi.fn(async () => {
      const err = new Error("timeout");
      (err as { type?: string }).type = "StripeConnectionError";
      throw err;
    });
    const result = await reconcileFoundationCheckoutAttempt({
      prisma: mockPrisma as never,
      stripe: { checkout: { sessions: { retrieve, create: vi.fn() } } } as never,
      attemptId: "att_1",
    });
    expect(applyFoundationCheckoutProviderObservation).not.toHaveBeenCalled();
    expect(result.classification).toBe("UNKNOWN_PROVIDER_OUTCOME");
    expect(result.retryable).toBe(true);
    expect(result.retrieveFailure).toBe("transient");
  });

  it("definitive not-found does not create and asks for operator reconciliation", async () => {
    const retrieve = vi.fn(async () => {
      const err = new Error("No such checkout.session: cs_1");
      (err as { type?: string; statusCode?: number; code?: string }).type = "StripeInvalidRequestError";
      (err as { statusCode?: number }).statusCode = 404;
      (err as { code?: string }).code = "resource_missing";
      throw err;
    });
    applyFoundationCheckoutProviderObservation.mockResolvedValue(applied("NEEDS_OPERATOR", { retryable: false }));
    const create = vi.fn();
    const result = await reconcileFoundationCheckoutAttempt({
      prisma: mockPrisma as never,
      stripe: { checkout: { sessions: { retrieve, create } } } as never,
      attemptId: "att_1",
    });
    expect(create).not.toHaveBeenCalled();
    expect(applyFoundationCheckoutProviderObservation).toHaveBeenCalledWith(mockPrisma, "att_1", {
      kind: "provider_not_found",
      stripeCheckoutSessionId: "cs_1",
    });
    expect(result.classification).toBe("NEEDS_OPERATOR");
  });
});

describe("classifyStripeCheckoutRetrieveFailure", () => {
  it("classifies timeout/5xx as transient and 404 as not_found", () => {
    expect(classifyStripeCheckoutRetrieveFailure({ type: "StripeConnectionError" })).toBe("transient");
    expect(classifyStripeCheckoutRetrieveFailure({ type: "StripeAPIError", statusCode: 500 })).toBe("transient");
    expect(classifyStripeCheckoutRetrieveFailure({ code: "resource_missing", statusCode: 404 })).toBe("not_found");
  });
});

describe("checkoutReconciliationHttpContract", () => {
  it("returns 409 retryable for expired Sessions and unresolved no-id as non-retryable", () => {
    expect(
      checkoutReconciliationHttpContract(applied("EXPIRED_RELEASED", { retryable: true }) as never).body.error
    ).toBe("checkout_session_expired");
    expect(checkoutReconciliationHttpContract(applied("EXPIRED_RELEASED") as never).status).toBe(409);
    const unresolved = checkoutReconciliationHttpContract(applied("NEEDS_OPERATOR", { retryable: false }) as never);
    expect(unresolved.status).toBe(409);
    expect(unresolved.body.retryable).toBe(false);
    expect(unresolved.body.error).toBe("checkout_session_unresolved");
  });
});

describe("reconcileFoundationCheckoutBatch", () => {
  it("no-ops in LEGACY and does not inspect attempts", async () => {
    const retrieve = vi.fn();
    const batch = await reconcileFoundationCheckoutBatch({
      prisma: mockPrisma as never,
      stripe: { checkout: { sessions: { retrieve } } } as never,
      mode: "LEGACY",
    });
    expect(batch.skipped).toBe("mode_LEGACY");
    expect(batch.inspected).toBe(0);
    expect(listFoundationCheckoutReconciliationCandidates).not.toHaveBeenCalled();
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("inspects a bounded candidate list independently", async () => {
    listFoundationCheckoutReconciliationCandidates.mockResolvedValue([
      { id: "a", state: "SESSION_OPEN", stripeCheckoutSessionId: "cs_a" },
      { id: "b", state: "SESSION_UNKNOWN", stripeCheckoutSessionId: "cs_b" },
      { id: "c", state: "SESSION_UNKNOWN", stripeCheckoutSessionId: null },
    ]);
    mockPrisma.checkoutAttempt.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
      if (where.id === "c") return attemptRow({ id: "c", state: "SESSION_UNKNOWN", stripeCheckoutSessionId: null });
      return attemptRow({ id: where.id, stripeCheckoutSessionId: `cs_${where.id}` });
    });
    applyFoundationCheckoutProviderObservation.mockImplementation(async (_db, attemptId, observation) => {
      if (observation.kind === "missing_session_id") {
        return applied("NEEDS_OPERATOR", { attemptId, retryable: false });
      }
      if (observation.stripeStatus === "expired") {
        return applied("EXPIRED_RELEASED", { attemptId, retryable: true });
      }
      return applied("ACTIVE", { attemptId, checkoutUrl: "https://checkout.stripe.test/open" });
    });
    const retrieve = vi.fn(async (id: string) => {
      if (id === "cs_b") return { id, status: "expired", payment_status: "unpaid", url: null, payment_intent: null };
      return { id, status: "open", payment_status: "unpaid", url: `https://checkout.stripe.test/${id}`, payment_intent: null };
    });
    const batch = await reconcileFoundationCheckoutBatch({
      prisma: mockPrisma as never,
      stripe: { checkout: { sessions: { retrieve, create: vi.fn() } } } as never,
      mode: "FOUNDATION",
    });
    expect(batch.skipped).toBeNull();
    expect(batch.inspected).toBe(3);
    expect(batch.results.map((row) => row.classification)).toEqual(["ACTIVE", "EXPIRED_RELEASED", "NEEDS_OPERATOR"]);
  });
});

describe("observationFromStripeCheckoutSession", () => {
  it("does not treat complete+unpaid as paid", () => {
    const observation = observationFromStripeCheckoutSession({
      id: "cs_1",
      status: "complete",
      payment_status: "unpaid",
      url: "https://stale.example/cs_1",
      payment_intent: "pi_1",
    } as never);
    expect(observation.kind).toBe("session");
    if (observation.kind === "session") {
      expect(observation.paymentStatus).toBe("unpaid");
      expect(observation.stripeStatus).toBe("complete");
    }
  });
});
