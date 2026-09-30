import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const StripeCtor = vi.hoisted(() => vi.fn());

const {
  Prisma,
  getCommerceFoundationCutoverState,
  foundationCheckoutReconciliationCronAllowed,
  CommerceFoundationCutoverStateError,
  tryAcquireCronLock,
  releaseCronLock,
  reconcileFoundationReturnSettlementBatch,
} = vi.hoisted(() => {
  class PrismaClientKnownRequestError extends Error {
    code: string;
    meta?: Record<string, unknown>;
    clientVersion: string;
    constructor(message: string, opts: { code: string; clientVersion?: string; meta?: Record<string, unknown> }) {
      super(message);
      this.name = "PrismaClientKnownRequestError";
      this.code = opts.code;
      this.clientVersion = opts.clientVersion ?? "test";
      this.meta = opts.meta;
    }
  }
  class CommerceFoundationCutoverStateError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "CommerceFoundationCutoverStateError";
    }
  }
  return {
    Prisma: { PrismaClientKnownRequestError },
    getCommerceFoundationCutoverState: vi.fn(),
    foundationCheckoutReconciliationCronAllowed: vi.fn(
      (mode: string) => mode === "FOUNDATION" || mode === "UNFROZEN"
    ),
    CommerceFoundationCutoverStateError,
    tryAcquireCronLock: vi.fn(),
    releaseCronLock: vi.fn(),
    reconcileFoundationReturnSettlementBatch: vi.fn(),
  };
});

vi.mock("database", () => ({
  prisma: {},
  Prisma,
  getCommerceFoundationCutoverState,
  foundationCheckoutReconciliationCronAllowed,
  CommerceFoundationCutoverStateError,
}));

vi.mock("@/lib/cron-job-lock", () => ({
  tryAcquireCronLock,
  releaseCronLock,
}));

vi.mock("@/lib/stripe/reconcile-foundation-return-settlements", () => ({
  reconcileFoundationReturnSettlementBatch,
}));

vi.mock("stripe", () => ({
  default: StripeCtor,
}));

import { GET, POST } from "./route";

function authedReq(method: string) {
  return new NextRequest("http://localhost/api/cron/reconcile-foundation-return-settlements", {
    method,
    headers: { authorization: "Bearer test-cron" },
  });
}

function unauthedReq(method: string) {
  return new NextRequest("http://localhost/api/cron/reconcile-foundation-return-settlements", { method });
}

function p2021(table: string) {
  return new Prisma.PrismaClientKnownRequestError(
    `The table \`${table}\` does not exist in the current database.`,
    { code: "P2021", clientVersion: "5.22.0", meta: { table } }
  );
}

const settledSummary = {
  skipped: null,
  scanned: 2,
  settled: 1,
  alreadyComplete: 0,
  notReceived: 0,
  invalidAmount: 0,
  unauthorizedSeller: 0,
  sellerPending: 0,
  sellerFailed: 0,
  buyerPending: 0,
  buyerFailed: 1,
  errors: 0,
};

describe("/api/cron/reconcile-foundation-return-settlements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "test-cron";
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    foundationCheckoutReconciliationCronAllowed.mockImplementation(
      (mode: string) => mode === "FOUNDATION" || mode === "UNFROZEN"
    );
  });

  it("rejects unauthorized GET without querying cutover, Stripe, or settlement", async () => {
    const res = await GET(unauthedReq("GET"));
    expect(res.status).toBe(401);
    expect(getCommerceFoundationCutoverState).not.toHaveBeenCalled();
    expect(StripeCtor).not.toHaveBeenCalled();
    expect(tryAcquireCronLock).not.toHaveBeenCalled();
    expect(reconcileFoundationReturnSettlementBatch).not.toHaveBeenCalled();
  });

  it("rejects unauthorized POST without querying cutover, Stripe, or settlement", async () => {
    const res = await POST(unauthedReq("POST"));
    expect(res.status).toBe(401);
    expect(getCommerceFoundationCutoverState).not.toHaveBeenCalled();
    expect(StripeCtor).not.toHaveBeenCalled();
    expect(reconcileFoundationReturnSettlementBatch).not.toHaveBeenCalled();
  });

  it("skips safely when the cron lock is already held", async () => {
    getCommerceFoundationCutoverState.mockResolvedValue({ mode: "FOUNDATION" });
    tryAcquireCronLock.mockResolvedValue({ acquired: false });
    const res = await GET(authedReq("GET"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, skipped: "lease_held", scanned: 0, errors: 0 });
    expect(reconcileFoundationReturnSettlementBatch).not.toHaveBeenCalled();
    expect(tryAcquireCronLock).toHaveBeenCalledWith("reconcile-foundation-return-settlements", 80_000);
  });

  it("no-ops in LEGACY", async () => {
    getCommerceFoundationCutoverState.mockResolvedValue({ mode: "LEGACY" });
    const res = await GET(authedReq("GET"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, skipped: "mode_LEGACY", scanned: 0 });
    expect(tryAcquireCronLock).not.toHaveBeenCalled();
    expect(StripeCtor).not.toHaveBeenCalled();
    expect(reconcileFoundationReturnSettlementBatch).not.toHaveBeenCalled();
  });

  it("no-ops in FROZEN", async () => {
    getCommerceFoundationCutoverState.mockResolvedValue({ mode: "FROZEN" });
    const res = await GET(authedReq("GET"));
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, skipped: "mode_FROZEN", scanned: 0 });
    expect(reconcileFoundationReturnSettlementBatch).not.toHaveBeenCalled();
  });

  it("no-ops in BACKFILLING", async () => {
    getCommerceFoundationCutoverState.mockResolvedValue({ mode: "BACKFILLING" });
    const res = await GET(authedReq("GET"));
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, skipped: "mode_BACKFILLING", scanned: 0 });
    expect(reconcileFoundationReturnSettlementBatch).not.toHaveBeenCalled();
  });

  it("calls the service in FOUNDATION", async () => {
    getCommerceFoundationCutoverState.mockResolvedValue({ mode: "FOUNDATION" });
    tryAcquireCronLock.mockResolvedValue({ acquired: true, holderId: "h1" });
    reconcileFoundationReturnSettlementBatch.mockResolvedValue(settledSummary);
    const res = await GET(authedReq("GET"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, mode: "FOUNDATION", ...settledSummary });
    expect(StripeCtor).toHaveBeenCalled();
    expect(reconcileFoundationReturnSettlementBatch).toHaveBeenCalledTimes(1);
    expect(releaseCronLock).toHaveBeenCalled();
  });

  it("calls the service in UNFROZEN when the writer route is Foundation", async () => {
    getCommerceFoundationCutoverState.mockResolvedValue({ mode: "UNFROZEN" });
    tryAcquireCronLock.mockResolvedValue({ acquired: true, holderId: "h1" });
    reconcileFoundationReturnSettlementBatch.mockResolvedValue(settledSummary);
    const res = await POST(authedReq("POST"));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.mode).toBe("UNFROZEN");
    expect(reconcileFoundationReturnSettlementBatch).toHaveBeenCalledTimes(1);
  });

  it("no-ops on unknown cutover mode", async () => {
    getCommerceFoundationCutoverState.mockResolvedValue({ mode: "WEIRD" });
    const res = await GET(authedReq("GET"));
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, skipped: "mode_WEIRD", scanned: 0 });
    expect(reconcileFoundationReturnSettlementBatch).not.toHaveBeenCalled();
  });

  it("no-ops when the cutover singleton row is missing", async () => {
    getCommerceFoundationCutoverState.mockRejectedValue(
      new CommerceFoundationCutoverStateError("missing")
    );
    const res = await GET(authedReq("GET"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, skipped: "cutover_unavailable", scanned: 0 });
    expect(StripeCtor).not.toHaveBeenCalled();
    expect(reconcileFoundationReturnSettlementBatch).not.toHaveBeenCalled();
  });

  it("no-ops when the cutover table is missing (P2021)", async () => {
    getCommerceFoundationCutoverState.mockRejectedValue(p2021("commerce_foundation_cutover"));
    const res = await GET(authedReq("GET"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.skipped).toBe("cutover_unavailable");
    expect(StripeCtor).not.toHaveBeenCalled();
    expect(tryAcquireCronLock).not.toHaveBeenCalled();
    expect(reconcileFoundationReturnSettlementBatch).not.toHaveBeenCalled();
  });

  it("fails safely when Stripe is not configured", async () => {
    getCommerceFoundationCutoverState.mockResolvedValue({ mode: "FOUNDATION" });
    process.env.STRIPE_SECRET_KEY = "pk_live_nope";
    const res = await GET(authedReq("GET"));
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body).toEqual({ error: "Stripe is not configured" });
    expect(tryAcquireCronLock).not.toHaveBeenCalled();
    expect(reconcileFoundationReturnSettlementBatch).not.toHaveBeenCalled();
  });

  it("returns the service summary", async () => {
    getCommerceFoundationCutoverState.mockResolvedValue({ mode: "FOUNDATION" });
    tryAcquireCronLock.mockResolvedValue({ acquired: true, holderId: "h1" });
    reconcileFoundationReturnSettlementBatch.mockResolvedValue(settledSummary);
    const res = await GET(authedReq("GET"));
    const body = await res.json();
    expect(body.scanned).toBe(2);
    expect(body.settled).toBe(1);
    expect(body.buyerFailed).toBe(1);
    expect(body.errors).toBe(0);
  });

  it("fail-safes when the service throws unexpectedly", async () => {
    getCommerceFoundationCutoverState.mockResolvedValue({ mode: "FOUNDATION" });
    tryAcquireCronLock.mockResolvedValue({ acquired: true, holderId: "h1" });
    reconcileFoundationReturnSettlementBatch.mockRejectedValue(new Error("unexpected"));
    const res = await GET(authedReq("GET"));
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body).toEqual({ error: "Reconcile failed" });
    expect(releaseCronLock).toHaveBeenCalled();
  });
});
