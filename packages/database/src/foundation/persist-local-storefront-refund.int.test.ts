/**
 * Prompt 111: real PostgreSQL proof that concurrent
 * persistLocalStorefrontRefundCompletion Path-A calls converge once.
 *
 * This file is excluded from packages/database tsc because it imports the
 * production app helper. Vitest still compiles it against the disposable
 * Foundation Postgres started by run-foundation-int.mjs.
 */
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  persistLocalStorefrontRefundCompletion,
  StorefrontReturnLedgerConflictError,
} from "../../../../apps/main/src/lib/stripe/refund-store-order";
import { prisma as productionPrisma } from "database";
import {
  COMMERCE_FOUNDATION_CUTOVER_SINGLETON_ID,
  transitionCommerceFoundationCutover,
} from "../commerce-foundation-cutover";
import {
  finalizeFoundationCheckoutPayment,
  prepareFoundationCheckout,
} from "../commerce-foundation-checkout";
import { provisionNativeFoundationListing } from "../commerce-foundation-listing";
import { createMember, createStoreItem, createStoreReturn } from "./fixtures";
import { foundationTestDatabaseUrl } from "./local-url";

const STARTING_BALANCE_CENTS = 5000;
const LEDGER_DEBIT_CENTS = 990;
const STARTING_ON_HAND_AFTER_SALE = 0;
const RESTOCK_QTY = 1;
const CONCURRENCY_REPEATS = 5;

type PersistLocal = typeof persistLocalStorefrontRefundCompletion;

let prisma: PrismaClient;
let originalTransaction: typeof productionPrisma.$transaction;
let inFlightTransactions = 0;
let maxInFlightTransactions = 0;

type PathAFixture = {
  sellerId: string;
  orderId: string;
  returnId: string;
  lineId: string;
  storeItemId: string;
  variantId: string;
  sourceFactId: string;
  persistInput: Parameters<PersistLocal>[0];
};

async function resetSingleton() {
  await prisma.$executeRaw`
    INSERT INTO "commerce_foundation_cutover" ("id", "mode", "updated_at")
    VALUES (${COMMERCE_FOUNDATION_CUTOVER_SINGLETON_ID}, 'LEGACY', CURRENT_TIMESTAMP)
    ON CONFLICT ("id") DO UPDATE SET
      "mode" = 'LEGACY',
      "frozen_at" = NULL,
      "backfilled_at" = NULL,
      "foundation_at" = NULL,
      "unfrozen_at" = NULL,
      "engine_sha" = NULL,
      "manifest_hash" = NULL,
      "updated_at" = CURRENT_TIMESTAMP
  `;
}

async function enterFoundation() {
  await transitionCommerceFoundationCutover(prisma, { to: "FROZEN" });
  await transitionCommerceFoundationCutover(prisma, {
    to: "BACKFILLING",
    engineSha: "engine-test",
    manifestHash: "manifest-test",
  });
  await transitionCommerceFoundationCutover(prisma, { to: "FOUNDATION" });
}

function restockSourceFactId(returnId: string, lineId: string) {
  return `${returnId}:${lineId}:PHYSICAL_RECEIPT`;
}

async function seedPathAFixture(opts?: {
  orderStatus?: string;
  inventoryRestoredAt?: Date | null;
  existingReturnLedgerAmountCents?: number;
}): Promise<PathAFixture> {
  await enterFoundation();
  const seller = await createMember(prisma, "p111-seller");
  const buyer = await createMember(prisma, "p111-buyer");
  const item = await createStoreItem(prisma, seller.id, "Prompt 111 Path A", { quantity: 1 });
  const provisioned = await prisma.$transaction((tx) => provisionNativeFoundationListing(tx, item.id));
  const variantId = provisioned.variantIds[0];
  const prepared = await prepareFoundationCheckout(prisma, {
    buyerMemberId: buyer.id,
    amountCents: 1000,
    orders: [
      {
        sellerId: seller.id,
        subtotalCents: 1000,
        shippingCostCents: 0,
        totalCents: 1000,
        lines: [{ storeItemId: item.id, quantity: 1, priceCentsAtPurchase: 1000, variantId }],
      },
    ],
  });
  await finalizeFoundationCheckoutPayment(prisma, { attemptId: prepared.attemptId });
  const orderId = prepared.orderIds[0];
  const line = await prisma.orderItem.findFirst({ where: { orderId } });
  if (!line) throw new Error("expected sold OrderItem");
  const storeReturn = await createStoreReturn(prisma, { orderId, status: "received" });
  await prisma.sellerBalance.create({
    data: {
      memberId: seller.id,
      balanceCents: STARTING_BALANCE_CENTS,
      totalEarnedCents: STARTING_BALANCE_CENTS,
    },
  });
  await prisma.storeOrder.update({
    where: { id: orderId },
    data: {
      status: opts?.orderStatus ?? "delivered",
      inventoryRestoredAt: opts?.inventoryRestoredAt ?? null,
    },
  });
  if (opts?.existingReturnLedgerAmountCents != null) {
    await prisma.sellerBalanceTransaction.create({
      data: {
        memberId: seller.id,
        type: "return",
        amountCents: opts.existingReturnLedgerAmountCents,
        orderId,
        description: "Prompt 111 conflicting seed",
      },
    });
  }
  const persistInput: Parameters<PersistLocal>[0] = {
    order: {
      id: orderId,
      sellerId: seller.id,
      totalCents: 1000,
      subtotalCents: 1000,
      inventoryRestoredAt: opts?.inventoryRestoredAt ?? null,
      items: [
        {
          id: line.id,
          storeItemId: item.id,
          quantity: 1,
          variantId,
        },
      ],
    },
    reason: "Prompt 111 Path A",
    note: null,
    restock: true,
    restockKind: "PHYSICAL_RECEIPT",
    restockOperationId: storeReturn.id,
    ledgerDebitCents: LEDGER_DEBIT_CENTS,
    skipSellerLedgerDebit: false,
    stripeRefund: { id: `re_p111_${storeReturn.id}`, status: "succeeded", created: 1_700_000_000 },
    locallyComplete: true,
  };
  return {
    sellerId: seller.id,
    orderId,
    returnId: storeReturn.id,
    lineId: line.id,
    storeItemId: item.id,
    variantId,
    sourceFactId: restockSourceFactId(storeReturn.id, line.id),
    persistInput,
  };
}

async function postgresIdentity() {
  const rows = await prisma.$queryRaw<Array<{ version: string; is_pg: boolean }>>`
    SELECT version() AS version, (current_setting('server_version_num')::int > 0) AS is_pg
  `;
  return rows[0];
}

async function assertConverged(fx: PathAFixture, opts?: { expectRestock: boolean }) {
  const expectRestock = opts?.expectRestock ?? true;
  const ledger = await prisma.sellerBalanceTransaction.findMany({
    where: { orderId: fx.orderId, type: "return" },
  });
  expect(ledger).toHaveLength(1);
  expect(ledger[0]).toMatchObject({
    memberId: fx.sellerId,
    type: "return",
    amountCents: -LEDGER_DEBIT_CENTS,
    orderId: fx.orderId,
  });

  const balance = await prisma.sellerBalance.findUnique({ where: { memberId: fx.sellerId } });
  expect(balance?.balanceCents).toBe(STARTING_BALANCE_CENTS - LEDGER_DEBIT_CENTS);

  const restockEvents = await prisma.inventoryEvent.findMany({
    where: { variantId: fx.variantId, sourceFactId: fx.sourceFactId },
  });
  const physical = await prisma.inventoryEvent.findMany({
    where: { variantId: fx.variantId, eventType: "PHYSICAL_RECEIPT" },
  });
  const state = await prisma.inventoryState.findUnique({ where: { variantId: fx.variantId } });
  const order = await prisma.storeOrder.findUnique({ where: { id: fx.orderId } });

  if (expectRestock) {
    expect(restockEvents).toHaveLength(1);
    expect(physical).toHaveLength(1);
    expect(state?.onHand).toBe(STARTING_ON_HAND_AFTER_SALE + RESTOCK_QTY);
    expect(order?.inventoryRestoredAt).not.toBeNull();
  } else {
    expect(restockEvents).toHaveLength(0);
    expect(physical).toHaveLength(0);
    expect(state?.onHand).toBe(STARTING_ON_HAND_AFTER_SALE);
    expect(order?.inventoryRestoredAt).not.toBeNull();
  }

  expect(order?.status).toBe("refunded");
  expect(order?.stripeRefundId).toBe(fx.persistInput.stripeRefund?.id);
  expect(order?.refundCompletedAt).not.toBeNull();
}

beforeAll(async () => {
  const url = foundationTestDatabaseUrl();
  prisma = new PrismaClient({
    datasources: { db: { url } },
    log: ["error"],
  });
  originalTransaction = productionPrisma.$transaction.bind(productionPrisma);
  productionPrisma.$transaction = ((...args: Parameters<typeof productionPrisma.$transaction>) => {
    inFlightTransactions += 1;
    maxInFlightTransactions = Math.max(maxInFlightTransactions, inFlightTransactions);
    return Promise.resolve(originalTransaction(...args)).finally(() => {
      inFlightTransactions -= 1;
    });
  }) as typeof productionPrisma.$transaction;
});

afterEach(async () => {
  inFlightTransactions = 0;
  maxInFlightTransactions = 0;
  await resetSingleton();
});

afterAll(async () => {
  if (originalTransaction) {
    productionPrisma.$transaction = originalTransaction;
  }
  await prisma?.$disconnect();
  await productionPrisma.$disconnect();
});

describe("persistLocalStorefrontRefundCompletion real PostgreSQL", () => {
  it("proves the harness is real PostgreSQL and the production helper uses the live Prisma client", async () => {
    const identity = await postgresIdentity();
    expect(identity.version).toMatch(/PostgreSQL/i);
    expect(identity.is_pg).toBe(true);
    const parsed = new URL(foundationTestDatabaseUrl());
    expect(["127.0.0.1", "localhost", "::1"]).toContain(parsed.hostname);
    expect(parsed.pathname).toBe("/inw_foundation_test");
    expect(productionPrisma.$transaction).not.toBeUndefined();
    expect(typeof productionPrisma.$executeRaw).toBe("function");
  });

  it("two concurrent Path-A calls create one return ledger, one debit, and one restock", async () => {
    const fx = await seedPathAFixture();
    const beforeBalance = await prisma.sellerBalance.findUnique({ where: { memberId: fx.sellerId } });
    const beforeState = await prisma.inventoryState.findUnique({ where: { variantId: fx.variantId } });
    const beforeLedger = await prisma.sellerBalanceTransaction.count({
      where: { orderId: fx.orderId, type: "return" },
    });
    const beforeOrder = await prisma.storeOrder.findUnique({ where: { id: fx.orderId } });
    expect(beforeBalance?.balanceCents).toBe(STARTING_BALANCE_CENTS);
    expect(beforeState?.onHand).toBe(STARTING_ON_HAND_AFTER_SALE);
    expect(beforeLedger).toBe(0);
    expect(beforeOrder?.status).toBe("delivered");
    expect(beforeOrder?.inventoryRestoredAt).toBeNull();

    maxInFlightTransactions = 0;
    inFlightTransactions = 0;
    const startedAt: number[] = [];
    const call = async () => {
      startedAt.push(Date.now());
      return persistLocalStorefrontRefundCompletion(fx.persistInput);
    };
    const settled = await Promise.allSettled([call(), call()]);
    const rejected = settled.filter((row) => row.status === "rejected");
    if (rejected.length > 0) {
      const reasons = rejected.map((row) =>
        row.status === "rejected" ? String(row.reason instanceof Error ? row.reason.stack ?? row.reason.message : row.reason) : ""
      );
      throw new Error(`Unexpected concurrent persistLocal failure:\n${reasons.join("\n")}`);
    }
    expect(settled).toHaveLength(2);
    expect(settled.every((row) => row.status === "fulfilled")).toBe(true);
    expect(startedAt).toHaveLength(2);
    expect(Math.abs(startedAt[0] - startedAt[1])).toBeLessThan(1_000);
    expect(maxInFlightTransactions).toBeGreaterThanOrEqual(2);

    await assertConverged(fx, { expectRestock: true });
  });

  it("Path-A concurrency stays stable across independent real-DB races", async () => {
    for (let i = 0; i < CONCURRENCY_REPEATS; i++) {
      const fx = await seedPathAFixture();
      const settled = await Promise.allSettled([
        persistLocalStorefrontRefundCompletion(fx.persistInput),
        persistLocalStorefrontRefundCompletion(fx.persistInput),
      ]);
      const rejected = settled.filter((row) => row.status === "rejected");
      if (rejected.length > 0) {
        const reasons = rejected.map((row) =>
          row.status === "rejected"
            ? String(row.reason instanceof Error ? row.reason.stack ?? row.reason.message : row.reason)
            : ""
        );
        throw new Error(`Repeat ${i + 1}/${CONCURRENCY_REPEATS} failed:\n${reasons.join("\n")}`);
      }
      await assertConverged(fx, { expectRestock: true });
      await resetSingleton();
    }
  });

  it("refunded StoreOrder with missing return ledger still debits once and does not restock", async () => {
    const restoredAt = new Date("2026-09-21T00:00:00.000Z");
    const fx = await seedPathAFixture({
      orderStatus: "refunded",
      inventoryRestoredAt: restoredAt,
    });
    const beforeState = await prisma.inventoryState.findUnique({ where: { variantId: fx.variantId } });
    expect(beforeState?.onHand).toBe(STARTING_ON_HAND_AFTER_SALE);

    await persistLocalStorefrontRefundCompletion(fx.persistInput);

    await assertConverged(fx, { expectRestock: false });
    const order = await prisma.storeOrder.findUnique({ where: { id: fx.orderId } });
    expect(order?.inventoryRestoredAt?.toISOString()).toBe(restoredAt.toISOString());
  });

  it("conflicting existing return ledger throws without mutating balance, inventory, or order", async () => {
    const fx = await seedPathAFixture({ existingReturnLedgerAmountCents: -1 });
    await expect(persistLocalStorefrontRefundCompletion(fx.persistInput)).rejects.toBeInstanceOf(
      StorefrontReturnLedgerConflictError
    );

    const ledger = await prisma.sellerBalanceTransaction.findMany({
      where: { orderId: fx.orderId, type: "return" },
    });
    expect(ledger).toHaveLength(1);
    expect(ledger[0].amountCents).toBe(-1);

    const balance = await prisma.sellerBalance.findUnique({ where: { memberId: fx.sellerId } });
    expect(balance?.balanceCents).toBe(STARTING_BALANCE_CENTS);

    const physical = await prisma.inventoryEvent.count({
      where: { variantId: fx.variantId, eventType: "PHYSICAL_RECEIPT" },
    });
    expect(physical).toBe(0);
    const state = await prisma.inventoryState.findUnique({ where: { variantId: fx.variantId } });
    expect(state?.onHand).toBe(STARTING_ON_HAND_AFTER_SALE);

    const order = await prisma.storeOrder.findUnique({ where: { id: fx.orderId } });
    expect(order?.status).toBe("delivered");
    expect(order?.inventoryRestoredAt).toBeNull();
    expect(order?.stripeRefundId).toBeNull();
  });

  it("one exact Path-A return ledger skips debit and still finalizes", async () => {
    const fx = await seedPathAFixture({ existingReturnLedgerAmountCents: -LEDGER_DEBIT_CENTS });
    const beforeBalance = await prisma.sellerBalance.findUnique({ where: { memberId: fx.sellerId } });
    await persistLocalStorefrontRefundCompletion(fx.persistInput);
    const ledger = await prisma.sellerBalanceTransaction.findMany({
      where: { orderId: fx.orderId, type: "return" },
    });
    expect(ledger).toHaveLength(1);
    const balance = await prisma.sellerBalance.findUnique({ where: { memberId: fx.sellerId } });
    expect(balance?.balanceCents).toBe(beforeBalance?.balanceCents);
    const order = await prisma.storeOrder.findUnique({ where: { id: fx.orderId } });
    expect(order?.status).toBe("refunded");
  });

  it("two exact Path-A return rows fail closed without new debit, restock, or order finalization", async () => {
    const fx = await seedPathAFixture();
    await prisma.sellerBalanceTransaction.createMany({
      data: [
        {
          memberId: fx.sellerId,
          type: "return",
          amountCents: -LEDGER_DEBIT_CENTS,
          orderId: fx.orderId,
          description: "dup-a",
        },
        {
          memberId: fx.sellerId,
          type: "return",
          amountCents: -LEDGER_DEBIT_CENTS,
          orderId: fx.orderId,
          description: "dup-b",
        },
      ],
    });
    await expect(persistLocalStorefrontRefundCompletion(fx.persistInput)).rejects.toBeInstanceOf(
      StorefrontReturnLedgerConflictError
    );
    const ledger = await prisma.sellerBalanceTransaction.findMany({
      where: { orderId: fx.orderId, type: "return" },
    });
    expect(ledger).toHaveLength(2);
    const balance = await prisma.sellerBalance.findUnique({ where: { memberId: fx.sellerId } });
    expect(balance?.balanceCents).toBe(STARTING_BALANCE_CENTS);
    const physical = await prisma.inventoryEvent.count({
      where: { variantId: fx.variantId, eventType: "PHYSICAL_RECEIPT" },
    });
    expect(physical).toBe(0);
    const order = await prisma.storeOrder.findUnique({ where: { id: fx.orderId } });
    expect(order?.status).toBe("delivered");
    expect(order?.inventoryRestoredAt).toBeNull();
  });

  it("exact-plus-conflict Path-A rows fail closed", async () => {
    const fx = await seedPathAFixture();
    await prisma.sellerBalanceTransaction.createMany({
      data: [
        {
          memberId: fx.sellerId,
          type: "return",
          amountCents: -LEDGER_DEBIT_CENTS,
          orderId: fx.orderId,
          description: "exact",
        },
        {
          memberId: fx.sellerId,
          type: "return",
          amountCents: -1,
          orderId: fx.orderId,
          description: "conflict",
        },
      ],
    });
    await expect(persistLocalStorefrontRefundCompletion(fx.persistInput)).rejects.toBeInstanceOf(
      StorefrontReturnLedgerConflictError
    );
    const balance = await prisma.sellerBalance.findUnique({ where: { memberId: fx.sellerId } });
    expect(balance?.balanceCents).toBe(STARTING_BALANCE_CENTS);
    const order = await prisma.storeOrder.findUnique({ where: { id: fx.orderId } });
    expect(order?.status).toBe("delivered");
  });

  it("zero expected Path-A debit with stray return row fails closed", async () => {
    const fx = await seedPathAFixture({ existingReturnLedgerAmountCents: -LEDGER_DEBIT_CENTS });
    await expect(
      persistLocalStorefrontRefundCompletion({
        ...fx.persistInput,
        ledgerDebitCents: 0,
      })
    ).rejects.toBeInstanceOf(StorefrontReturnLedgerConflictError);
    const order = await prisma.storeOrder.findUnique({ where: { id: fx.orderId } });
    expect(order?.status).toBe("delivered");
  });
});
