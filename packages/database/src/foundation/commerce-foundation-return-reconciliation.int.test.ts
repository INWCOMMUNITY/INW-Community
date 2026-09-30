import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  FOUNDATION_RETURN_SETTLEMENT_RECONCILIATION_BATCH_SIZE,
  listFoundationReturnSettlementCandidates,
} from "../commerce-foundation-return-reconciliation";
import { foundationTestDatabaseUrl } from "./local-url";
import { createMember, createOrder, createStoreReturn } from "./fixtures";

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = new PrismaClient({
    datasources: { db: { url: foundationTestDatabaseUrl() } },
    log: ["error"],
  });
});

afterEach(async () => {
  await prisma.storeReturn.deleteMany({
    where: { id: { startsWith: "u5a-" } },
  });
});

afterAll(async () => {
  await prisma?.$disconnect();
});

async function seedReceived(args: {
  id: string;
  sellerId: string;
  buyerId: string;
  receivedAt: Date | null;
  status?: string;
}) {
  const order = await createOrder(prisma, { buyerId: args.buyerId, sellerId: args.sellerId });
  const storeReturn = await createStoreReturn(prisma, {
    id: args.id,
    orderId: order.id,
    status: args.status ?? "received",
    receivedAt: args.receivedAt,
  });
  return { order, storeReturn };
}

describe("listFoundationReturnSettlementCandidates (real PostgreSQL)", () => {
  it("includes received, excludes refunded and other statuses, returns StoreOrder seller identity", async () => {
    const sellerA = await createMember(prisma, "u5a-sa");
    const sellerB = await createMember(prisma, "u5a-sb");
    const buyer = await createMember(prisma, "u5a-b");
    const t1 = new Date("2026-09-01T00:00:00.000Z");
    const received = await seedReceived({
      id: "u5a-recv-1",
      sellerId: sellerA.id,
      buyerId: buyer.id,
      receivedAt: t1,
    });
    await seedReceived({
      id: "u5a-ref-1",
      sellerId: sellerB.id,
      buyerId: buyer.id,
      receivedAt: t1,
      status: "refunded",
    });
    for (const status of ["requested", "awaiting_return", "in_transit", "declined", "canceled"]) {
      await seedReceived({
        id: `u5a-st-${status}`,
        sellerId: sellerB.id,
        buyerId: buyer.id,
        receivedAt: t1,
        status,
      });
    }

    const candidates = await listFoundationReturnSettlementCandidates(prisma, { take: 500 });
    const mine = candidates.filter((c) => c.storeReturnId.startsWith("u5a-"));
    expect(mine).toEqual([
      {
        storeReturnId: received.storeReturn.id,
        storeOrderId: received.order.id,
        sellerId: sellerA.id,
      },
    ]);
    expect(mine[0]?.sellerId).not.toBe(sellerB.id);
  });

  it("orders receivedAt oldest first, then id ASC, with null receivedAt last", async () => {
    const seller = await createMember(prisma, "u5a-ord-s");
    const buyer = await createMember(prisma, "u5a-ord-b");
    const older = new Date("2026-08-01T00:00:00.000Z");
    const newer = new Date("2026-08-02T00:00:00.000Z");
    await seedReceived({ id: "u5a-ord-newer", sellerId: seller.id, buyerId: buyer.id, receivedAt: newer });
    await seedReceived({ id: "u5a-ord-z", sellerId: seller.id, buyerId: buyer.id, receivedAt: older });
    await seedReceived({ id: "u5a-ord-a", sellerId: seller.id, buyerId: buyer.id, receivedAt: older });
    await seedReceived({ id: "u5a-ord-null", sellerId: seller.id, buyerId: buyer.id, receivedAt: null });

    const candidates = await listFoundationReturnSettlementCandidates(prisma, { take: 500 });
    const mine = candidates.filter((c) => c.storeReturnId.startsWith("u5a-ord-"));
    expect(mine.map((c) => c.storeReturnId)).toEqual([
      "u5a-ord-a",
      "u5a-ord-z",
      "u5a-ord-newer",
      "u5a-ord-null",
    ]);
  });

  it("caps automatic candidates at 50", async () => {
    const seller = await createMember(prisma, "u5a-lim-s");
    const buyer = await createMember(prisma, "u5a-lim-b");
    const t0 = new Date("1990-01-01T00:00:00.000Z");
    for (let i = 0; i < 51; i += 1) {
      await seedReceived({
        id: `u5a-lim-${String(i).padStart(2, "0")}`,
        sellerId: seller.id,
        buyerId: buyer.id,
        receivedAt: new Date(t0.getTime() + i * 1000),
      });
    }
    const unbounded = await listFoundationReturnSettlementCandidates(prisma, { take: 500 });
    expect(unbounded.filter((c) => c.storeReturnId.startsWith("u5a-lim-"))).toHaveLength(51);
    const bounded = await listFoundationReturnSettlementCandidates(prisma, { take: 50 });
    const limited = bounded.filter((c) => c.storeReturnId.startsWith("u5a-lim-"));
    expect(FOUNDATION_RETURN_SETTLEMENT_RECONCILIATION_BATCH_SIZE).toBe(50);
    expect(limited).toHaveLength(50);
    expect(limited[0]?.storeReturnId).toBe("u5a-lim-00");
    expect(limited[49]?.storeReturnId).toBe("u5a-lim-49");
    expect(limited.some((c) => c.storeReturnId === "u5a-lim-50")).toBe(false);
    const defaultBatch = await listFoundationReturnSettlementCandidates(prisma);
    expect(defaultBatch).toHaveLength(50);
  });
});
