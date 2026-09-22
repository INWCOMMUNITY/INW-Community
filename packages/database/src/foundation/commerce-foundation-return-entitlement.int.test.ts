import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createMember,
  createOrder,
  createStoreReturn,
  expectRejects,
} from "./fixtures";
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

let seq = 0;
function key(prefix: string) {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

async function twoSellersWithOrders() {
  const sellerA = await createMember(prisma, "ent-a");
  const sellerB = await createMember(prisma, "ent-b");
  const buyer = await createMember(prisma, "ent-buyer");
  const orderA = await createOrder(prisma, { buyerId: buyer.id, sellerId: sellerA.id });
  const orderB = await createOrder(prisma, { buyerId: buyer.id, sellerId: sellerB.id });
  const returnA = await createStoreReturn(prisma, { orderId: orderA.id });
  const returnB = await createStoreReturn(prisma, { orderId: orderB.id });
  return { sellerA, sellerB, buyer, orderA, orderB, returnA, returnB };
}

function entitlementData(args: {
  memberId: string;
  storeOrderId: string;
  storeReturnId: string;
  amountCents?: number;
  retryCount?: number;
  currency?: string;
  providerIdempotencyKey?: string;
  stripeTransferId?: string | null;
}) {
  return {
    memberId: args.memberId,
    storeOrderId: args.storeOrderId,
    storeReturnId: args.storeReturnId,
    amountCents: args.amountCents ?? 1000,
    retryCount: args.retryCount,
    currency: args.currency,
    providerIdempotencyKey: args.providerIdempotencyKey ?? key("nwc_store_return_entitlement"),
    stripeTransferId: args.stripeTransferId ?? undefined,
  };
}

describe("SellerReturnEntitlementOperation schema integrity (real PostgreSQL)", () => {
  it("catalog: table, CHECKs, uniques, Restrict FKs, and StoreReturn supporting unique exist", async () => {
    const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename = 'seller_return_entitlement_operation'
    `;
    expect(tables.map((t) => t.tablename)).toEqual(["seller_return_entitlement_operation"]);

    const checks = await prisma.$queryRaw<Array<{ conname: string }>>`
      SELECT conname FROM pg_constraint
      WHERE contype = 'c'
        AND conname IN ('sreo_amount_positive_check', 'sreo_retry_nonnegative_check')
    `;
    expect(checks.map((c) => c.conname).sort()).toEqual([
      "sreo_amount_positive_check",
      "sreo_retry_nonnegative_check",
    ]);

    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'sreo_store_order_id_key',
          'sreo_store_return_id_key',
          'sreo_provider_idempotency_key_key',
          'sreo_stripe_transfer_id_key',
          'sreo_status_created_at_idx',
          'StoreReturn_id_order_id_key'
        )
    `;
    expect(indexes.map((r) => r.indexname).sort()).toEqual([
      "StoreReturn_id_order_id_key",
      "sreo_provider_idempotency_key_key",
      "sreo_status_created_at_idx",
      "sreo_store_order_id_key",
      "sreo_store_return_id_key",
      "sreo_stripe_transfer_id_key",
    ]);

    const fks = await prisma.$queryRaw<Array<{ conname: string; del: string }>>`
      SELECT conname, CASE confdeltype WHEN 'r' THEN 'RESTRICT' ELSE confdeltype::text END AS del
      FROM pg_constraint
      WHERE contype = 'f'
        AND conname IN (
          'sreo_member_id_fkey',
          'sreo_store_order_id_fkey',
          'sreo_store_return_id_fkey',
          'sreo_store_order_id_member_id_fkey',
          'sreo_store_return_id_store_order_id_fkey'
        )
    `;
    expect(
      fks
        .map((r) => `${r.conname}=${r.del}`)
        .sort()
    ).toEqual([
      "sreo_member_id_fkey=RESTRICT",
      "sreo_store_order_id_fkey=RESTRICT",
      "sreo_store_order_id_member_id_fkey=RESTRICT",
      "sreo_store_return_id_fkey=RESTRICT",
      "sreo_store_return_id_store_order_id_fkey=RESTRICT",
    ]);
  });

  it("accepts a positive amount with schema defaults PENDING / retry 0 / usd", async () => {
    const ctx = await twoSellersWithOrders();
    const row = await prisma.sellerReturnEntitlementOperation.create({
      data: entitlementData({
        memberId: ctx.sellerA.id,
        storeOrderId: ctx.orderA.id,
        storeReturnId: ctx.returnA.id,
        amountCents: 1000,
      }),
    });
    expect(row.status).toBe("PENDING");
    expect(row.retryCount).toBe(0);
    expect(row.currency).toBe("usd");
    expect(row.amountCents).toBe(1000);
    expect(row.stripeTransferId).toBeNull();
  });

  it("rejects amount_cents = 0", async () => {
    const ctx = await twoSellersWithOrders();
    await expectRejects(
      () =>
        prisma.sellerReturnEntitlementOperation.create({
          data: entitlementData({
            memberId: ctx.sellerA.id,
            storeOrderId: ctx.orderA.id,
            storeReturnId: ctx.returnA.id,
            amountCents: 0,
          }),
        }),
      "check"
    );
  });

  it("rejects negative amount_cents", async () => {
    const ctx = await twoSellersWithOrders();
    await expectRejects(
      () =>
        prisma.sellerReturnEntitlementOperation.create({
          data: entitlementData({
            memberId: ctx.sellerA.id,
            storeOrderId: ctx.orderA.id,
            storeReturnId: ctx.returnA.id,
            amountCents: -1,
          }),
        }),
      "check"
    );
  });

  it("rejects negative retry_count", async () => {
    const ctx = await twoSellersWithOrders();
    await expectRejects(
      () =>
        prisma.sellerReturnEntitlementOperation.create({
          data: entitlementData({
            memberId: ctx.sellerA.id,
            storeOrderId: ctx.orderA.id,
            storeReturnId: ctx.returnA.id,
            retryCount: -1,
          }),
        }),
      "check"
    );
  });

  it("rejects memberId that is not the StoreOrder seller", async () => {
    const ctx = await twoSellersWithOrders();
    await expectRejects(
      () =>
        prisma.sellerReturnEntitlementOperation.create({
          data: entitlementData({
            memberId: ctx.sellerB.id,
            storeOrderId: ctx.orderA.id,
            storeReturnId: ctx.returnA.id,
          }),
        }),
      "fk"
    );
  });

  it("rejects StoreReturn from a different StoreOrder", async () => {
    const ctx = await twoSellersWithOrders();
    await expectRejects(
      () =>
        prisma.sellerReturnEntitlementOperation.create({
          data: entitlementData({
            memberId: ctx.sellerA.id,
            storeOrderId: ctx.orderA.id,
            storeReturnId: ctx.returnB.id,
          }),
        }),
      "fk"
    );
  });

  it("rejects a second entitlement for the same StoreOrder", async () => {
    const ctx = await twoSellersWithOrders();
    await prisma.sellerReturnEntitlementOperation.create({
      data: entitlementData({
        memberId: ctx.sellerA.id,
        storeOrderId: ctx.orderA.id,
        storeReturnId: ctx.returnA.id,
      }),
    });
    const extraReturn = await createStoreReturn(prisma, { orderId: ctx.orderA.id });
    await expectRejects(
      () =>
        prisma.sellerReturnEntitlementOperation.create({
          data: entitlementData({
            memberId: ctx.sellerA.id,
            storeOrderId: ctx.orderA.id,
            storeReturnId: extraReturn.id,
          }),
        }),
      "unique"
    );
  });

  it("rejects a second entitlement for the same StoreReturn", async () => {
    const ctx = await twoSellersWithOrders();
    await prisma.sellerReturnEntitlementOperation.create({
      data: entitlementData({
        memberId: ctx.sellerA.id,
        storeOrderId: ctx.orderA.id,
        storeReturnId: ctx.returnA.id,
      }),
    });
    await expectRejects(
      () =>
        prisma.sellerReturnEntitlementOperation.create({
          data: entitlementData({
            memberId: ctx.sellerA.id,
            storeOrderId: ctx.orderA.id,
            storeReturnId: ctx.returnA.id,
          }),
        }),
      "unique"
    );
  });

  it("rejects a duplicate providerIdempotencyKey", async () => {
    const ctx = await twoSellersWithOrders();
    const providerIdempotencyKey = key("dup_key");
    await prisma.sellerReturnEntitlementOperation.create({
      data: entitlementData({
        memberId: ctx.sellerA.id,
        storeOrderId: ctx.orderA.id,
        storeReturnId: ctx.returnA.id,
        providerIdempotencyKey,
      }),
    });
    await expectRejects(
      () =>
        prisma.sellerReturnEntitlementOperation.create({
          data: entitlementData({
            memberId: ctx.sellerB.id,
            storeOrderId: ctx.orderB.id,
            storeReturnId: ctx.returnB.id,
            providerIdempotencyKey,
          }),
        }),
      "unique"
    );
  });

  it("rejects a duplicate non-null stripeTransferId and allows multiple nulls", async () => {
    const ctx = await twoSellersWithOrders();
    await prisma.sellerReturnEntitlementOperation.create({
      data: entitlementData({
        memberId: ctx.sellerA.id,
        storeOrderId: ctx.orderA.id,
        storeReturnId: ctx.returnA.id,
        stripeTransferId: null,
      }),
    });
    const extraSeller = await createMember(prisma, "ent-null-c");
    const extraBuyer = await createMember(prisma, "ent-null-cb");
    const extraOrder = await createOrder(prisma, { buyerId: extraBuyer.id, sellerId: extraSeller.id });
    const extraReturn = await createStoreReturn(prisma, { orderId: extraOrder.id });
    const secondNull = await prisma.sellerReturnEntitlementOperation.create({
      data: entitlementData({
        memberId: extraSeller.id,
        storeOrderId: extraOrder.id,
        storeReturnId: extraReturn.id,
        stripeTransferId: null,
      }),
    });
    expect(secondNull.stripeTransferId).toBeNull();

    const stripeTransferId = key("tr");
    await prisma.sellerReturnEntitlementOperation.update({
      where: { id: secondNull.id },
      data: { stripeTransferId },
    });
    await expectRejects(
      () =>
        prisma.sellerReturnEntitlementOperation.create({
          data: entitlementData({
            memberId: ctx.sellerB.id,
            storeOrderId: ctx.orderB.id,
            storeReturnId: ctx.returnB.id,
            stripeTransferId,
          }),
        }),
      "unique"
    );
  });

  it("rejects deleting Member, StoreOrder, and StoreReturn while entitlement history exists", async () => {
    const ctx = await twoSellersWithOrders();
    const row = await prisma.sellerReturnEntitlementOperation.create({
      data: entitlementData({
        memberId: ctx.sellerA.id,
        storeOrderId: ctx.orderA.id,
        storeReturnId: ctx.returnA.id,
      }),
    });

    await expectRejects(() => prisma.member.delete({ where: { id: ctx.sellerA.id } }), "restrict");
    await expectRejects(() => prisma.storeOrder.delete({ where: { id: ctx.orderA.id } }), "restrict");
    await expectRejects(() => prisma.storeReturn.delete({ where: { id: ctx.returnA.id } }), "restrict");

    const still = await prisma.sellerReturnEntitlementOperation.findUnique({ where: { id: row.id } });
    expect(still).not.toBeNull();
  });
});
