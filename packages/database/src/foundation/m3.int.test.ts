import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createCheckoutAttempt,
  createListing,
  createMember,
  createOrder,
  createOrderLine,
  createRefundOperation,
  createStripeEvidence,
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

async function linkedOrder(title = "M3") {
  const listing = await createListing(prisma, { title });
  const buyer = await createMember(prisma, "buyer");
  const attempt = await createCheckoutAttempt(prisma, { buyerMemberId: buyer.id });
  const order = await createOrder(prisma, {
    buyerId: buyer.id,
    sellerId: listing.memberId,
    checkoutAttemptId: attempt.id,
  });
  const line = await createOrderLine(prisma, {
    orderId: order.id,
    storeItemId: listing.itemId,
    variantId: listing.variantId,
  });
  return { listing, buyer, attempt, order, line };
}

describe("M3 Stripe evidence and financial operations (real PostgreSQL)", () => {
  it("A. rejects a duplicate StripeEventEvidence.stripeEventId", async () => {
    const eventId = `evt_dup_${Date.now()}`;
    await createStripeEvidence(prisma, { stripeEventId: eventId });
    await expectRejects(() => createStripeEvidence(prisma, { stripeEventId: eventId }), "unique");
  });

  it("B. allows two different Stripe events", async () => {
    const a = await createStripeEvidence(prisma, { eventType: "checkout.session.completed" });
    const b = await createStripeEvidence(prisma, { eventType: "payment_intent.succeeded" });
    expect(a.stripeEventId).not.toBe(b.stripeEventId);
    expect(a.processState).toBe("RECEIVED");
  });

  it("C. Stripe evidence can exist without CheckoutAttempt", async () => {
    const row = await createStripeEvidence(prisma);
    expect(row.checkoutAttemptId).toBeNull();
  });

  it("D. evidence history survives CheckoutAttempt deletion via SET NULL", async () => {
    const buyer = await createMember(prisma, "ev-buyer");
    const attempt = await createCheckoutAttempt(prisma, { buyerMemberId: buyer.id });
    const row = await createStripeEvidence(prisma, { checkoutAttemptId: attempt.id });
    await prisma.checkoutAttempt.delete({ where: { id: attempt.id } });
    const still = await prisma.stripeEventEvidence.findUnique({ where: { id: row.id } });
    expect(still).not.toBeNull();
    expect(still?.checkoutAttemptId).toBeNull();
  });

  it("E. RefundOperation providerIdempotencyKey is unique", async () => {
    const ctx = await linkedOrder("RefundIdem");
    const key = `re-unique-${ctx.order.id}`;
    await createRefundOperation(prisma, {
      memberId: ctx.listing.memberId,
      storeOrderId: ctx.order.id,
      checkoutAttemptId: ctx.attempt.id,
      providerIdempotencyKey: key,
    });
    await expectRejects(
      () =>
        createRefundOperation(prisma, {
          memberId: ctx.listing.memberId,
          storeOrderId: ctx.order.id,
          checkoutAttemptId: ctx.attempt.id,
          providerIdempotencyKey: key,
        }),
      "unique"
    );
  });

  it("F. RefundOperation stripeRefundId unique when non-null", async () => {
    const ctx = await linkedOrder("RefundStripe");
    const refundId = `re_${ctx.order.id}`;
    await createRefundOperation(prisma, {
      memberId: ctx.listing.memberId,
      storeOrderId: ctx.order.id,
      checkoutAttemptId: ctx.attempt.id,
      stripeRefundId: refundId,
    });
    const otherLine = await createOrderLine(prisma, {
      orderId: ctx.order.id,
      storeItemId: ctx.listing.itemId,
      variantId: ctx.listing.variantId,
    });
    await expectRejects(
      () =>
        createRefundOperation(prisma, {
          memberId: ctx.listing.memberId,
          storeOrderId: ctx.order.id,
          orderItemId: otherLine.id,
          checkoutAttemptId: ctx.attempt.id,
          stripeRefundId: refundId,
        }),
      "unique"
    );
  });

  it("G. multiple NULL stripeRefundId values are allowed", async () => {
    const ctx = await linkedOrder("RefundNulls");
    const a = await createRefundOperation(prisma, {
      memberId: ctx.listing.memberId,
      storeOrderId: ctx.order.id,
      checkoutAttemptId: ctx.attempt.id,
      amountCents: 100,
    });
    const b = await createRefundOperation(prisma, {
      memberId: ctx.listing.memberId,
      storeOrderId: ctx.order.id,
      checkoutAttemptId: ctx.attempt.id,
      amountCents: 200,
    });
    expect(a.stripeRefundId).toBeNull();
    expect(b.stripeRefundId).toBeNull();
    expect(a.id).not.toBe(b.id);
  });

  it("H. multiple RefundOperations may exist for one StoreOrder", async () => {
    const ctx = await linkedOrder("RefundMany");
    const a = await createRefundOperation(prisma, {
      memberId: ctx.listing.memberId,
      storeOrderId: ctx.order.id,
      checkoutAttemptId: ctx.attempt.id,
      kind: "PARTIAL",
      amountCents: 100,
    });
    const b = await createRefundOperation(prisma, {
      memberId: ctx.listing.memberId,
      storeOrderId: ctx.order.id,
      checkoutAttemptId: ctx.attempt.id,
      kind: "COURTESY",
      amountCents: 50,
    });
    expect(a.storeOrderId).toBe(ctx.order.id);
    expect(b.storeOrderId).toBe(ctx.order.id);
  });

  it("I. RefundOperation amountCents <= 0 is rejected", async () => {
    const ctx = await linkedOrder("RefundAmt");
    await expectRejects(
      () =>
        createRefundOperation(prisma, {
          memberId: ctx.listing.memberId,
          storeOrderId: ctx.order.id,
          checkoutAttemptId: ctx.attempt.id,
          amountCents: 0,
        }),
      "check"
    );
  });

  it("J. RefundOperation seller mismatch is rejected", async () => {
    const ctx = await linkedOrder("RefundSeller");
    const other = await createMember(prisma, "other-seller");
    await expectRejects(
      () =>
        createRefundOperation(prisma, {
          memberId: other.id,
          storeOrderId: ctx.order.id,
          checkoutAttemptId: ctx.attempt.id,
        }),
      "fk"
    );
  });

  it("K. RefundOperation OrderItem from another StoreOrder is rejected", async () => {
    const a = await linkedOrder("RefundLineA");
    const b = await linkedOrder("RefundLineB");
    await expectRejects(
      () =>
        createRefundOperation(prisma, {
          memberId: a.listing.memberId,
          storeOrderId: a.order.id,
          orderItemId: b.line.id,
          checkoutAttemptId: a.attempt.id,
        }),
      "fk"
    );
  });

  it("L. RefundOperation CheckoutAttempt mismatch is rejected", async () => {
    const ctx = await linkedOrder("RefundAttempt");
    const otherBuyer = await createMember(prisma, "other-attempt");
    const otherAttempt = await createCheckoutAttempt(prisma, { buyerMemberId: otherBuyer.id });
    await expectRejects(
      () =>
        createRefundOperation(prisma, {
          memberId: ctx.listing.memberId,
          storeOrderId: ctx.order.id,
          checkoutAttemptId: otherAttempt.id,
        }),
      "fk"
    );
  });

  it("M. restockRequested=false persists independently of inventory", async () => {
    const ctx = await linkedOrder("RefundPolicy");
    const before = await prisma.inventoryEvent.count({ where: { storeItemId: ctx.listing.itemId } });
    const row = await createRefundOperation(prisma, {
      memberId: ctx.listing.memberId,
      storeOrderId: ctx.order.id,
      checkoutAttemptId: ctx.attempt.id,
      restockRequested: false,
    });
    expect(row.restockRequested).toBe(false);
    const after = await prisma.inventoryEvent.count({ where: { storeItemId: ctx.listing.itemId } });
    expect(after).toBe(before);
    const state = await prisma.inventoryState.findUnique({ where: { variantId: ctx.listing.variantId } });
    expect(state).toBeNull();
  });

  it("N. TransferOperation is one per StoreOrder", async () => {
    const ctx = await linkedOrder("XferOne");
    await createTransferOperation(prisma, {
      memberId: ctx.listing.memberId,
      storeOrderId: ctx.order.id,
    });
    await expectRejects(
      () =>
        createTransferOperation(prisma, {
          memberId: ctx.listing.memberId,
          storeOrderId: ctx.order.id,
        }),
      "unique"
    );
  });

  it("O. Transfer providerIdempotencyKey is unique", async () => {
    const a = await linkedOrder("XferIdemA");
    const b = await linkedOrder("XferIdemB");
    const key = `tr-unique-${a.order.id}`;
    await createTransferOperation(prisma, {
      memberId: a.listing.memberId,
      storeOrderId: a.order.id,
      providerIdempotencyKey: key,
    });
    await expectRejects(
      () =>
        createTransferOperation(prisma, {
          memberId: b.listing.memberId,
          storeOrderId: b.order.id,
          providerIdempotencyKey: key,
        }),
      "unique"
    );
  });

  it("P. Transfer stripeTransferId unique when non-null", async () => {
    const a = await linkedOrder("XferStripeA");
    const b = await linkedOrder("XferStripeB");
    const transferId = `tr_${a.order.id}`;
    await createTransferOperation(prisma, {
      memberId: a.listing.memberId,
      storeOrderId: a.order.id,
      stripeTransferId: transferId,
    });
    await expectRejects(
      () =>
        createTransferOperation(prisma, {
          memberId: b.listing.memberId,
          storeOrderId: b.order.id,
          stripeTransferId: transferId,
        }),
      "unique"
    );
  });

  it("Q. multiple NULL transfer ids are allowed across different orders", async () => {
    const a = await linkedOrder("XferNullA");
    const b = await linkedOrder("XferNullB");
    const ta = await createTransferOperation(prisma, {
      memberId: a.listing.memberId,
      storeOrderId: a.order.id,
    });
    const tb = await createTransferOperation(prisma, {
      memberId: b.listing.memberId,
      storeOrderId: b.order.id,
    });
    expect(ta.stripeTransferId).toBeNull();
    expect(tb.stripeTransferId).toBeNull();
  });

  it("R. Transfer amount <= 0 is rejected", async () => {
    const ctx = await linkedOrder("XferAmt");
    await expectRejects(
      () =>
        createTransferOperation(prisma, {
          memberId: ctx.listing.memberId,
          storeOrderId: ctx.order.id,
          amountCents: 0,
        }),
      "check"
    );
  });

  it("S. Transfer seller mismatch is rejected", async () => {
    const ctx = await linkedOrder("XferSeller");
    const other = await createMember(prisma, "xfer-other");
    await expectRejects(
      () =>
        createTransferOperation(prisma, {
          memberId: other.id,
          storeOrderId: ctx.order.id,
        }),
      "fk"
    );
  });

  it("T. financial operation status includes PROCESSING and UNCERTAIN", async () => {
    const ctx = await linkedOrder("Status");
    const processing = await createRefundOperation(prisma, {
      memberId: ctx.listing.memberId,
      storeOrderId: ctx.order.id,
      checkoutAttemptId: ctx.attempt.id,
      status: "PROCESSING",
    });
    const uncertain = await createTransferOperation(prisma, {
      memberId: ctx.listing.memberId,
      storeOrderId: ctx.order.id,
      status: "UNCERTAIN",
    });
    expect(processing.status).toBe("PROCESSING");
    expect(uncertain.status).toBe("UNCERTAIN");
  });

  it("U. StoreOrder delete is RESTRICT while refund/transfer history exists", async () => {
    const ctx = await linkedOrder("Restrict");
    const refund = await createRefundOperation(prisma, {
      memberId: ctx.listing.memberId,
      storeOrderId: ctx.order.id,
      checkoutAttemptId: ctx.attempt.id,
    });
    await expectRejects(() => prisma.storeOrder.delete({ where: { id: ctx.order.id } }), "restrict");
    const stillRefund = await prisma.refundOperation.findUnique({ where: { id: refund.id } });
    expect(stillRefund).not.toBeNull();

    await prisma.refundOperation.delete({ where: { id: refund.id } });
    const transfer = await createTransferOperation(prisma, {
      memberId: ctx.listing.memberId,
      storeOrderId: ctx.order.id,
    });
    await expectRejects(() => prisma.storeOrder.delete({ where: { id: ctx.order.id } }), "restrict");
    const stillTransfer = await prisma.transferOperation.findUnique({ where: { id: transfer.id } });
    expect(stillTransfer).not.toBeNull();
  });

  it("V. catalog: M3 uniques/checks/composite FKs exist; marketplace v2 absent", async () => {
    const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename IN (
          'stripe_event_evidence', 'refund_operation', 'transfer_operation',
          'channel_connection', 'sync_job'
        )
    `;
    expect(tables.map((t) => t.tablename).sort()).toEqual([
      "refund_operation",
      "stripe_event_evidence",
      "transfer_operation",
    ]);

    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'stripe_event_evidence_stripe_event_id_key',
          'refund_operation_provider_idempotency_key_key',
          'refund_operation_stripe_refund_id_key',
          'transfer_operation_store_order_id_key',
          'transfer_operation_provider_idempotency_key_key',
          'transfer_operation_stripe_transfer_id_key'
        )
    `;
    expect(indexes.map((r) => r.indexname).sort()).toEqual([
      "refund_operation_provider_idempotency_key_key",
      "refund_operation_stripe_refund_id_key",
      "stripe_event_evidence_stripe_event_id_key",
      "transfer_operation_provider_idempotency_key_key",
      "transfer_operation_store_order_id_key",
      "transfer_operation_stripe_transfer_id_key",
    ]);

    const fks = await prisma.$queryRaw<Array<{ conname: string }>>`
      SELECT conname FROM pg_constraint
      WHERE contype = 'f'
        AND conname IN (
          'refund_operation_store_order_id_member_id_fkey',
          'refund_operation_order_item_id_store_order_id_fkey',
          'refund_operation_store_order_id_checkout_attempt_id_fkey',
          'transfer_operation_store_order_id_member_id_fkey'
        )
    `;
    expect(fks.map((r) => r.conname).sort()).toEqual([
      "refund_operation_order_item_id_store_order_id_fkey",
      "refund_operation_store_order_id_checkout_attempt_id_fkey",
      "refund_operation_store_order_id_member_id_fkey",
      "transfer_operation_store_order_id_member_id_fkey",
    ]);

    const applied = await prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM _prisma_migrations
      WHERE migration_name IN (
        '20260916221500_commerce_foundation_m1',
        '20260916233000_commerce_foundation_m2',
        '20260916234500_commerce_foundation_m3',
        '20260916010000_marketplace_sync_v2'
      )
    `;
    expect(applied.map((r) => r.migration_name).sort()).toEqual([
      "20260916221500_commerce_foundation_m1",
      "20260916233000_commerce_foundation_m2",
      "20260916234500_commerce_foundation_m3",
    ]);
  });
});
