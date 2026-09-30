import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  FOUNDATION_RETURN_ENTITLEMENT_LEDGER_TYPE,
  FOUNDATION_RETURN_ENTITLEMENT_SNAPSHOT_MISSING_AFTER_ATTEMPT,
  FoundationReturnEntitlementCausalError,
  FoundationReturnEntitlementIntentConflictError,
  beginFoundationReturnEntitlementAttempt,
  completeFoundationSellerReturnEntitlementLedger,
  evaluateFoundationReturnEntitlementResetEligibility,
  foundationReturnEntitlementIdempotencyKey,
  getFoundationReturnEntitlementAdminState,
  persistFoundationReturnEntitlementOutcome,
  persistFoundationReturnEntitlementPreflightFailure,
  persistFoundationReturnEntitlementSuccess,
  prepareFoundationReturnSellerSettlement,
  resetFoundationSellerReturnEntitlementForRetry,
} from "../commerce-foundation-return-entitlement";
import {
  FOUNDATION_TRANSFER_IDEMPOTENCY_WINDOW_MS,
  FOUNDATION_TRANSFER_PROCESSING_STALE_MS,
  FOUNDATION_TRANSFER_SUCCEEDED_WITHOUT_ID,
  FoundationTransferIntentConflictError,
  FoundationTransferOperatorRequiredError,
  FoundationTransferRefundBlockedError,
  foundationTransferIdempotencyKey,
  isFoundationSameKeyReplayAllowed,
  OPERATOR_RESET_FOR_RETRY,
  ORDER_REFUNDED_BEFORE_TRANSFER,
} from "../commerce-foundation-transfer";
import {
  createMember,
  createOrder,
  createStoreReturn,
  createTransferOperation,
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
        AND conname IN (
          'sreo_amount_positive_check',
          'sreo_retry_nonnegative_check',
          'sreo_provider_snapshot_check'
        )
    `;
    expect(checks.map((c) => c.conname).sort()).toEqual([
      "sreo_amount_positive_check",
      "sreo_provider_snapshot_check",
      "sreo_retry_nonnegative_check",
    ]);

    const snapshotCols = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'seller_return_entitlement_operation'
        AND column_name IN ('stripe_destination_account_id', 'stripe_source_charge_id')
    `;
    expect(snapshotCols.map((c) => c.column_name).sort()).toEqual([
      "stripe_destination_account_id",
      "stripe_source_charge_id",
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

describe("prepareFoundationReturnSellerSettlement (Unit 2)", () => {
  function saleKey(storeOrderId: string) {
    return foundationTransferIdempotencyKey(storeOrderId);
  }

  async function saleTransfer(
    ctx: { sellerA: { id: string }; orderA: { id: string } },
    extra?: {
      amountCents?: number;
      status?: "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "UNCERTAIN";
      stripeTransferId?: string | null;
      lastError?: string | null;
      retryCount?: number;
    }
  ) {
    const op = await createTransferOperation(prisma, {
      memberId: ctx.sellerA.id,
      storeOrderId: ctx.orderA.id,
      amountCents: extra?.amountCents ?? 9900,
      providerIdempotencyKey: saleKey(ctx.orderA.id),
      status: extra?.status ?? "PENDING",
      stripeTransferId: extra?.stripeTransferId ?? undefined,
    });
    if (extra?.lastError !== undefined || extra?.retryCount !== undefined) {
      return prisma.transferOperation.update({
        where: { id: op.id },
        data: {
          ...(extra.lastError !== undefined ? { lastError: extra.lastError } : {}),
          ...(extra.retryCount !== undefined ? { retryCount: extra.retryCount } : {}),
        },
      });
    }
    return op;
  }

  function input(
    ctx: {
      sellerA: { id: string };
      orderA: { id: string };
      returnA: { id: string };
    },
    extra?: { original?: number; entitlement?: number; storeReturnId?: string }
  ) {
    return {
      storeOrderId: ctx.orderA.id,
      memberId: ctx.sellerA.id,
      storeReturnId: extra?.storeReturnId ?? ctx.returnA.id,
      originalSaleTransferCents: extra?.original ?? 9900,
      entitlementAmountCents: extra?.entitlement ?? 1000,
      currency: "usd",
    };
  }

  it("missing TO + entitlement > 0 creates FAILED sale TO and PENDING entitlement ($100/$10)", async () => {
    const ctx = await twoSellersWithOrders();
    const result = await prepareFoundationReturnSellerSettlement(prisma, input(ctx));
    expect(result.kind).toBe("NO_TRANSFER_LOCKED_OUT_WITH_ENTITLEMENT");
    if (result.kind !== "NO_TRANSFER_LOCKED_OUT_WITH_ENTITLEMENT") return;
    expect(result.transferOperation.status).toBe("FAILED");
    expect(result.transferOperation.lastError).toBe(ORDER_REFUNDED_BEFORE_TRANSFER);
    expect(result.transferOperation.amountCents).toBe(9900);
    expect(result.transferOperation.providerIdempotencyKey).toBe(saleKey(ctx.orderA.id));
    expect(result.entitlement.amountCents).toBe(1000);
    expect(result.entitlement.status).toBe("PENDING");
    expect(result.entitlement.providerIdempotencyKey).toBe(
      foundationReturnEntitlementIdempotencyKey(ctx.orderA.id)
    );
    expect(result.entitlement.retryCount).toBe(0);
    expect(result.entitlement.stripeTransferId).toBeNull();
  });

  it("persists $5/$9 entitlement as 495 not 900", async () => {
    const ctx = await twoSellersWithOrders();
    const result = await prepareFoundationReturnSellerSettlement(
      prisma,
      input(ctx, { original: 495, entitlement: 495 })
    );
    expect(result.kind).toBe("NO_TRANSFER_LOCKED_OUT_WITH_ENTITLEMENT");
    if (result.kind !== "NO_TRANSFER_LOCKED_OUT_WITH_ENTITLEMENT") return;
    expect(result.transferOperation.amountCents).toBe(495);
    expect(result.entitlement.amountCents).toBe(495);
  });

  it("PENDING retryCount 0 locks the existing sale TO and creates entitlement", async () => {
    const ctx = await twoSellersWithOrders();
    const prior = await saleTransfer(ctx);
    const result = await prepareFoundationReturnSellerSettlement(prisma, input(ctx));
    expect(result.kind).toBe("NO_TRANSFER_LOCKED_OUT_WITH_ENTITLEMENT");
    if (result.kind !== "NO_TRANSFER_LOCKED_OUT_WITH_ENTITLEMENT") return;
    expect(result.transferOperation.id).toBe(prior.id);
    expect(result.transferOperation.status).toBe("FAILED");
    expect(result.transferOperation.lastError).toBe(ORDER_REFUNDED_BEFORE_TRANSFER);
    expect(result.transferOperation.amountCents).toBe(9900);
    expect(result.entitlement.amountCents).toBe(1000);
  });

  it("FAILED definite no-transfer locks out and creates entitlement", async () => {
    const ctx = await twoSellersWithOrders();
    await saleTransfer(ctx, { status: "FAILED", lastError: "missing_connect_account" });
    const result = await prepareFoundationReturnSellerSettlement(prisma, input(ctx));
    expect(result.kind).toBe("NO_TRANSFER_LOCKED_OUT_WITH_ENTITLEMENT");
    if (result.kind !== "NO_TRANSFER_LOCKED_OUT_WITH_ENTITLEMENT") return;
    expect(result.transferOperation.lastError).toBe(ORDER_REFUNDED_BEFORE_TRANSFER);
    expect(result.entitlement.status).toBe("PENDING");
  });

  it("already order_refunded_before_transfer re-enters the same entitlement", async () => {
    const ctx = await twoSellersWithOrders();
    const first = await prepareFoundationReturnSellerSettlement(prisma, input(ctx));
    const second = await prepareFoundationReturnSellerSettlement(prisma, input(ctx));
    expect(first.kind).toBe("NO_TRANSFER_LOCKED_OUT_WITH_ENTITLEMENT");
    expect(second.kind).toBe("NO_TRANSFER_LOCKED_OUT_WITH_ENTITLEMENT");
    if (first.kind !== "NO_TRANSFER_LOCKED_OUT_WITH_ENTITLEMENT") return;
    if (second.kind !== "NO_TRANSFER_LOCKED_OUT_WITH_ENTITLEMENT") return;
    expect(second.entitlement.id).toBe(first.entitlement.id);
    expect(second.transferOperation.id).toBe(first.transferOperation.id);
    expect(second.transferOperation.lastError).toBe(ORDER_REFUNDED_BEFORE_TRANSFER);
  });

  it("entitlement 0 locks out the original payout and creates no entitlement row", async () => {
    const ctx = await twoSellersWithOrders();
    const result = await prepareFoundationReturnSellerSettlement(prisma, input(ctx, { entitlement: 0 }));
    expect(result.kind).toBe("NO_TRANSFER_LOCKED_OUT_ZERO_ENTITLEMENT");
    if (result.kind !== "NO_TRANSFER_LOCKED_OUT_ZERO_ENTITLEMENT") return;
    expect(result.transferOperation?.status).toBe("FAILED");
    expect(result.transferOperation?.lastError).toBe(ORDER_REFUNDED_BEFORE_TRANSFER);
    expect(result.transferOperation?.amountCents).toBe(9900);
    const row = await prisma.sellerReturnEntitlementOperation.findUnique({
      where: { storeOrderId: ctx.orderA.id },
    });
    expect(row).toBeNull();
  });

  it("original sale transfer 0 with entitlement 0 creates no TO and no entitlement", async () => {
    const ctx = await twoSellersWithOrders();
    const result = await prepareFoundationReturnSellerSettlement(
      prisma,
      input(ctx, { original: 0, entitlement: 0 })
    );
    expect(result).toEqual({ kind: "NO_TRANSFER_LOCKED_OUT_ZERO_ENTITLEMENT", transferOperation: null });
    expect(await prisma.transferOperation.findUnique({ where: { storeOrderId: ctx.orderA.id } })).toBeNull();
    expect(
      await prisma.sellerReturnEntitlementOperation.findUnique({ where: { storeOrderId: ctx.orderA.id } })
    ).toBeNull();
  });

  it("SUCCEEDED with Stripe id returns reversal classification and creates no entitlement", async () => {
    const ctx = await twoSellersWithOrders();
    const prior = await saleTransfer(ctx, { status: "SUCCEEDED", stripeTransferId: `tr_${ctx.orderA.id}` });
    const result = await prepareFoundationReturnSellerSettlement(prisma, input(ctx));
    expect(result.kind).toBe("ORIGINAL_TRANSFER_SUCCEEDED");
    if (result.kind !== "ORIGINAL_TRANSFER_SUCCEEDED") return;
    expect(result.stripeTransferId).toBe(prior.stripeTransferId);
    expect(result.transferOperation.status).toBe("SUCCEEDED");
    expect(
      await prisma.sellerReturnEntitlementOperation.findUnique({ where: { storeOrderId: ctx.orderA.id } })
    ).toBeNull();
  });

  it("PROCESSING fails closed without entitlement", async () => {
    const ctx = await twoSellersWithOrders();
    await saleTransfer(ctx, { status: "PROCESSING" });
    await expect(prepareFoundationReturnSellerSettlement(prisma, input(ctx))).rejects.toBeInstanceOf(
      FoundationTransferRefundBlockedError
    );
    expect(
      await prisma.sellerReturnEntitlementOperation.findUnique({ where: { storeOrderId: ctx.orderA.id } })
    ).toBeNull();
  });

  it("UNCERTAIN fails closed without entitlement", async () => {
    const ctx = await twoSellersWithOrders();
    await saleTransfer(ctx, { status: "UNCERTAIN" });
    await expect(prepareFoundationReturnSellerSettlement(prisma, input(ctx))).rejects.toBeInstanceOf(
      FoundationTransferRefundBlockedError
    );
    expect(
      await prisma.sellerReturnEntitlementOperation.findUnique({ where: { storeOrderId: ctx.orderA.id } })
    ).toBeNull();
  });

  it("SUCCEEDED without transfer ID fails closed", async () => {
    const ctx = await twoSellersWithOrders();
    await saleTransfer(ctx, { status: "SUCCEEDED", stripeTransferId: null });
    await expect(prepareFoundationReturnSellerSettlement(prisma, input(ctx))).rejects.toBeInstanceOf(
      FoundationTransferRefundBlockedError
    );
  });

  it("PENDING retryCount > 0 fails closed", async () => {
    const ctx = await twoSellersWithOrders();
    await saleTransfer(ctx, { retryCount: 1 });
    await expect(prepareFoundationReturnSellerSettlement(prisma, input(ctx))).rejects.toBeInstanceOf(
      FoundationTransferRefundBlockedError
    );
    expect(
      await prisma.sellerReturnEntitlementOperation.findUnique({ where: { storeOrderId: ctx.orderA.id } })
    ).toBeNull();
  });

  it("changed entitlement amount is an intent conflict", async () => {
    const ctx = await twoSellersWithOrders();
    await prepareFoundationReturnSellerSettlement(prisma, input(ctx, { entitlement: 1000 }));
    await expect(
      prepareFoundationReturnSellerSettlement(prisma, input(ctx, { entitlement: 495 }))
    ).rejects.toBeInstanceOf(FoundationReturnEntitlementIntentConflictError);
  });

  it("changed StoreReturn is an intent conflict", async () => {
    const ctx = await twoSellersWithOrders();
    await prepareFoundationReturnSellerSettlement(prisma, input(ctx));
    const extraReturn = await createStoreReturn(prisma, { orderId: ctx.orderA.id });
    await expect(
      prepareFoundationReturnSellerSettlement(prisma, input(ctx, { storeReturnId: extraReturn.id }))
    ).rejects.toBeInstanceOf(FoundationReturnEntitlementIntentConflictError);
  });

  it("paid-first SUCCEEDED plus an existing entitlement row fails closed", async () => {
    const ctx = await twoSellersWithOrders();
    await prisma.sellerReturnEntitlementOperation.create({
      data: entitlementData({
        memberId: ctx.sellerA.id,
        storeOrderId: ctx.orderA.id,
        storeReturnId: ctx.returnA.id,
        amountCents: 1000,
        providerIdempotencyKey: foundationReturnEntitlementIdempotencyKey(ctx.orderA.id),
      }),
    });
    await saleTransfer(ctx, { status: "SUCCEEDED", stripeTransferId: `tr_paid_${ctx.orderA.id}` });
    await expect(prepareFoundationReturnSellerSettlement(prisma, input(ctx))).rejects.toBeInstanceOf(
      FoundationReturnEntitlementIntentConflictError
    );
  });

  it("zero expected entitlement plus existing positive row is a conflict", async () => {
    const ctx = await twoSellersWithOrders();
    await saleTransfer(ctx);
    await prisma.sellerReturnEntitlementOperation.create({
      data: entitlementData({
        memberId: ctx.sellerA.id,
        storeOrderId: ctx.orderA.id,
        storeReturnId: ctx.returnA.id,
        amountCents: 1000,
        providerIdempotencyKey: foundationReturnEntitlementIdempotencyKey(ctx.orderA.id),
      }),
    });
    await expect(
      prepareFoundationReturnSellerSettlement(prisma, input(ctx, { entitlement: 0 }))
    ).rejects.toBeInstanceOf(FoundationReturnEntitlementIntentConflictError);
    const to = await prisma.transferOperation.findUnique({ where: { storeOrderId: ctx.orderA.id } });
    expect(to?.status).toBe("PENDING");
    expect(to?.lastError).toBeNull();
  });

  it("atomic conflict rollback leaves the original PENDING TO unchanged", async () => {
    const ctx = await twoSellersWithOrders();
    const prior = await saleTransfer(ctx);
    await prisma.sellerReturnEntitlementOperation.create({
      data: entitlementData({
        memberId: ctx.sellerA.id,
        storeOrderId: ctx.orderA.id,
        storeReturnId: ctx.returnA.id,
        amountCents: 500,
        providerIdempotencyKey: foundationReturnEntitlementIdempotencyKey(ctx.orderA.id),
      }),
    });
    await expect(prepareFoundationReturnSellerSettlement(prisma, input(ctx, { entitlement: 1000 }))).rejects.toBeInstanceOf(
      FoundationReturnEntitlementIntentConflictError
    );
    const to = await prisma.transferOperation.findUnique({ where: { id: prior.id } });
    expect(to?.status).toBe("PENDING");
    expect(to?.lastError).toBeNull();
    expect(to?.amountCents).toBe(9900);
  });

  it("missing-TO conflict rollback creates no TransferOperation", async () => {
    const ctx = await twoSellersWithOrders();
    await prisma.sellerReturnEntitlementOperation.create({
      data: entitlementData({
        memberId: ctx.sellerA.id,
        storeOrderId: ctx.orderA.id,
        storeReturnId: ctx.returnA.id,
        amountCents: 500,
        providerIdempotencyKey: foundationReturnEntitlementIdempotencyKey(ctx.orderA.id),
      }),
    });
    await expect(prepareFoundationReturnSellerSettlement(prisma, input(ctx))).rejects.toBeInstanceOf(
      FoundationReturnEntitlementIntentConflictError
    );
    expect(await prisma.transferOperation.findUnique({ where: { storeOrderId: ctx.orderA.id } })).toBeNull();
  });

  it("rejects StoreReturn statuses other than received", async () => {
    const ctx = await twoSellersWithOrders();
    for (const status of ["requested", "awaiting_return", "declined"] as const) {
      const otherReturn = await createStoreReturn(prisma, { orderId: ctx.orderB.id, status });
      await expect(
        prepareFoundationReturnSellerSettlement(prisma, {
          storeOrderId: ctx.orderB.id,
          memberId: ctx.sellerB.id,
          storeReturnId: otherReturn.id,
          originalSaleTransferCents: 9900,
          entitlementAmountCents: 1000,
        })
      ).rejects.toBeInstanceOf(FoundationReturnEntitlementCausalError);
    }
    expect(
      await prisma.sellerReturnEntitlementOperation.findUnique({ where: { storeOrderId: ctx.orderB.id } })
    ).toBeNull();
  });

  it("rejects entitlement greater than the original sale transfer", async () => {
    const ctx = await twoSellersWithOrders();
    await expect(
      prepareFoundationReturnSellerSettlement(prisma, input(ctx, { original: 495, entitlement: 900 }))
    ).rejects.toBeInstanceOf(FoundationReturnEntitlementCausalError);
  });

  it("sale TO identity mismatch is a transfer intent conflict", async () => {
    const ctx = await twoSellersWithOrders();
    await saleTransfer(ctx, { amountCents: 8800 });
    await expect(prepareFoundationReturnSellerSettlement(prisma, input(ctx))).rejects.toBeInstanceOf(
      FoundationTransferIntentConflictError
    );
  });
});

const TEST_SNAPSHOT = {
  stripeDestinationAccountId: "acct_A",
  stripeSourceChargeId: "ch_A",
};

type EntitlementSeedOpts = {
  status?: "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "UNCERTAIN";
  retryCount?: number;
  createdAt?: Date;
  lastAttemptAt?: Date | null;
  stripeTransferId?: string | null;
  amountCents?: number;
  lastError?: string | null;
  orderStatus?: string;
  returnStatus?: string;
  succeededAt?: Date | null;
  stripeDestinationAccountId?: string | null;
  stripeSourceChargeId?: string | null;
};

async function seedEntitlement(opts: EntitlementSeedOpts = {}) {
  const ctx = await twoSellersWithOrders();
  if (opts.orderStatus) {
    await prisma.storeOrder.update({ where: { id: ctx.orderA.id }, data: { status: opts.orderStatus } });
  }
  if (opts.returnStatus) {
    await prisma.storeReturn.update({ where: { id: ctx.returnA.id }, data: { status: opts.returnStatus } });
  }
  const retryCount = opts.retryCount ?? 0;
  const snapshotDefaults =
    retryCount > 0
      ? {
          stripeDestinationAccountId: TEST_SNAPSHOT.stripeDestinationAccountId,
          stripeSourceChargeId: TEST_SNAPSHOT.stripeSourceChargeId,
        }
      : {};
  const row = await prisma.sellerReturnEntitlementOperation.create({
    data: {
      ...entitlementData({
        memberId: ctx.sellerA.id,
        storeOrderId: ctx.orderA.id,
        storeReturnId: ctx.returnA.id,
        amountCents: opts.amountCents,
        retryCount: opts.retryCount,
        providerIdempotencyKey: foundationReturnEntitlementIdempotencyKey(ctx.orderA.id),
        stripeTransferId: opts.stripeTransferId,
      }),
      status: opts.status ?? "PENDING",
      lastError: opts.lastError,
      lastAttemptAt: opts.lastAttemptAt,
      succeededAt: opts.succeededAt,
      ...snapshotDefaults,
      ...(opts.stripeDestinationAccountId !== undefined
        ? { stripeDestinationAccountId: opts.stripeDestinationAccountId }
        : {}),
      ...(opts.stripeSourceChargeId !== undefined ? { stripeSourceChargeId: opts.stripeSourceChargeId } : {}),
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    },
  });
  return { ...ctx, entitlement: row };
}

describe("SellerReturnEntitlementOperation provider state machine (Unit 3)", () => {
  it("begins PENDING retryCount 0 → PROCESSING, increments retryCount, and sets lastAttemptAt", async () => {
    const { orderA, entitlement } = await seedEntitlement();
    const now = new Date("2026-03-01T00:00:00.000Z");
    const needs = await beginFoundationReturnEntitlementAttempt(prisma, {
      storeOrderId: orderA.id,
      now,
    });
    expect(needs.action).toBe("needs_provider_snapshot");
    if (needs.action !== "needs_provider_snapshot") return;
    expect(needs.operation.status).toBe("PENDING");
    expect(needs.operation.retryCount).toBe(0);

    const began = await beginFoundationReturnEntitlementAttempt(prisma, {
      storeOrderId: orderA.id,
      now,
      providerSnapshot: TEST_SNAPSHOT,
    });
    expect(began.action).toBe("provider_create");
    if (began.action !== "provider_create") return;
    expect(began.operation.status).toBe("PROCESSING");
    expect(began.operation.retryCount).toBe((entitlement.retryCount ?? 0) + 1);
    expect(began.operation.lastAttemptAt?.toISOString()).toBe(now.toISOString());
    expect(began.operation.providerIdempotencyKey).toBe(foundationReturnEntitlementIdempotencyKey(orderA.id));
    expect(began.operation.amountCents).toBe(1000);
    expect(began.operation.stripeDestinationAccountId).toBe(TEST_SNAPSHOT.stripeDestinationAccountId);
    expect(began.operation.stripeSourceChargeId).toBe(TEST_SNAPSHOT.stripeSourceChargeId);
  });

  it("allows a first PENDING retryCount 0 attempt regardless of row age", async () => {
    const t0 = new Date("2026-01-01T00:00:00.000Z");
    const now = new Date(t0.getTime() + 48 * 60 * 60 * 1000);
    const { orderA } = await seedEntitlement({ createdAt: t0, retryCount: 0, status: "PENDING" });
    const began = await beginFoundationReturnEntitlementAttempt(prisma, {
      storeOrderId: orderA.id,
      now,
      providerSnapshot: TEST_SNAPSHOT,
    });
    expect(began.action).toBe("provider_create");
    expect(isFoundationSameKeyReplayAllowed({ retryCount: 0, createdAt: t0, now })).toBe(true);
  });

  it("skips fresh PROCESSING without incrementing retryCount", async () => {
    const now = new Date("2026-03-01T00:00:00.000Z");
    const { orderA } = await seedEntitlement({
      status: "PROCESSING",
      retryCount: 1,
      lastAttemptAt: now,
    });
    const began = await beginFoundationReturnEntitlementAttempt(prisma, { storeOrderId: orderA.id, now });
    expect(began.action).toBe("skip_in_flight");
    if (began.action !== "skip_in_flight") return;
    expect(began.operation.retryCount).toBe(1);
    expect(began.operation.status).toBe("PROCESSING");
  });

  it("allows stale PROCESSING replay inside the 23h window", async () => {
    const t0 = new Date("2026-03-01T00:00:00.000Z");
    const staleAt = new Date(t0.getTime() + FOUNDATION_TRANSFER_PROCESSING_STALE_MS + 1_000);
    const { orderA } = await seedEntitlement({
      status: "PROCESSING",
      retryCount: 1,
      createdAt: t0,
      lastAttemptAt: t0,
    });
    const began = await beginFoundationReturnEntitlementAttempt(prisma, {
      storeOrderId: orderA.id,
      now: staleAt,
    });
    expect(began.action).toBe("provider_create");
    if (began.action !== "provider_create") return;
    expect(began.operation.retryCount).toBe(2);
    expect(began.operation.providerIdempotencyKey).toBe(foundationReturnEntitlementIdempotencyKey(orderA.id));
  });

  it("allows UNCERTAIN replay inside the 23h window", async () => {
    const t0 = new Date("2026-03-01T00:00:00.000Z");
    const t20 = new Date(t0.getTime() + 20 * 60 * 60 * 1000);
    const { orderA } = await seedEntitlement({
      status: "UNCERTAIN",
      retryCount: 1,
      createdAt: t0,
      lastAttemptAt: t0,
      lastError: "timeout",
    });
    const began = await beginFoundationReturnEntitlementAttempt(prisma, { storeOrderId: orderA.id, now: t20 });
    expect(began.action).toBe("provider_create");
    if (began.action !== "provider_create") return;
    expect(began.operation.providerIdempotencyKey).toBe(foundationReturnEntitlementIdempotencyKey(orderA.id));
  });

  it("expires same-key replay outside the 23h window", async () => {
    const t0 = new Date("2026-03-01T00:00:00.000Z");
    const t30 = new Date(t0.getTime() + 30 * 60 * 60 * 1000);
    const { orderA } = await seedEntitlement({
      status: "UNCERTAIN",
      retryCount: 1,
      createdAt: t0,
      lastAttemptAt: t0,
      lastError: "timeout",
    });
    const began = await beginFoundationReturnEntitlementAttempt(prisma, { storeOrderId: orderA.id, now: t30 });
    expect(began.action).toBe("operator_required");
    if (began.action !== "operator_required") return;
    expect(began.reason).toBe("uncertain_replay_window_elapsed");
    expect(isFoundationSameKeyReplayAllowed({ retryCount: 1, createdAt: t0, now: t30 })).toBe(false);
  });

  it("expires stale PROCESSING outside the 23h window without provider_create", async () => {
    const t0 = new Date("2026-03-01T00:00:00.000Z");
    const t30 = new Date(t0.getTime() + 30 * 60 * 60 * 1000);
    const { orderA } = await seedEntitlement({
      status: "PROCESSING",
      retryCount: 1,
      createdAt: t0,
      lastAttemptAt: t0,
    });
    const began = await beginFoundationReturnEntitlementAttempt(prisma, { storeOrderId: orderA.id, now: t30 });
    expect(began.action).toBe("operator_required");
    if (began.action !== "operator_required") return;
    expect(began.reason).toBe("uncertain_replay_window_elapsed");
    expect(began.operation.status).toBe("UNCERTAIN");
  });

  it("does not auto-retry FAILED", async () => {
    const { orderA } = await seedEntitlement({
      status: "FAILED",
      retryCount: 1,
      lastError: "missing_connect_account",
    });
    const began = await beginFoundationReturnEntitlementAttempt(prisma, { storeOrderId: orderA.id });
    expect(began.action).toBe("skip_failed");
  });

  it("SUCCEEDED with transfer ID is already-success", async () => {
    const { orderA } = await seedEntitlement({
      status: "SUCCEEDED",
      stripeTransferId: "tr_ent_exist",
      retryCount: 1,
      succeededAt: new Date(),
    });
    const began = await beginFoundationReturnEntitlementAttempt(prisma, { storeOrderId: orderA.id });
    expect(began.action).toBe("already_succeeded");
    if (began.action !== "already_succeeded") return;
    expect(began.operation.stripeTransferId).toBe("tr_ent_exist");
  });

  it("SUCCEEDED missing transfer ID fails closed", async () => {
    const { orderA } = await seedEntitlement({
      status: "SUCCEEDED",
      stripeTransferId: null,
      retryCount: 1,
    });
    const began = await beginFoundationReturnEntitlementAttempt(prisma, { storeOrderId: orderA.id });
    expect(began.action).toBe("operator_required");
    if (began.action !== "operator_required") return;
    expect(began.reason).toBe(FOUNDATION_TRANSFER_SUCCEEDED_WITHOUT_ID);
  });

  it("does not require StoreReturn received or StoreOrder paid to begin", async () => {
    const { orderA } = await seedEntitlement({
      status: "PENDING",
      orderStatus: "refunded",
      returnStatus: "requested",
    });
    const began = await beginFoundationReturnEntitlementAttempt(prisma, {
      storeOrderId: orderA.id,
      providerSnapshot: TEST_SNAPSHOT,
    });
    expect(began.action).toBe("provider_create");
  });

  it("returns not_found when no entitlement row exists", async () => {
    const ctx = await twoSellersWithOrders();
    const began = await beginFoundationReturnEntitlementAttempt(prisma, { storeOrderId: ctx.orderA.id });
    expect(began.action).toBe("not_found");
  });

  it("persists success and preserves immutable identity fields", async () => {
    const { orderA, sellerA, returnA, entitlement } = await seedEntitlement({
      status: "PROCESSING",
      retryCount: 1,
    });
    const updated = await persistFoundationReturnEntitlementSuccess(prisma, {
      storeOrderId: orderA.id,
      stripeTransferId: "tr_ent_1",
    });
    expect(updated.status).toBe("SUCCEEDED");
    expect(updated.stripeTransferId).toBe("tr_ent_1");
    expect(updated.succeededAt).toBeTruthy();
    expect(updated.lastError).toBeNull();
    expect(updated.amountCents).toBe(entitlement.amountCents);
    expect(updated.currency).toBe(entitlement.currency);
    expect(updated.providerIdempotencyKey).toBe(entitlement.providerIdempotencyKey);
    expect(updated.memberId).toBe(sellerA.id);
    expect(updated.storeOrderId).toBe(orderA.id);
    expect(updated.storeReturnId).toBe(returnA.id);
    expect(updated.stripeDestinationAccountId).toBe(TEST_SNAPSHOT.stripeDestinationAccountId);
    expect(updated.stripeSourceChargeId).toBe(TEST_SNAPSHOT.stripeSourceChargeId);
    const order = await prisma.storeOrder.findUnique({ where: { id: orderA.id } });
    expect(order?.stripeSellerTransferId).toBeNull();
  });

  it("persist success with the same transfer ID is idempotent", async () => {
    const { orderA } = await seedEntitlement({ status: "PROCESSING", retryCount: 1 });
    const first = await persistFoundationReturnEntitlementSuccess(prisma, {
      storeOrderId: orderA.id,
      stripeTransferId: "tr_ent_same",
    });
    const second = await persistFoundationReturnEntitlementSuccess(prisma, {
      storeOrderId: orderA.id,
      stripeTransferId: "tr_ent_same",
    });
    expect(second.id).toBe(first.id);
    expect(second.stripeTransferId).toBe("tr_ent_same");
    expect(second.status).toBe("SUCCEEDED");
  });

  it("rejects a conflicting Stripe transfer ID", async () => {
    const { orderA } = await seedEntitlement({
      status: "SUCCEEDED",
      stripeTransferId: "tr_ent_a",
      retryCount: 1,
      succeededAt: new Date(),
    });
    await expect(
      persistFoundationReturnEntitlementSuccess(prisma, {
        storeOrderId: orderA.id,
        stripeTransferId: "tr_ent_b",
      })
    ).rejects.toBeInstanceOf(FoundationReturnEntitlementIntentConflictError);
    const row = await prisma.sellerReturnEntitlementOperation.findUnique({
      where: { storeOrderId: orderA.id },
    });
    expect(row?.stripeTransferId).toBe("tr_ent_a");
  });

  it("persists FAILED and UNCERTAIN outcomes without mutating immutable fields", async () => {
    const { orderA, entitlement } = await seedEntitlement({ status: "PROCESSING", retryCount: 1 });
    const failed = await persistFoundationReturnEntitlementOutcome(prisma, {
      storeOrderId: orderA.id,
      status: "FAILED",
      lastError: "missing_connect_account",
    });
    expect(failed.status).toBe("FAILED");
    expect(failed.lastError).toBe("missing_connect_account");
    expect(failed.amountCents).toBe(entitlement.amountCents);
    expect(failed.providerIdempotencyKey).toBe(entitlement.providerIdempotencyKey);
    expect(failed.stripeTransferId).toBeNull();

    const second = await seedEntitlement({ status: "PROCESSING", retryCount: 1 });
    const uncertain = await persistFoundationReturnEntitlementOutcome(prisma, {
      storeOrderId: second.orderA.id,
      status: "UNCERTAIN",
      lastError: "timeout",
    });
    expect(uncertain.status).toBe("UNCERTAIN");
    expect(uncertain.lastError).toBe("timeout");
  });

  it("does not overwrite SUCCEEDED+id when persisting an outcome", async () => {
    const { orderA } = await seedEntitlement({
      status: "SUCCEEDED",
      stripeTransferId: "tr_keep",
      retryCount: 1,
      succeededAt: new Date(),
    });
    const row = await persistFoundationReturnEntitlementOutcome(prisma, {
      storeOrderId: orderA.id,
      status: "FAILED",
      lastError: "should_not_apply",
    });
    expect(row.status).toBe("SUCCEEDED");
    expect(row.stripeTransferId).toBe("tr_keep");
    expect(row.lastError).toBeNull();
  });

  it("credits SellerBalance once for return_entitlement and no-ops the second call", async () => {
    const { orderA, sellerA } = await seedEntitlement({
      status: "SUCCEEDED",
      stripeTransferId: "tr_ent_ledger",
      amountCents: 1000,
      retryCount: 1,
      succeededAt: new Date(),
    });
    await prisma.sellerBalance.create({
      data: {
        memberId: sellerA.id,
        balanceCents: 5000,
        totalEarnedCents: 5000,
        totalPaidOutCents: 2000,
      },
    });
    const first = await completeFoundationSellerReturnEntitlementLedger(prisma, { storeOrderId: orderA.id });
    const second = await completeFoundationSellerReturnEntitlementLedger(prisma, { storeOrderId: orderA.id });
    expect(first.ledgerCreated).toBe(true);
    expect(second.ledgerCreated).toBe(false);
    const balance = await prisma.sellerBalance.findUnique({ where: { memberId: sellerA.id } });
    expect(balance?.balanceCents).toBe(6000);
    expect(balance?.totalEarnedCents).toBe(6000);
    expect(balance?.totalPaidOutCents).toBe(2000);
    const rows = await prisma.sellerBalanceTransaction.findMany({
      where: { orderId: orderA.id, type: FOUNDATION_RETURN_ENTITLEMENT_LEDGER_TYPE },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amountCents).toBe(1000);
    expect(rows[0]?.memberId).toBe(sellerA.id);
    expect(rows[0]?.stripeTransferId).toBe("tr_ent_ledger");
    expect(rows[0]?.type).toBe("return_entitlement");
    expect(rows[0]?.type).not.toBe("sale");
  });

  it("fails closed when an existing ledger row conflicts", async () => {
    const { orderA, sellerA } = await seedEntitlement({
      status: "SUCCEEDED",
      stripeTransferId: "tr_ent_conflict",
      amountCents: 1000,
      retryCount: 1,
      succeededAt: new Date(),
    });
    await prisma.sellerBalanceTransaction.create({
      data: {
        memberId: sellerA.id,
        type: FOUNDATION_RETURN_ENTITLEMENT_LEDGER_TYPE,
        amountCents: 50,
        orderId: orderA.id,
        stripeTransferId: "tr_other",
        description: "conflict",
      },
    });
    await expect(
      completeFoundationSellerReturnEntitlementLedger(prisma, { storeOrderId: orderA.id })
    ).rejects.toBeInstanceOf(FoundationReturnEntitlementIntentConflictError);
    const balance = await prisma.sellerBalance.findUnique({ where: { memberId: sellerA.id } });
    expect(balance).toBeNull();
  });

  it("fails closed on duplicate exact return_entitlement ledger rows", async () => {
    const { orderA, sellerA } = await seedEntitlement({
      status: "SUCCEEDED",
      stripeTransferId: "tr_ent_dup",
      amountCents: 1000,
      retryCount: 1,
      succeededAt: new Date(),
    });
    await prisma.sellerBalance.create({
      data: { memberId: sellerA.id, balanceCents: 5000, totalEarnedCents: 5000 },
    });
    await prisma.sellerBalanceTransaction.createMany({
      data: [
        {
          memberId: sellerA.id,
          type: FOUNDATION_RETURN_ENTITLEMENT_LEDGER_TYPE,
          amountCents: 1000,
          orderId: orderA.id,
          stripeTransferId: "tr_ent_dup",
          description: "dup-a",
        },
        {
          memberId: sellerA.id,
          type: FOUNDATION_RETURN_ENTITLEMENT_LEDGER_TYPE,
          amountCents: 1000,
          orderId: orderA.id,
          stripeTransferId: "tr_ent_dup",
          description: "dup-b",
        },
      ],
    });
    await expect(
      completeFoundationSellerReturnEntitlementLedger(prisma, { storeOrderId: orderA.id })
    ).rejects.toBeInstanceOf(FoundationReturnEntitlementIntentConflictError);
    const balance = await prisma.sellerBalance.findUnique({ where: { memberId: sellerA.id } });
    expect(balance?.balanceCents).toBe(5000);
    const rows = await prisma.sellerBalanceTransaction.findMany({
      where: { orderId: orderA.id, type: FOUNDATION_RETURN_ENTITLEMENT_LEDGER_TYPE },
    });
    expect(rows).toHaveLength(2);
  });

  it("fails closed on exact-plus-conflict return_entitlement rows", async () => {
    const { orderA, sellerA } = await seedEntitlement({
      status: "SUCCEEDED",
      stripeTransferId: "tr_ent_mix",
      amountCents: 1000,
      retryCount: 1,
      succeededAt: new Date(),
    });
    await prisma.sellerBalanceTransaction.createMany({
      data: [
        {
          memberId: sellerA.id,
          type: FOUNDATION_RETURN_ENTITLEMENT_LEDGER_TYPE,
          amountCents: 1000,
          orderId: orderA.id,
          stripeTransferId: "tr_ent_mix",
          description: "exact",
        },
        {
          memberId: sellerA.id,
          type: FOUNDATION_RETURN_ENTITLEMENT_LEDGER_TYPE,
          amountCents: 50,
          orderId: orderA.id,
          stripeTransferId: "tr_other",
          description: "conflict",
        },
      ],
    });
    await expect(
      completeFoundationSellerReturnEntitlementLedger(prisma, { storeOrderId: orderA.id })
    ).rejects.toBeInstanceOf(FoundationReturnEntitlementIntentConflictError);
  });

  it("repairs a missing ledger after SUCCEEDED without a new provider identity", async () => {
    const { orderA, sellerA } = await seedEntitlement({
      status: "SUCCEEDED",
      stripeTransferId: "tr_ent_repair",
      amountCents: 1000,
      retryCount: 1,
      succeededAt: new Date(),
      orderStatus: "refunded",
    });
    const began = await beginFoundationReturnEntitlementAttempt(prisma, { storeOrderId: orderA.id });
    expect(began.action).toBe("already_succeeded");
    const first = await completeFoundationSellerReturnEntitlementLedger(prisma, { storeOrderId: orderA.id });
    expect(first.ledgerCreated).toBe(true);
    const balance = await prisma.sellerBalance.findUnique({ where: { memberId: sellerA.id } });
    expect(balance?.balanceCents).toBe(1000);
    expect(balance?.totalEarnedCents).toBe(1000);
    expect(balance?.totalPaidOutCents).toBe(0);
  });

  it("refuses ledger credit before confirmed provider success", async () => {
    const { orderA } = await seedEntitlement({ status: "PROCESSING", retryCount: 1 });
    await expect(
      completeFoundationSellerReturnEntitlementLedger(prisma, { storeOrderId: orderA.id })
    ).rejects.toBeInstanceOf(FoundationTransferOperatorRequiredError);
  });
});

describe("SellerReturnEntitlementOperation provider snapshot (Prompt 103)", () => {
  it("accepts retryCount 0 with null snapshots", async () => {
    const ctx = await twoSellersWithOrders();
    const row = await prisma.sellerReturnEntitlementOperation.create({
      data: entitlementData({
        memberId: ctx.sellerA.id,
        storeOrderId: ctx.orderA.id,
        storeReturnId: ctx.returnA.id,
        retryCount: 0,
      }),
    });
    expect(row.retryCount).toBe(0);
    expect(row.stripeDestinationAccountId).toBeNull();
    expect(row.stripeSourceChargeId).toBeNull();
  });

  it("accepts retryCount 0 with snapshots pre-set", async () => {
    const ctx = await twoSellersWithOrders();
    const row = await prisma.sellerReturnEntitlementOperation.create({
      data: {
        ...entitlementData({
          memberId: ctx.sellerA.id,
          storeOrderId: ctx.orderA.id,
          storeReturnId: ctx.returnA.id,
          retryCount: 0,
        }),
        stripeDestinationAccountId: "acct_pre",
        stripeSourceChargeId: "ch_pre",
      },
    });
    expect(row.retryCount).toBe(0);
    expect(row.stripeDestinationAccountId).toBe("acct_pre");
    expect(row.stripeSourceChargeId).toBe("ch_pre");
  });

  it("accepts retryCount 1 with both snapshots", async () => {
    const ctx = await twoSellersWithOrders();
    const row = await prisma.sellerReturnEntitlementOperation.create({
      data: {
        ...entitlementData({
          memberId: ctx.sellerA.id,
          storeOrderId: ctx.orderA.id,
          storeReturnId: ctx.returnA.id,
          retryCount: 1,
        }),
        stripeDestinationAccountId: "acct_ok",
        stripeSourceChargeId: "ch_ok",
      },
    });
    expect(row.retryCount).toBe(1);
    expect(row.stripeDestinationAccountId).toBe("acct_ok");
  });

  it("rejects retryCount 1 with missing destination", async () => {
    const ctx = await twoSellersWithOrders();
    await expectRejects(
      () =>
        prisma.sellerReturnEntitlementOperation.create({
          data: {
            ...entitlementData({
              memberId: ctx.sellerA.id,
              storeOrderId: ctx.orderA.id,
              storeReturnId: ctx.returnA.id,
              retryCount: 1,
            }),
            stripeDestinationAccountId: null,
            stripeSourceChargeId: "ch_only",
          },
        }),
      "check"
    );
  });

  it("rejects retryCount 1 with missing source charge", async () => {
    const ctx = await twoSellersWithOrders();
    await expectRejects(
      () =>
        prisma.sellerReturnEntitlementOperation.create({
          data: {
            ...entitlementData({
              memberId: ctx.sellerA.id,
              storeOrderId: ctx.orderA.id,
              storeReturnId: ctx.returnA.id,
              retryCount: 1,
            }),
            stripeDestinationAccountId: "acct_only",
            stripeSourceChargeId: null,
          },
        }),
      "check"
    );
  });

  it("freezes the first candidate snapshot and ignores a later different candidate", async () => {
    const { orderA } = await seedEntitlement();
    const first = await beginFoundationReturnEntitlementAttempt(prisma, {
      storeOrderId: orderA.id,
      providerSnapshot: TEST_SNAPSHOT,
    });
    expect(first.action).toBe("provider_create");
    if (first.action !== "provider_create") return;
    expect(first.operation.stripeDestinationAccountId).toBe("acct_A");
    expect(first.operation.stripeSourceChargeId).toBe("ch_A");

    const staleAt = new Date((first.operation.lastAttemptAt ?? new Date()).getTime() + FOUNDATION_TRANSFER_PROCESSING_STALE_MS + 1_000);
    const second = await beginFoundationReturnEntitlementAttempt(prisma, {
      storeOrderId: orderA.id,
      now: staleAt,
      providerSnapshot: {
        stripeDestinationAccountId: "acct_B",
        stripeSourceChargeId: "ch_B",
      },
    });
    expect(second.action).toBe("provider_create");
    if (second.action !== "provider_create") return;
    expect(second.operation.stripeDestinationAccountId).toBe("acct_A");
    expect(second.operation.stripeSourceChargeId).toBe("ch_A");
    expect(second.operation.retryCount).toBe(2);
  });

  it("PENDING retryCount > 0 uses the existing frozen snapshot rather than a new live candidate", async () => {
    const { orderA } = await seedEntitlement({
      status: "PENDING",
      retryCount: 1,
      stripeDestinationAccountId: "acct_A",
      stripeSourceChargeId: "ch_A",
    });
    const began = await beginFoundationReturnEntitlementAttempt(prisma, {
      storeOrderId: orderA.id,
      providerSnapshot: {
        stripeDestinationAccountId: "acct_B",
        stripeSourceChargeId: "ch_B",
      },
    });
    expect(began.action).toBe("provider_create");
    if (began.action !== "provider_create") return;
    expect(began.operation.stripeDestinationAccountId).toBe("acct_A");
    expect(began.operation.stripeSourceChargeId).toBe("ch_A");
  });

  it("attempted row with empty snapshot fields is UNCERTAIN/operator and never reconstructs", async () => {
    const { orderA } = await seedEntitlement({
      status: "UNCERTAIN",
      retryCount: 1,
      lastError: "timeout",
      stripeDestinationAccountId: "",
      stripeSourceChargeId: "",
    });
    const began = await beginFoundationReturnEntitlementAttempt(prisma, {
      storeOrderId: orderA.id,
      providerSnapshot: TEST_SNAPSHOT,
    });
    expect(began.action).toBe("operator_required");
    if (began.action !== "operator_required") return;
    expect(began.reason).toBe(FOUNDATION_RETURN_ENTITLEMENT_SNAPSHOT_MISSING_AFTER_ATTEMPT);
    expect(began.operation.status).toBe("UNCERTAIN");
    expect(began.operation.stripeDestinationAccountId).toBe("");
    expect(began.operation.retryCount).toBe(1);
  });

  it("preflight failure marks FAILED only while still PENDING retryCount 0 with no snapshot", async () => {
    const { orderA } = await seedEntitlement();
    const failed = await persistFoundationReturnEntitlementPreflightFailure(prisma, {
      storeOrderId: orderA.id,
      lastError: "missing_connect_account",
    });
    expect(failed.kind).toBe("failed");
    if (failed.kind !== "failed") return;
    expect(failed.operation.status).toBe("FAILED");
    expect(failed.operation.retryCount).toBe(0);
    expect(failed.operation.stripeDestinationAccountId).toBeNull();
    expect(failed.operation.lastError).toBe("missing_connect_account");
  });

  it("preflight failure does not overwrite PROCESSING with a valid snapshot", async () => {
    const { orderA } = await seedEntitlement({
      status: "PROCESSING",
      retryCount: 1,
      lastAttemptAt: new Date(),
    });
    const result = await persistFoundationReturnEntitlementPreflightFailure(prisma, {
      storeOrderId: orderA.id,
      lastError: "missing_charge",
    });
    expect(result.kind).toBe("state_changed");
    if (result.kind !== "state_changed") return;
    expect(result.operation.status).toBe("PROCESSING");
    expect(result.operation.retryCount).toBe(1);
    expect(result.operation.stripeDestinationAccountId).toBe(TEST_SNAPSHOT.stripeDestinationAccountId);
    expect(result.operation.lastError).not.toBe("missing_charge");
  });

  it("serializes two concurrent first-attempt begins: first snapshot wins and the loser is in-flight", async () => {
    const { orderA } = await seedEntitlement();
    const now = new Date("2026-03-01T00:00:00.000Z");
    const [a, b] = await Promise.all([
      beginFoundationReturnEntitlementAttempt(prisma, {
        storeOrderId: orderA.id,
        now,
        providerSnapshot: { stripeDestinationAccountId: "acct_A", stripeSourceChargeId: "ch_A" },
      }),
      beginFoundationReturnEntitlementAttempt(prisma, {
        storeOrderId: orderA.id,
        now,
        providerSnapshot: { stripeDestinationAccountId: "acct_B", stripeSourceChargeId: "ch_B" },
      }),
    ]);
    const actions = [a.action, b.action].sort();
    expect(actions).toEqual(["provider_create", "skip_in_flight"]);
    const winner = a.action === "provider_create" ? a : b;
    const loser = a.action === "skip_in_flight" ? a : b;
    if (winner.action !== "provider_create" || loser.action !== "skip_in_flight") return;
    expect(winner.operation.retryCount).toBe(1);
    expect(["acct_A", "acct_B"]).toContain(winner.operation.stripeDestinationAccountId);
    expect(loser.operation.stripeDestinationAccountId).toBe(winner.operation.stripeDestinationAccountId);
    expect(loser.operation.stripeSourceChargeId).toBe(winner.operation.stripeSourceChargeId);
    expect(loser.operation.retryCount).toBe(1);
    const row = await prisma.sellerReturnEntitlementOperation.findUnique({ where: { storeOrderId: orderA.id } });
    expect(row?.stripeDestinationAccountId).toBe(winner.operation.stripeDestinationAccountId);
    expect(row?.retryCount).toBe(1);
  });

  it("serializes two stale PROCESSING replays: only one provider_create", async () => {
    const t0 = new Date("2026-03-01T00:00:00.000Z");
    const staleAt = new Date(t0.getTime() + FOUNDATION_TRANSFER_PROCESSING_STALE_MS + 1_000);
    const { orderA } = await seedEntitlement({
      status: "PROCESSING",
      retryCount: 1,
      createdAt: t0,
      lastAttemptAt: t0,
    });
    const [a, b] = await Promise.all([
      beginFoundationReturnEntitlementAttempt(prisma, { storeOrderId: orderA.id, now: staleAt }),
      beginFoundationReturnEntitlementAttempt(prisma, { storeOrderId: orderA.id, now: staleAt }),
    ]);
    const actions = [a.action, b.action].sort();
    expect(actions).toEqual(["provider_create", "skip_in_flight"]);
    const winner = a.action === "provider_create" ? a : b;
    if (winner.action !== "provider_create") return;
    expect(winner.operation.retryCount).toBe(2);
    expect(winner.operation.stripeDestinationAccountId).toBe(TEST_SNAPSHOT.stripeDestinationAccountId);
    expect(winner.operation.stripeSourceChargeId).toBe(TEST_SNAPSHOT.stripeSourceChargeId);
  });

  it("serializes concurrent ledger repair: exactly one credit", async () => {
    const { orderA, sellerA } = await seedEntitlement({
      status: "SUCCEEDED",
      stripeTransferId: "tr_ent_conc_ledger",
      amountCents: 1000,
      retryCount: 1,
      succeededAt: new Date(),
    });
    const [first, second] = await Promise.all([
      completeFoundationSellerReturnEntitlementLedger(prisma, { storeOrderId: orderA.id }),
      completeFoundationSellerReturnEntitlementLedger(prisma, { storeOrderId: orderA.id }),
    ]);
    expect([first.ledgerCreated, second.ledgerCreated].sort()).toEqual([false, true]);
    const balance = await prisma.sellerBalance.findUnique({ where: { memberId: sellerA.id } });
    expect(balance?.balanceCents).toBe(1000);
    expect(balance?.totalEarnedCents).toBe(1000);
    expect(balance?.totalPaidOutCents).toBe(0);
    const rows = await prisma.sellerBalanceTransaction.findMany({
      where: { orderId: orderA.id, type: FOUNDATION_RETURN_ENTITLEMENT_LEDGER_TYPE },
    });
    expect(rows).toHaveLength(1);
  });

  it("recovers persist-success failure from real PROCESSING with frozen snapshot", async () => {
    const t0 = new Date("2026-03-01T00:00:00.000Z");
    const { orderA, sellerA } = await seedEntitlement({ createdAt: t0, retryCount: 0, status: "PENDING" });
    const began = await beginFoundationReturnEntitlementAttempt(prisma, {
      storeOrderId: orderA.id,
      now: t0,
      providerSnapshot: TEST_SNAPSHOT,
    });
    expect(began.action).toBe("provider_create");
    if (began.action !== "provider_create") return;
    expect(began.operation.status).toBe("PROCESSING");
    expect(began.operation.retryCount).toBe(1);
    expect(began.operation.stripeDestinationAccountId).toBe("acct_A");
    expect(began.operation.stripeSourceChargeId).toBe("ch_A");

    const durable = await prisma.sellerReturnEntitlementOperation.findUnique({ where: { storeOrderId: orderA.id } });
    expect(durable?.status).toBe("PROCESSING");
    expect(durable?.stripeDestinationAccountId).toBe("acct_A");

    const replayNow = new Date(t0.getTime() + FOUNDATION_TRANSFER_PROCESSING_STALE_MS + 1_000);
    const replay = await beginFoundationReturnEntitlementAttempt(prisma, {
      storeOrderId: orderA.id,
      now: replayNow,
      providerSnapshot: { stripeDestinationAccountId: "acct_B", stripeSourceChargeId: "ch_B" },
    });
    expect(replay.action).toBe("provider_create");
    if (replay.action !== "provider_create") return;
    expect(replay.operation.retryCount).toBe(2);
    expect(replay.operation.stripeDestinationAccountId).toBe("acct_A");
    expect(replay.operation.stripeSourceChargeId).toBe("ch_A");
    expect(replay.operation.providerIdempotencyKey).toBe(foundationReturnEntitlementIdempotencyKey(orderA.id));

    const succeeded = await persistFoundationReturnEntitlementSuccess(prisma, {
      storeOrderId: orderA.id,
      stripeTransferId: "tr_ent_recover",
    });
    expect(succeeded.status).toBe("SUCCEEDED");
    expect(succeeded.stripeDestinationAccountId).toBe("acct_A");

    const firstLedger = await completeFoundationSellerReturnEntitlementLedger(prisma, { storeOrderId: orderA.id });
    const secondLedger = await completeFoundationSellerReturnEntitlementLedger(prisma, { storeOrderId: orderA.id });
    expect(firstLedger.ledgerCreated).toBe(true);
    expect(secondLedger.ledgerCreated).toBe(false);
    const balance = await prisma.sellerBalance.findUnique({ where: { memberId: sellerA.id } });
    expect(balance?.balanceCents).toBe(1000);
    expect(balance?.totalPaidOutCents).toBe(0);
  });
});

describe("SellerReturnEntitlementOperation admin reset (Unit 5B, real PostgreSQL)", () => {
  const windowMs = FOUNDATION_TRANSFER_IDEMPOTENCY_WINDOW_MS;

  it("pure eligibility: FAILED retry0 allowed at any age; retry>=1 missing snapshot refused", () => {
    const createdAt = new Date("2020-01-01T00:00:00.000Z");
    const now = new Date("2026-09-23T00:00:00.000Z");
    expect(
      evaluateFoundationReturnEntitlementResetEligibility({
        status: "FAILED",
        retryCount: 0,
        createdAt,
        stripeDestinationAccountId: null,
        stripeSourceChargeId: null,
        now,
      })
    ).toEqual({ allowed: true });

    expect(
      evaluateFoundationReturnEntitlementResetEligibility({
        status: "FAILED",
        retryCount: 1,
        createdAt: now,
        stripeDestinationAccountId: null,
        stripeSourceChargeId: null,
        now,
      })
    ).toEqual({ allowed: false, reason: "SNAPSHOT_MISSING" });

    for (const status of ["PENDING", "PROCESSING", "UNCERTAIN", "SUCCEEDED"] as const) {
      expect(
        evaluateFoundationReturnEntitlementResetEligibility({
          status,
          retryCount: 0,
          createdAt: now,
          stripeDestinationAccountId: null,
          stripeSourceChargeId: null,
          now,
        })
      ).toEqual({ allowed: false, reason: status });
    }
  });

  it("FAILED retryCount 0 old row resets to PENDING and preserves identity fields", async () => {
    const t0 = new Date("2026-01-01T00:00:00.000Z");
    const now = new Date(t0.getTime() + 48 * 60 * 60 * 1000);
    const { orderA, entitlement } = await seedEntitlement({
      status: "FAILED",
      retryCount: 0,
      createdAt: t0,
      lastError: "missing_connect",
      lastAttemptAt: t0,
      amountCents: 1500,
    });
    const before = await prisma.sellerReturnEntitlementOperation.findUniqueOrThrow({
      where: { id: entitlement.id },
    });

    const result = await resetFoundationSellerReturnEntitlementForRetry(prisma, {
      storeOrderId: orderA.id,
      now,
    });
    expect(result.kind).toBe("RESET");
    if (result.kind !== "RESET") return;

    expect(result.operation.status).toBe("PENDING");
    expect(result.operation.lastError).toBe(OPERATOR_RESET_FOR_RETRY);
    expect(result.operation.retryCount).toBe(0);
    expect(result.operation.createdAt.toISOString()).toBe(before.createdAt.toISOString());
    expect(result.operation.providerIdempotencyKey).toBe(before.providerIdempotencyKey);
    expect(result.operation.stripeDestinationAccountId).toBe(before.stripeDestinationAccountId);
    expect(result.operation.stripeSourceChargeId).toBe(before.stripeSourceChargeId);
    expect(result.operation.stripeTransferId).toBe(before.stripeTransferId);
    expect(result.operation.amountCents).toBe(1500);
    expect(result.operation.currency).toBe(before.currency);
    expect(result.operation.lastAttemptAt?.toISOString()).toBe(before.lastAttemptAt?.toISOString());

    const admin = await getFoundationReturnEntitlementAdminState(prisma, {
      storeOrderId: orderA.id,
      now,
    });
    expect(admin?.status).toBe("PENDING");
    expect(admin?.resetAllowed).toBe(false);
    expect(admin?.resetBlockedReason).toBe("PENDING");
  });

  it("FAILED retryCount>=1 inside window resets and preserves frozen snapshot", async () => {
    const t0 = new Date("2026-03-01T00:00:00.000Z");
    const now = new Date(t0.getTime() + 10 * 60 * 60 * 1000);
    const { orderA, entitlement } = await seedEntitlement({
      status: "FAILED",
      retryCount: 1,
      createdAt: t0,
      lastError: "stripe_failed",
      lastAttemptAt: t0,
    });
    const before = await prisma.sellerReturnEntitlementOperation.findUniqueOrThrow({
      where: { id: entitlement.id },
    });
    expect(before.stripeDestinationAccountId).toBe(TEST_SNAPSHOT.stripeDestinationAccountId);
    expect(before.stripeSourceChargeId).toBe(TEST_SNAPSHOT.stripeSourceChargeId);

    const result = await resetFoundationSellerReturnEntitlementForRetry(prisma, {
      storeOrderId: orderA.id,
      now,
    });
    expect(result.kind).toBe("RESET");
    if (result.kind !== "RESET") return;
    expect(result.operation.status).toBe("PENDING");
    expect(result.operation.retryCount).toBe(1);
    expect(result.operation.createdAt.toISOString()).toBe(before.createdAt.toISOString());
    expect(result.operation.providerIdempotencyKey).toBe(
      foundationReturnEntitlementIdempotencyKey(orderA.id)
    );
    expect(result.operation.stripeDestinationAccountId).toBe(TEST_SNAPSHOT.stripeDestinationAccountId);
    expect(result.operation.stripeSourceChargeId).toBe(TEST_SNAPSHOT.stripeSourceChargeId);
    expect(result.operation.stripeTransferId).toBeNull();
    expect(result.operation.lastError).toBe(OPERATOR_RESET_FOR_RETRY);
  });

  it("exact 23h boundary allows reset; 23h+1ms refuses with no write", async () => {
    const t0 = new Date("2026-03-01T00:00:00.000Z");
    const atExact = new Date(t0.getTime() + windowMs);
    const past = new Date(t0.getTime() + windowMs + 1);
    const { orderA, entitlement } = await seedEntitlement({
      status: "FAILED",
      retryCount: 2,
      createdAt: t0,
      lastError: "stripe_failed",
    });

    const allowed = await resetFoundationSellerReturnEntitlementForRetry(prisma, {
      storeOrderId: orderA.id,
      now: atExact,
    });
    expect(allowed.kind).toBe("RESET");
    if (allowed.kind !== "RESET") return;
    expect(allowed.operation.status).toBe("PENDING");

    // Re-fail under lock-free update so we can exercise the expired window path.
    await prisma.sellerReturnEntitlementOperation.update({
      where: { id: entitlement.id },
      data: { status: "FAILED", lastError: "stripe_failed_again" },
    });

    const refused = await resetFoundationSellerReturnEntitlementForRetry(prisma, {
      storeOrderId: orderA.id,
      now: past,
    });
    expect(refused.kind).toBe("REPLAY_WINDOW_EXPIRED");
    if (refused.kind !== "REPLAY_WINDOW_EXPIRED") return;
    expect(refused.operation.status).toBe("FAILED");
    expect(refused.operation.lastError).toBe("stripe_failed_again");
    expect(refused.operation.retryCount).toBe(2);
    expect(refused.operation.createdAt.toISOString()).toBe(t0.toISOString());
    expect(refused.operation.providerIdempotencyKey).toBe(
      foundationReturnEntitlementIdempotencyKey(orderA.id)
    );
  });

  it("blocks PENDING / PROCESSING / UNCERTAIN / SUCCEEDED resets", async () => {
    for (const status of ["PENDING", "PROCESSING", "UNCERTAIN", "SUCCEEDED"] as const) {
      const { orderA } = await seedEntitlement({
        status,
        retryCount: status === "PENDING" ? 0 : 1,
        stripeTransferId: status === "SUCCEEDED" ? key("tr_ent") : null,
        succeededAt: status === "SUCCEEDED" ? new Date("2026-03-01T00:00:00.000Z") : null,
      });
      const result = await resetFoundationSellerReturnEntitlementForRetry(prisma, {
        storeOrderId: orderA.id,
        now: new Date("2026-03-01T01:00:00.000Z"),
      });
      expect(result.kind).toBe("NOT_FAILED");
      if (result.kind !== "NOT_FAILED") return;
      expect(result.reason).toBe(status);
      expect(result.operation.status).toBe(status);
    }
  });

  it("returns NOT_FOUND when no entitlement row exists", async () => {
    const ctx = await twoSellersWithOrders();
    const result = await resetFoundationSellerReturnEntitlementForRetry(prisma, {
      storeOrderId: ctx.orderA.id,
    });
    expect(result).toEqual({ kind: "NOT_FOUND" });
    expect(await getFoundationReturnEntitlementAdminState(prisma, { storeOrderId: ctx.orderA.id })).toBeNull();
  });

  it("serializes concurrent resets: one RESET winner, one NOT_FAILED loser", async () => {
    const t0 = new Date("2026-03-01T00:00:00.000Z");
    const now = new Date(t0.getTime() + 60 * 60 * 1000);
    const { orderA, entitlement } = await seedEntitlement({
      status: "FAILED",
      retryCount: 1,
      createdAt: t0,
      lastError: "stripe_failed",
    });

    const [a, b] = await Promise.all([
      resetFoundationSellerReturnEntitlementForRetry(prisma, { storeOrderId: orderA.id, now }),
      resetFoundationSellerReturnEntitlementForRetry(prisma, { storeOrderId: orderA.id, now }),
    ]);
    const kinds = [a.kind, b.kind].sort();
    expect(kinds).toEqual(["NOT_FAILED", "RESET"]);
    const winner = a.kind === "RESET" ? a : b;
    const loser = a.kind === "NOT_FAILED" ? a : b;
    expect(winner.kind).toBe("RESET");
    expect(loser.kind).toBe("NOT_FAILED");
    if (winner.kind !== "RESET" || loser.kind !== "NOT_FAILED") return;
    expect(winner.operation.status).toBe("PENDING");
    expect(winner.operation.retryCount).toBe(1);
    expect(winner.operation.lastError).toBe(OPERATOR_RESET_FOR_RETRY);
    expect(loser.reason).toBe("PENDING");
    expect(loser.operation.status).toBe("PENDING");
    expect(loser.operation.retryCount).toBe(1);

    const final = await prisma.sellerReturnEntitlementOperation.findUniqueOrThrow({
      where: { id: entitlement.id },
    });
    expect(final.status).toBe("PENDING");
    expect(final.retryCount).toBe(1);
    expect(final.providerIdempotencyKey).toBe(foundationReturnEntitlementIdempotencyKey(orderA.id));
    expect(final.stripeDestinationAccountId).toBe(TEST_SNAPSHOT.stripeDestinationAccountId);
    expect(final.stripeSourceChargeId).toBe(TEST_SNAPSHOT.stripeSourceChargeId);
  });

  it("admin read model reports resetAllowed using the shared eligibility helper", async () => {
    const t0 = new Date("2026-03-01T00:00:00.000Z");
    const inside = new Date(t0.getTime() + windowMs);
    const outside = new Date(t0.getTime() + windowMs + 1);
    const { orderA } = await seedEntitlement({
      status: "FAILED",
      retryCount: 1,
      createdAt: t0,
      lastError: "stripe_failed",
    });

    const allowed = await getFoundationReturnEntitlementAdminState(prisma, {
      storeOrderId: orderA.id,
      now: inside,
    });
    expect(allowed?.resetAllowed).toBe(true);
    expect(allowed?.resetBlockedReason).toBeNull();
    expect(allowed?.providerIdempotencyKey).toBe(foundationReturnEntitlementIdempotencyKey(orderA.id));
    expect(allowed?.sellerId).toBeTruthy();

    const blocked = await getFoundationReturnEntitlementAdminState(prisma, {
      storeOrderId: orderA.id,
      now: outside,
    });
    expect(blocked?.resetAllowed).toBe(false);
    expect(blocked?.resetBlockedReason).toBe("REPLAY_WINDOW_EXPIRED");
  });
});
