/**
 * Unit 5E: real PostgreSQL proof that concurrent buyer request-refund
 * creates at most one active StoreReturn (StoreOrder FOR UPDATE).
 *
 * Excluded from packages/database tsc (imports app helper). Vitest compiles
 * via foundation alias against disposable Foundation Postgres.
 */
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBuyerRequestedStoreReturn } from "../../../../apps/main/src/lib/store-return-request";
import { ACTIVE_STORE_RETURN_STATUSES } from "../../../../apps/main/src/lib/store-return";
import { LATEST_STORE_RETURN_ORDER_BY } from "../../../../apps/main/src/lib/store-return-order";
import { createMember, createOrder } from "./fixtures";
import { foundationTestDatabaseUrl } from "./local-url";

let prisma: PrismaClient;
let inFlightTransactions = 0;
let maxInFlightTransactions = 0;
let originalTransaction: typeof PrismaClient.prototype.$transaction;

beforeAll(() => {
  const url = foundationTestDatabaseUrl();
  prisma = new PrismaClient({
    datasources: { db: { url } },
    log: ["error"],
  });
  originalTransaction = prisma.$transaction.bind(prisma);
  prisma.$transaction = (async (...args: Parameters<typeof originalTransaction>) => {
    inFlightTransactions += 1;
    maxInFlightTransactions = Math.max(maxInFlightTransactions, inFlightTransactions);
    try {
      return await originalTransaction(...args);
    } finally {
      inFlightTransactions -= 1;
    }
  }) as typeof prisma.$transaction;
});

afterAll(async () => {
  prisma.$transaction = originalTransaction;
  await prisma?.$disconnect();
});

async function eligibleOrder() {
  const buyer = await createMember(prisma, "u5e-buyer");
  const seller = await createMember(prisma, "u5e-seller");
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

describe("Unit 5E: request-refund concurrency (real PostgreSQL)", () => {
  it("two concurrent requests create exactly one active StoreReturn", async () => {
    const { buyer, order } = await eligibleOrder();
    maxInFlightTransactions = 0;

    const results = await Promise.allSettled([
      createBuyerRequestedStoreReturn(prisma, {
        orderId: order.id,
        buyerId: buyer.id,
        reason: "Changed my mind",
      }),
      createBuyerRequestedStoreReturn(prisma, {
        orderId: order.id,
        buyerId: buyer.id,
        reason: "Changed my mind",
      }),
    ]);

    expect(maxInFlightTransactions).toBeGreaterThanOrEqual(2);

    const fulfilled = results
      .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof createBuyerRequestedStoreReturn>>> =>
        r.status === "fulfilled"
      )
      .map((r) => r.value);

    expect(fulfilled).toHaveLength(2);
    const wins = fulfilled.filter((r) => r.ok);
    const losses = fulfilled.filter((r) => !r.ok);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
    expect(losses[0] && !losses[0].ok && losses[0].error).toBe("already_in_progress");

    const all = await prisma.storeReturn.findMany({ where: { orderId: order.id } });
    expect(all).toHaveLength(1);
    expect(all[0]?.status).toBe("requested");

    const active = await prisma.storeReturn.count({
      where: {
        orderId: order.id,
        status: { in: [...ACTIVE_STORE_RETURN_STATUSES] },
      },
    });
    expect(active).toBe(1);

    const unchanged = await prisma.storeOrder.findUnique({ where: { id: order.id } });
    expect(unchanged?.status).toBe("shipped");
    expect(unchanged?.totalCents).toBe(1000);
    expect(unchanged?.refundRequestedAt).toBeTruthy();
  });

  it("two concurrent requests against existing active return create zero new rows", async () => {
    const { buyer, order } = await eligibleOrder();
    const existing = await prisma.storeReturn.create({
      data: {
        orderId: order.id,
        status: "requested",
        reason: "seed",
        requestedAt: new Date(),
      },
    });

    const results = await Promise.allSettled([
      createBuyerRequestedStoreReturn(prisma, {
        orderId: order.id,
        buyerId: buyer.id,
        reason: "Changed my mind",
      }),
      createBuyerRequestedStoreReturn(prisma, {
        orderId: order.id,
        buyerId: buyer.id,
        reason: "Changed my mind",
      }),
    ]);

    const fulfilled = results
      .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof createBuyerRequestedStoreReturn>>> =>
        r.status === "fulfilled"
      )
      .map((r) => r.value);

    expect(fulfilled.every((r) => !r.ok && r.error === "already_in_progress")).toBe(true);
    const all = await prisma.storeReturn.findMany({ where: { orderId: order.id } });
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe(existing.id);
  });

  it("no active → create; terminal declined allows a new request", async () => {
    const { buyer, order } = await eligibleOrder();
    const first = await createBuyerRequestedStoreReturn(prisma, {
      orderId: order.id,
      buyerId: buyer.id,
      reason: "Changed my mind",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    await prisma.storeReturn.update({
      where: { id: first.storeReturn.id },
      data: { status: "declined", declinedAt: new Date(), declineReason: "no" },
    });

    const second = await createBuyerRequestedStoreReturn(prisma, {
      orderId: order.id,
      buyerId: buyer.id,
      reason: "Wrong Item Delivered",
    });
    expect(second.ok).toBe(true);
    const active = await prisma.storeReturn.count({
      where: {
        orderId: order.id,
        status: { in: [...ACTIVE_STORE_RETURN_STATUSES] },
      },
    });
    expect(active).toBe(1);
    expect(await prisma.storeReturn.count({ where: { orderId: order.id } })).toBe(2);
  });

  it("malformed multiple active rows → fail closed (no third create)", async () => {
    const { buyer, order } = await eligibleOrder();
    const ts = new Date("2026-06-01T00:00:00.000Z");
    await prisma.storeReturn.create({
      data: {
        id: "u5e_active_low",
        orderId: order.id,
        status: "requested",
        createdAt: ts,
        requestedAt: ts,
      },
    });
    await prisma.storeReturn.create({
      data: {
        id: "u5e_active_high",
        orderId: order.id,
        status: "awaiting_return",
        createdAt: ts,
        requestedAt: ts,
      },
    });

    const result = await createBuyerRequestedStoreReturn(prisma, {
      orderId: order.id,
      buyerId: buyer.id,
      reason: "Changed my mind",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("already_in_progress");
    expect(await prisma.storeReturn.count({ where: { orderId: order.id } })).toBe(2);
  });

  it("same createdAt → latest selector picks greatest id", async () => {
    const { order } = await eligibleOrder();
    const ts = new Date("2026-07-01T00:00:00.000Z");
    await prisma.storeReturn.create({
      data: {
        id: "u5e_tie_aaa",
        orderId: order.id,
        status: "declined",
        createdAt: ts,
        declinedAt: ts,
      },
    });
    await prisma.storeReturn.create({
      data: {
        id: "u5e_tie_zzz",
        orderId: order.id,
        status: "canceled",
        createdAt: ts,
      },
    });

    const latest = await prisma.storeReturn.findFirst({
      where: { orderId: order.id },
      orderBy: [...LATEST_STORE_RETURN_ORDER_BY],
    });
    expect(latest?.id).toBe("u5e_tie_zzz");
  });
});
