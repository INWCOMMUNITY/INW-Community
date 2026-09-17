import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createCheckoutAttempt,
  createListing,
  createMember,
  createOrder,
  createOrderLine,
  createReservation,
  createStoreItem,
  createVariant,
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

async function linkedOrder(opts?: { title?: string }) {
  const listing = await createListing(prisma, { title: opts?.title });
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

describe("M2 checkout attempt and reservation (real PostgreSQL)", () => {
  it("A. rejects a duplicate CheckoutAttempt stripeIdempotencyKey", async () => {
    const buyer = await createMember(prisma, "idem");
    const key = `idem-unique-${buyer.id}`;
    await createCheckoutAttempt(prisma, { buyerMemberId: buyer.id, stripeIdempotencyKey: key });
    await expectRejects(
      () => createCheckoutAttempt(prisma, { buyerMemberId: buyer.id, stripeIdempotencyKey: key }),
      "unique"
    );
  });

  it("B. rejects a duplicate non-null stripeCheckoutSessionId", async () => {
    const buyer = await createMember(prisma, "cs");
    const sessionId = `cs_${buyer.id}`;
    await createCheckoutAttempt(prisma, {
      buyerMemberId: buyer.id,
      stripeCheckoutSessionId: sessionId,
    });
    await expectRejects(
      () =>
        createCheckoutAttempt(prisma, {
          buyerMemberId: buyer.id,
          stripeCheckoutSessionId: sessionId,
        }),
      "unique"
    );
  });

  it("C. rejects a duplicate non-null stripePaymentIntentId", async () => {
    const buyer = await createMember(prisma, "pi");
    const pi = `pi_${buyer.id}`;
    await createCheckoutAttempt(prisma, {
      buyerMemberId: buyer.id,
      stripePaymentIntentId: pi,
    });
    await expectRejects(
      () =>
        createCheckoutAttempt(prisma, {
          buyerMemberId: buyer.id,
          stripePaymentIntentId: pi,
        }),
      "unique"
    );
  });

  it("D. allows multiple CheckoutAttempts with NULL session and payment-intent ids", async () => {
    const buyer = await createMember(prisma, "nulls");
    const a = await createCheckoutAttempt(prisma, { buyerMemberId: buyer.id });
    const b = await createCheckoutAttempt(prisma, { buyerMemberId: buyer.id });
    expect(a.stripeCheckoutSessionId).toBeNull();
    expect(a.stripePaymentIntentId).toBeNull();
    expect(b.stripeCheckoutSessionId).toBeNull();
    expect(b.id).not.toBe(a.id);
  });

  it("E. one CheckoutAttempt can reference multiple StoreOrders", async () => {
    const buyer = await createMember(prisma, "multi");
    const attempt = await createCheckoutAttempt(prisma, { buyerMemberId: buyer.id });
    const sellerA = await createListing(prisma, { title: "Seller A" });
    const sellerB = await createListing(prisma, { title: "Seller B" });
    const orderA = await createOrder(prisma, {
      buyerId: buyer.id,
      sellerId: sellerA.memberId,
      checkoutAttemptId: attempt.id,
    });
    const orderB = await createOrder(prisma, {
      buyerId: buyer.id,
      sellerId: sellerB.memberId,
      checkoutAttemptId: attempt.id,
    });
    expect(orderA.checkoutAttemptId).toBe(attempt.id);
    expect(orderB.checkoutAttemptId).toBe(attempt.id);
    expect(orderA.commerceStatus).toBe("PENDING");
  });

  it("F. historical StoreOrder with checkoutAttemptId NULL remains valid", async () => {
    const listing = await createListing(prisma);
    const buyer = await createMember(prisma, "legacy");
    const order = await createOrder(prisma, { buyerId: buyer.id, sellerId: listing.memberId });
    expect(order.checkoutAttemptId).toBeNull();
    expect(order.commerceStatus).toBe("PENDING");
    expect(order.status).toBe("pending");
  });

  it("G. reservation conservation CHECK rejects mismatched sums", async () => {
    const ctx = await linkedOrder({ title: "Conserve" });
    await expectRejects(
      () =>
        createReservation(prisma, {
          memberId: ctx.listing.memberId,
          checkoutAttemptId: ctx.attempt.id,
          storeOrderId: ctx.order.id,
          orderItemId: ctx.line.id,
          variantId: ctx.listing.variantId,
          storeItemId: ctx.listing.itemId,
          originalQty: 5,
          activeQty: 3,
          convertedQty: 1,
          releasedQty: 0,
          invalidatedQty: 0,
        }),
      "check"
    );
  });

  it("H. negative reservation counters are rejected", async () => {
    const ctx = await linkedOrder({ title: "Neg" });
    await expectRejects(
      () =>
        createReservation(prisma, {
          memberId: ctx.listing.memberId,
          checkoutAttemptId: ctx.attempt.id,
          storeOrderId: ctx.order.id,
          orderItemId: ctx.line.id,
          variantId: ctx.listing.variantId,
          storeItemId: ctx.listing.itemId,
          originalQty: 1,
          activeQty: -1,
          convertedQty: 2,
          releasedQty: 0,
          invalidatedQty: 0,
        }),
      "check"
    );
  });

  it("I. originalQty zero is rejected", async () => {
    const ctx = await linkedOrder({ title: "Zero" });
    await expectRejects(
      () =>
        createReservation(prisma, {
          memberId: ctx.listing.memberId,
          checkoutAttemptId: ctx.attempt.id,
          storeOrderId: ctx.order.id,
          orderItemId: ctx.line.id,
          variantId: ctx.listing.variantId,
          storeItemId: ctx.listing.itemId,
          originalQty: 0,
          activeQty: 0,
          convertedQty: 0,
          releasedQty: 0,
          invalidatedQty: 0,
        }),
      "check"
    );
  });

  it("J. one reservation per OrderItem", async () => {
    const ctx = await linkedOrder({ title: "OneRes" });
    await createReservation(prisma, {
      memberId: ctx.listing.memberId,
      checkoutAttemptId: ctx.attempt.id,
      storeOrderId: ctx.order.id,
      orderItemId: ctx.line.id,
      variantId: ctx.listing.variantId,
      storeItemId: ctx.listing.itemId,
      originalQty: 1,
    });
    await expectRejects(
      () =>
        createReservation(prisma, {
          memberId: ctx.listing.memberId,
          checkoutAttemptId: ctx.attempt.id,
          storeOrderId: ctx.order.id,
          orderItemId: ctx.line.id,
          variantId: ctx.listing.variantId,
          storeItemId: ctx.listing.itemId,
          originalQty: 1,
        }),
      "unique"
    );
  });

  it("K. reservation exact Variant/StoreItem/member mismatch is rejected", async () => {
    const ctx = await linkedOrder({ title: "VarA" });
    const otherItem = await createStoreItem(prisma, ctx.listing.memberId, "VarB");
    const otherVariant = await createVariant(prisma, {
      memberId: ctx.listing.memberId,
      storeItemId: otherItem.id,
      isDefault: true,
    });
    await expectRejects(
      () =>
        createReservation(prisma, {
          memberId: ctx.listing.memberId,
          checkoutAttemptId: ctx.attempt.id,
          storeOrderId: ctx.order.id,
          orderItemId: ctx.line.id,
          variantId: otherVariant.id,
          storeItemId: ctx.listing.itemId,
          originalQty: 1,
        }),
      "fk"
    );
  });

  it("L. reservation OrderItem/StoreOrder mismatch is rejected", async () => {
    const a = await linkedOrder({ title: "OrderA" });
    const b = await linkedOrder({ title: "OrderB" });
    await expectRejects(
      () =>
        createReservation(prisma, {
          memberId: a.listing.memberId,
          checkoutAttemptId: a.attempt.id,
          storeOrderId: b.order.id,
          orderItemId: a.line.id,
          variantId: a.listing.variantId,
          storeItemId: a.listing.itemId,
          originalQty: 1,
        }),
      "fk"
    );
  });

  it("M. reservation CheckoutAttempt/StoreOrder mismatch is rejected", async () => {
    const ctx = await linkedOrder({ title: "AttemptA" });
    const otherBuyer = await createMember(prisma, "other-attempt");
    const otherAttempt = await createCheckoutAttempt(prisma, { buyerMemberId: otherBuyer.id });
    await expectRejects(
      () =>
        createReservation(prisma, {
          memberId: ctx.listing.memberId,
          checkoutAttemptId: otherAttempt.id,
          storeOrderId: ctx.order.id,
          orderItemId: ctx.line.id,
          variantId: ctx.listing.variantId,
          storeItemId: ctx.listing.itemId,
          originalQty: 1,
        }),
      "fk"
    );
  });

  it("N. valid partial invalidation shape: original=5 active=4 invalidated=1", async () => {
    const ctx = await linkedOrder({ title: "Invalidate" });
    const row = await createReservation(prisma, {
      memberId: ctx.listing.memberId,
      checkoutAttemptId: ctx.attempt.id,
      storeOrderId: ctx.order.id,
      orderItemId: ctx.line.id,
      variantId: ctx.listing.variantId,
      storeItemId: ctx.listing.itemId,
      originalQty: 5,
      activeQty: 4,
      convertedQty: 0,
      releasedQty: 0,
      invalidatedQty: 1,
    });
    expect(row.activeQty).toBe(4);
    expect(row.invalidatedQty).toBe(1);
  });

  it("O. valid partial conversion shape: original=5 active=2 converted=3", async () => {
    const ctx = await linkedOrder({ title: "Convert" });
    const row = await createReservation(prisma, {
      memberId: ctx.listing.memberId,
      checkoutAttemptId: ctx.attempt.id,
      storeOrderId: ctx.order.id,
      orderItemId: ctx.line.id,
      variantId: ctx.listing.variantId,
      storeItemId: ctx.listing.itemId,
      originalQty: 5,
      activeQty: 2,
      convertedQty: 3,
      releasedQty: 0,
      invalidatedQty: 0,
    });
    expect(row.convertedQty).toBe(3);
    expect(row.activeQty).toBe(2);
  });

  it("P. InventoryEvent may reference a Reservation", async () => {
    const ctx = await linkedOrder({ title: "Evt" });
    const reservation = await createReservation(prisma, {
      memberId: ctx.listing.memberId,
      checkoutAttemptId: ctx.attempt.id,
      storeOrderId: ctx.order.id,
      orderItemId: ctx.line.id,
      variantId: ctx.listing.variantId,
      storeItemId: ctx.listing.itemId,
      originalQty: 1,
    });
    const event = await prisma.inventoryEvent.create({
      data: {
        memberId: ctx.listing.memberId,
        variantId: ctx.listing.variantId,
        storeItemId: ctx.listing.itemId,
        eventType: "RESERVATION_HOLD",
        cause: "CHECKOUT",
        sourceSystem: "inw",
        sourceFactId: `hold:${reservation.id}`,
        reservationId: reservation.id,
        orderItemId: ctx.line.id,
        requestedQty: 1,
        appliedReservedQty: 1,
      },
    });
    expect(event.reservationId).toBe(reservation.id);
  });

  it("Q. reservation delete is RESTRICT while an InventoryEvent references it", async () => {
    const ctx = await linkedOrder({ title: "Restrict" });
    const reservation = await createReservation(prisma, {
      memberId: ctx.listing.memberId,
      checkoutAttemptId: ctx.attempt.id,
      storeOrderId: ctx.order.id,
      orderItemId: ctx.line.id,
      variantId: ctx.listing.variantId,
      storeItemId: ctx.listing.itemId,
      originalQty: 1,
    });
    const event = await prisma.inventoryEvent.create({
      data: {
        memberId: ctx.listing.memberId,
        variantId: ctx.listing.variantId,
        storeItemId: ctx.listing.itemId,
        eventType: "RESERVATION_HOLD",
        cause: "CHECKOUT",
        sourceSystem: "inw",
        sourceFactId: `hold-restrict:${reservation.id}`,
        reservationId: reservation.id,
      },
    });
    await expectRejects(
      () => prisma.inventoryReservation.delete({ where: { id: reservation.id } }),
      "restrict"
    );
    const stillEvent = await prisma.inventoryEvent.findUnique({ where: { id: event.id } });
    expect(stillEvent).not.toBeNull();
    expect(stillEvent?.reservationId).toBe(reservation.id);
  });

  it("catalog: M2 constraints exist; marketplace v2 remains absent", async () => {
    const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename IN ('checkout_attempt', 'inventory_reservation', 'channel_connection', 'sync_job')
    `;
    expect(tables.map((t) => t.tablename).sort()).toEqual(["checkout_attempt", "inventory_reservation"]);

    const uniques = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'checkout_attempt_stripe_idempotency_key_key',
          'checkout_attempt_stripe_checkout_session_id_key',
          'checkout_attempt_stripe_payment_intent_id_key',
          'inventory_reservation_order_item_id_key',
          'inventory_reservation_active_expires_at_idx'
        )
    `;
    expect(uniques.map((r) => r.indexname).sort()).toEqual([
      "checkout_attempt_stripe_checkout_session_id_key",
      "checkout_attempt_stripe_idempotency_key_key",
      "checkout_attempt_stripe_payment_intent_id_key",
      "inventory_reservation_active_expires_at_idx",
      "inventory_reservation_order_item_id_key",
    ]);

    const applied = await prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM _prisma_migrations
      WHERE migration_name IN (
        '20260916221500_commerce_foundation_m1',
        '20260916233000_commerce_foundation_m2',
        '20260916010000_marketplace_sync_v2'
      )
    `;
    expect(applied.map((r) => r.migration_name).sort()).toEqual([
      "20260916221500_commerce_foundation_m1",
      "20260916233000_commerce_foundation_m2",
    ]);
  });
});
