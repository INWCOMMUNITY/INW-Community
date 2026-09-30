/**
 * Prompt 123: real PostgreSQL proof that courtesy-refund local convergence
 * does not leave a stale `requested` row when racing buyer request-refund.
 *
 * Excluded from packages/database tsc (imports app helpers). Vitest runs it
 * against disposable Foundation Postgres via run-foundation-int.mjs.
 */
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBuyerRequestedStoreReturn } from "../../../../apps/main/src/lib/store-return-request";
import { convergeCourtesyRefundStoreReturn } from "../../../../apps/main/src/lib/store-return-courtesy-converge";
import { ACTIVE_STORE_RETURN_STATUSES } from "../../../../apps/main/src/lib/store-return";
import { createMember, createOrder } from "./fixtures";
import { foundationTestDatabaseUrl } from "./local-url";

let prisma: PrismaClient;

beforeAll(() => {
  const url = foundationTestDatabaseUrl();
  prisma = new PrismaClient({
    datasources: { db: { url } },
    log: ["error"],
  });
});

afterAll(async () => {
  await prisma?.$disconnect();
});

async function eligibleOrder() {
  const buyer = await createMember(prisma, "p123-buyer");
  const seller = await createMember(prisma, "p123-seller");
  const order = await createOrder(prisma, { buyerId: buyer.id, sellerId: seller.id });
  await prisma.storeOrder.update({
    where: { id: order.id },
    data: {
      status: "shipped",
      stripePaymentIntentId: `pi_${order.id}`,
    },
  });
  return { buyer, seller, order };
}

async function counts(orderId: string) {
  const all = await prisma.storeReturn.count({ where: { orderId } });
  const active = await prisma.storeReturn.count({
    where: { orderId, status: { in: [...ACTIVE_STORE_RETURN_STATUSES] } },
  });
  const refunded = await prisma.storeReturn.count({
    where: { orderId, status: "refunded" },
  });
  const requested = await prisma.storeReturn.count({
    where: { orderId, status: "requested" },
  });
  return { all, active, refunded, requested };
}

describe("Prompt 123: courtesy refund × buyer request (real PostgreSQL)", () => {
  it("forward race: buyer creates requested, then converge updates it (no second row)", async () => {
    const { buyer, order } = await eligibleOrder();

    // Simulate stale pre-provider snapshot: no return yet.
    const hintStoreReturnId = null;

    const buyerResult = await createBuyerRequestedStoreReturn(prisma, {
      orderId: order.id,
      buyerId: buyer.id,
      reason: "Changed my mind",
    });
    expect(buyerResult.ok).toBe(true);

    // Provider refund considered complete; local convergence only.
    await prisma.storeOrder.update({
      where: { id: order.id },
      data: { status: "refunded" },
    });

    const converge = await convergeCourtesyRefundStoreReturn(prisma, {
      storeOrderId: order.id,
      amountCents: 1000,
      hintStoreReturnId,
      reason: "Courtesy refund",
    });
    expect(converge.ok).toBe(true);
    if (!converge.ok) return;
    expect(converge.action).toBe("updated");
    expect(converge.storeReturn.status).toBe("refunded");

    const c = await counts(order.id);
    expect(c.all).toBe(1);
    expect(c.active).toBe(0);
    expect(c.refunded).toBe(1);
    expect(c.requested).toBe(0);
  });

  it("reverse race: converge first, then buyer request creates nothing", async () => {
    const { buyer, order } = await eligibleOrder();

    await prisma.storeOrder.update({
      where: { id: order.id },
      data: { status: "refunded" },
    });

    const converge = await convergeCourtesyRefundStoreReturn(prisma, {
      storeOrderId: order.id,
      amountCents: 1000,
      reason: "Courtesy refund",
    });
    expect(converge.ok).toBe(true);
    if (!converge.ok) return;
    expect(converge.action).toBe("created");

    const buyerResult = await createBuyerRequestedStoreReturn(prisma, {
      orderId: order.id,
      buyerId: buyer.id,
      reason: "Changed my mind",
    });
    expect(buyerResult.ok).toBe(false);
    if (buyerResult.ok) return;
    expect(buyerResult.error).toBe("already_refunded");

    const c = await counts(order.id);
    expect(c.active).toBe(0);
    expect(c.refunded).toBe(1);
    expect(c.requested).toBe(0);
  });

  it("existing requested → same row becomes refunded; no new row", async () => {
    const { buyer, order } = await eligibleOrder();
    const created = await createBuyerRequestedStoreReturn(prisma, {
      orderId: order.id,
      buyerId: buyer.id,
      reason: "Changed my mind",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const converge = await convergeCourtesyRefundStoreReturn(prisma, {
      storeOrderId: order.id,
      amountCents: 800,
      hintStoreReturnId: created.storeReturn.id,
    });
    expect(converge.ok).toBe(true);
    if (!converge.ok) return;
    expect(converge.action).toBe("updated");
    expect(converge.storeReturn.id).toBe(created.storeReturn.id);

    const c = await counts(order.id);
    expect(c.all).toBe(1);
    expect(c.active).toBe(0);
    expect(c.refunded).toBe(1);
  });

  it("idempotent replay does not create another terminal row", async () => {
    const { order } = await eligibleOrder();
    const first = await convergeCourtesyRefundStoreReturn(prisma, {
      storeOrderId: order.id,
      amountCents: 1000,
    });
    expect(first.ok).toBe(true);
    const second = await convergeCourtesyRefundStoreReturn(prisma, {
      storeOrderId: order.id,
      amountCents: 1000,
    });
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.action).toBe("already_refunded");
    expect(second.storeReturn.id).toBe(first.storeReturn.id);
    expect(await prisma.storeReturn.count({ where: { orderId: order.id } })).toBe(1);
  });

  it("malformed multiple active → fail closed with zero mutations", async () => {
    const { order } = await eligibleOrder();
    const ts = new Date("2026-08-01T00:00:00.000Z");
    await prisma.storeReturn.create({
      data: {
        id: "p123_act_a",
        orderId: order.id,
        status: "requested",
        createdAt: ts,
        requestedAt: ts,
      },
    });
    await prisma.storeReturn.create({
      data: {
        id: "p123_act_b",
        orderId: order.id,
        status: "awaiting_return",
        createdAt: ts,
        requestedAt: ts,
      },
    });

    const before = await prisma.storeReturn.findMany({ where: { orderId: order.id } });
    const result = await convergeCourtesyRefundStoreReturn(prisma, {
      storeOrderId: order.id,
      amountCents: 1000,
    });
    expect(result).toEqual({ ok: false, error: "multiple_active" });

    const after = await prisma.storeReturn.findMany({ where: { orderId: order.id } });
    expect(after).toHaveLength(2);
    expect(after.map((r) => r.status).sort()).toEqual(["awaiting_return", "requested"]);
    expect(before.map((r) => `${r.id}:${r.status}`).sort()).toEqual(
      after.map((r) => `${r.id}:${r.status}`).sort()
    );
  });
});
