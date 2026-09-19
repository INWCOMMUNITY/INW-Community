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
  reconcileFoundationCheckoutBatch,
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
    foundationCheckoutReconciliationCronAllowed: vi.fn((mode: string) => mode === "FOUNDATION" || mode === "UNFROZEN"),
    CommerceFoundationCutoverStateError,
    tryAcquireCronLock: vi.fn(),
    releaseCronLock: vi.fn(),
    reconcileFoundationCheckoutBatch: vi.fn(),
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

vi.mock("@/lib/stripe/reconcile-foundation-checkout-attempt", () => ({
  reconcileFoundationCheckoutBatch,
}));

vi.mock("stripe", () => ({
  default: StripeCtor,
}));

import { GET, POST } from "./route";

function authedReq(method: string) {
  return new NextRequest("http://localhost/api/cron/reconcile-foundation-checkouts", {
    method,
    headers: { authorization: "Bearer test-cron" },
  });
}

function unauthedReq(method: string) {
  return new NextRequest("http://localhost/api/cron/reconcile-foundation-checkouts", { method });
}

function p2021(table: string) {
  return new Prisma.PrismaClientKnownRequestError(
    `The table \`${table}\` does not exist in the current database.`,
    { code: "P2021", clientVersion: "5.22.0", meta: { table } }
  );
}

describe("/api/cron/reconcile-foundation-checkouts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "test-cron";
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
  });

  it("rejects unauthorized GET", async () => {
    const res = await GET(unauthedReq("GET"));
    expect(res.status).toBe(401);
    expect(getCommerceFoundationCutoverState).not.toHaveBeenCalled();
    expect(StripeCtor).not.toHaveBeenCalled();
    expect(reconcileFoundationCheckoutBatch).not.toHaveBeenCalled();
  });

  it("rejects unauthorized POST", async () => {
    const res = await POST(unauthedReq("POST"));
    expect(res.status).toBe(401);
    expect(getCommerceFoundationCutoverState).not.toHaveBeenCalled();
    expect(StripeCtor).not.toHaveBeenCalled();
    expect(reconcileFoundationCheckoutBatch).not.toHaveBeenCalled();
  });

  it("no-ops when the cutover singleton row is missing", async () => {
    getCommerceFoundationCutoverState.mockRejectedValue(
      new CommerceFoundationCutoverStateError("missing")
    );
    const res = await GET(authedReq("GET"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, skipped: "cutover_unavailable", inspected: 0 });
    expect(StripeCtor).not.toHaveBeenCalled();
    expect(reconcileFoundationCheckoutBatch).not.toHaveBeenCalled();
  });

  it("no-ops when the cutover table is missing (P2021)", async () => {
    getCommerceFoundationCutoverState.mockRejectedValue(p2021("commerce_foundation_cutover"));
    const res = await GET(authedReq("GET"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, skipped: "cutover_unavailable", inspected: 0, results: [] });
    expect(StripeCtor).not.toHaveBeenCalled();
    expect(reconcileFoundationCheckoutBatch).not.toHaveBeenCalled();
    expect(tryAcquireCronLock).not.toHaveBeenCalled();
  });

  it("does not treat P2021 for another table as cutover_unavailable", async () => {
    getCommerceFoundationCutoverState.mockRejectedValue(p2021("checkout_attempt"));
    await expect(GET(authedReq("GET"))).rejects.toMatchObject({ code: "P2021" });
    expect(reconcileFoundationCheckoutBatch).not.toHaveBeenCalled();
    expect(StripeCtor).not.toHaveBeenCalled();
  });

  it("does not swallow a generic database error as success", async () => {
    getCommerceFoundationCutoverState.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(GET(authedReq("GET"))).rejects.toThrow("ECONNREFUSED");
    expect(reconcileFoundationCheckoutBatch).not.toHaveBeenCalled();
    expect(StripeCtor).not.toHaveBeenCalled();
  });

  it("no-ops in LEGACY without reconciling", async () => {
    getCommerceFoundationCutoverState.mockResolvedValue({ mode: "LEGACY" });
    const res = await GET(authedReq("GET"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, skipped: "mode_LEGACY", inspected: 0 });
    expect(tryAcquireCronLock).not.toHaveBeenCalled();
    expect(StripeCtor).not.toHaveBeenCalled();
    expect(reconcileFoundationCheckoutBatch).not.toHaveBeenCalled();
  });

  it("runs a bounded batch in FOUNDATION", async () => {
    getCommerceFoundationCutoverState.mockResolvedValue({ mode: "FOUNDATION" });
    tryAcquireCronLock.mockResolvedValue({ acquired: true, holderId: "h1" });
    reconcileFoundationCheckoutBatch.mockResolvedValue({
      skipped: null,
      inspected: 2,
      results: [
        { attemptId: "a", classification: "ACTIVE" },
        { attemptId: "b", classification: "EXPIRED_RELEASED" },
      ],
    });
    const res = await GET(authedReq("GET"));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.inspected).toBe(2);
    expect(StripeCtor).toHaveBeenCalled();
    expect(reconcileFoundationCheckoutBatch).toHaveBeenCalledTimes(1);
    expect(releaseCronLock).toHaveBeenCalled();
  });
});
