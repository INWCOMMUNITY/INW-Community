import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { COMMERCE_FOUNDATION_CUTOVER_SINGLETON_ID, transitionCommerceFoundationCutover } from "../commerce-foundation-cutover";
import {
  expireFoundationCheckoutAttempt,
  finalizeFoundationCheckoutPayment,
  prepareFoundationCheckout,
} from "../commerce-foundation-checkout";
import {
  applyFoundationCheckoutProviderObservation,
  foundationCheckoutReconciliationCronAllowed,
  listFoundationCheckoutReconciliationCandidates,
  type FoundationCheckoutProviderObservation,
} from "../commerce-foundation-checkout-reconciliation";
import { provisionNativeFoundationListing } from "../commerce-foundation-listing";
import { ensureFoundationTransferIntent, persistFoundationTransferSuccess } from "../commerce-foundation-transfer";
import { foundationTestDatabaseUrl } from "./local-url";
import { createMember, createStoreItem } from "./fixtures";

let prisma: PrismaClient;

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
  const current = await prisma.commerceFoundationCutover.findUnique({
    where: { id: COMMERCE_FOUNDATION_CUTOVER_SINGLETON_ID },
    select: { mode: true },
  });
  if (current?.mode === "FOUNDATION" || current?.mode === "UNFROZEN") return;
  await transitionCommerceFoundationCutover(prisma, { to: "FROZEN" });
  await transitionCommerceFoundationCutover(prisma, {
    to: "BACKFILLING",
    engineSha: "engine-test",
    manifestHash: "manifest-test",
  });
  await transitionCommerceFoundationCutover(prisma, { to: "FOUNDATION" });
}

async function trackedSimple(qty: number) {
  await enterFoundation();
  const member = await createMember(prisma, "rec");
  const item = await createStoreItem(prisma, member.id, "Reconcile tracked", { quantity: qty });
  const provisioned = await prisma.$transaction((tx) => provisionNativeFoundationListing(tx, item.id));
  return { member, item, variantId: provisioned.variantIds[0] };
}

function checkoutLines(sellerId: string, itemId: string, variantId: string, quantity = 1) {
  return {
    sellerId,
    subtotalCents: 1000 * quantity,
    shippingCostCents: 0,
    totalCents: 1000 * quantity,
    lines: [{ storeItemId: itemId, quantity, priceCentsAtPurchase: 1000, variantId }],
  };
}

async function prepareOpenAttempt(qty = 1) {
  const ctx = await trackedSimple(qty);
  const buyer = await createMember(prisma, "buyer");
  const input = {
    buyerMemberId: buyer.id,
    amountCents: 1000 * qty,
    orders: [checkoutLines(ctx.member.id, ctx.item.id, ctx.variantId, qty)],
  };
  const prepared = await prepareFoundationCheckout(prisma, input);
  const sessionId = `cs_${prepared.attemptId}`;
  await prisma.checkoutAttempt.update({
    where: { id: prepared.attemptId },
    data: {
      state: "SESSION_OPEN",
      stripeCheckoutSessionId: sessionId,
    },
  });
  return { ctx, buyer, input, prepared, sessionId };
}

function sessionObservation(
  sessionId: string,
  status: string,
  paymentStatus: string,
  extras?: { url?: string | null; paymentIntentId?: string | null }
): FoundationCheckoutProviderObservation {
  return {
    kind: "session",
    stripeCheckoutSessionId: sessionId,
    stripeStatus: status,
    paymentStatus,
    url: extras?.url ?? (status === "open" ? `https://checkout.stripe.test/${sessionId}` : null),
    paymentIntentId: extras?.paymentIntentId ?? null,
  };
}

beforeAll(() => {
  const url = foundationTestDatabaseUrl();
  prisma = new PrismaClient({
    datasources: { db: { url } },
    log: ["error"],
  });
});

afterEach(async () => {
  await resetSingleton();
});

afterAll(async () => {
  await prisma?.$disconnect();
});

describe("prompt-70 foundation checkout session reconciliation", () => {
  it("active SESSION_OPEN keeps HOLD and reusable URL", async () => {
    const { ctx, prepared, sessionId } = await prepareOpenAttempt();
    const result = await applyFoundationCheckoutProviderObservation(
      prisma,
      prepared.attemptId,
      sessionObservation(sessionId, "open", "unpaid")
    );
    expect(result.classification).toBe("ACTIVE");
    expect(result.checkoutUrl).toContain(sessionId);
    const attempt = await prisma.checkoutAttempt.findUnique({ where: { id: prepared.attemptId } });
    expect(attempt?.state).toBe("SESSION_OPEN");
    expect(attempt?.stripeCheckoutSessionId).toBe(sessionId);
    const reservation = await prisma.inventoryReservation.findFirst({
      where: { checkoutAttemptId: prepared.attemptId },
    });
    expect(reservation?.activeQty).toBe(1);
    expect(reservation?.releasedQty).toBe(0);
    const item = await prisma.storeItem.findUnique({ where: { id: ctx.item.id } });
    expect(item?.quantity).toBe(0);
  });

  it("expired SESSION_OPEN unpaid releases once and closes without SESSION_FAILED", async () => {
    const { ctx, prepared, sessionId } = await prepareOpenAttempt();
    const result = await applyFoundationCheckoutProviderObservation(
      prisma,
      prepared.attemptId,
      sessionObservation(sessionId, "expired", "unpaid")
    );
    expect(result.classification).toBe("EXPIRED_RELEASED");
    const attempt = await prisma.checkoutAttempt.findUnique({ where: { id: prepared.attemptId } });
    expect(attempt?.state).toBe("CLOSED");
    expect(attempt?.state).not.toBe("SESSION_FAILED");
    expect(attempt?.stripeCheckoutSessionId).toBe(sessionId);
    const reservation = await prisma.inventoryReservation.findFirst({
      where: { checkoutAttemptId: prepared.attemptId },
    });
    expect(reservation?.activeQty).toBe(0);
    expect(reservation?.releasedQty).toBe(1);
    const item = await prisma.storeItem.findUnique({ where: { id: ctx.item.id } });
    expect(item?.quantity).toBe(1);
    const order = await prisma.storeOrder.findFirst({ where: { checkoutAttemptId: prepared.attemptId } });
    expect(order?.status).toBe("canceled");
    expect(
      await prisma.inventoryEvent.count({
        where: { variantId: ctx.variantId, eventType: "RESERVATION_RELEASE" },
      })
    ).toBe(1);
  });

  it("expired retry creates the next generation without mutating the closed attempt", async () => {
    const { prepared, sessionId, input } = await prepareOpenAttempt();
    await applyFoundationCheckoutProviderObservation(
      prisma,
      prepared.attemptId,
      sessionObservation(sessionId, "expired", "unpaid")
    );
    const next = await prepareFoundationCheckout(prisma, input);
    expect(next.reused).toBe(false);
    expect(next.attemptId).not.toBe(prepared.attemptId);
    expect(next.stripeIdempotencyKey).toContain("_g1");
    expect(next.stripeIdempotencyKey).not.toBe(prepared.stripeIdempotencyKey);
    const old = await prisma.checkoutAttempt.findUnique({ where: { id: prepared.attemptId } });
    expect(old?.state).toBe("CLOSED");
    expect(old?.stripeCheckoutSessionId).toBe(sessionId);
    expect(old?.stripeIdempotencyKey).toBe(prepared.stripeIdempotencyKey);
    const newHold = await prisma.inventoryReservation.findFirst({
      where: { checkoutAttemptId: next.attemptId },
    });
    expect(newHold?.activeQty).toBe(1);
  });

  it("complete+paid persists payment truth and does not release", async () => {
    const { prepared, sessionId } = await prepareOpenAttempt();
    const result = await applyFoundationCheckoutProviderObservation(
      prisma,
      prepared.attemptId,
      sessionObservation(sessionId, "complete", "paid", { paymentIntentId: `pi_${prepared.attemptId}` })
    );
    expect(result.classification).toBe("PAID_NEEDS_FULFILLMENT");
    const attempt = await prisma.checkoutAttempt.findUnique({ where: { id: prepared.attemptId } });
    expect(attempt?.paymentStatus).toBe("PAID");
    expect(attempt?.stripePaymentIntentId).toBe(`pi_${prepared.attemptId}`);
    const reservation = await prisma.inventoryReservation.findFirst({
      where: { checkoutAttemptId: prepared.attemptId },
    });
    expect(reservation?.activeQty).toBe(1);
    expect(reservation?.releasedQty).toBe(0);
    expect(reservation?.convertedQty).toBe(0);
  });

  it("complete+unpaid does not release and stays payment pending", async () => {
    const { prepared, sessionId } = await prepareOpenAttempt();
    const result = await applyFoundationCheckoutProviderObservation(
      prisma,
      prepared.attemptId,
      sessionObservation(sessionId, "complete", "unpaid")
    );
    expect(result.classification).toBe("PAYMENT_PENDING");
    const reservation = await prisma.inventoryReservation.findFirst({
      where: { checkoutAttemptId: prepared.attemptId },
    });
    expect(reservation?.activeQty).toBe(1);
    expect(reservation?.releasedQty).toBe(0);
    const attempt = await prisma.checkoutAttempt.findUnique({ where: { id: prepared.attemptId } });
    expect(attempt?.state).toBe("SESSION_OPEN");
    expect(attempt?.paymentStatus).toBe("UNPAID");
  });

  it("SESSION_UNKNOWN known id open recovers SESSION_OPEN", async () => {
    const { prepared, sessionId } = await prepareOpenAttempt();
    await prisma.checkoutAttempt.update({
      where: { id: prepared.attemptId },
      data: { state: "SESSION_UNKNOWN" },
    });
    const result = await applyFoundationCheckoutProviderObservation(
      prisma,
      prepared.attemptId,
      sessionObservation(sessionId, "open", "unpaid")
    );
    expect(result.classification).toBe("ACTIVE");
    const attempt = await prisma.checkoutAttempt.findUnique({ where: { id: prepared.attemptId } });
    expect(attempt?.state).toBe("SESSION_OPEN");
    expect(attempt?.stripeCheckoutSessionId).toBe(sessionId);
    const reservation = await prisma.inventoryReservation.findFirst({
      where: { checkoutAttemptId: prepared.attemptId },
    });
    expect(reservation?.activeQty).toBe(1);
  });

  it("SESSION_UNKNOWN known id expired unpaid closes and releases", async () => {
    const { prepared, sessionId } = await prepareOpenAttempt();
    await prisma.checkoutAttempt.update({
      where: { id: prepared.attemptId },
      data: { state: "SESSION_UNKNOWN" },
    });
    const result = await applyFoundationCheckoutProviderObservation(
      prisma,
      prepared.attemptId,
      sessionObservation(sessionId, "expired", "unpaid")
    );
    expect(result.classification).toBe("EXPIRED_RELEASED");
    const attempt = await prisma.checkoutAttempt.findUnique({ where: { id: prepared.attemptId } });
    expect(attempt?.state).toBe("CLOSED");
    const reservation = await prisma.inventoryReservation.findFirst({
      where: { checkoutAttemptId: prepared.attemptId },
    });
    expect(reservation?.releasedQty).toBe(1);
  });

  it("SESSION_UNKNOWN without Session id never creates, releases, or fails; prepare reuses same key", async () => {
    const ctx = await trackedSimple(1);
    const buyer = await createMember(prisma, "noid");
    const input = {
      buyerMemberId: buyer.id,
      amountCents: 1000,
      orders: [checkoutLines(ctx.member.id, ctx.item.id, ctx.variantId)],
    };
    const prepared = await prepareFoundationCheckout(prisma, input);
    await prisma.checkoutAttempt.update({
      where: { id: prepared.attemptId },
      data: { state: "SESSION_UNKNOWN", stripeCheckoutSessionId: null },
    });
    const result = await applyFoundationCheckoutProviderObservation(prisma, prepared.attemptId, {
      kind: "missing_session_id",
    });
    expect(result.classification).toBe("NEEDS_OPERATOR");
    expect(result.retryable).toBe(false);
    const retry = await prepareFoundationCheckout(prisma, input);
    expect(retry.reused).toBe(true);
    expect(retry.attemptId).toBe(prepared.attemptId);
    expect(retry.stripeIdempotencyKey).toBe(prepared.stripeIdempotencyKey);
    const attempt = await prisma.checkoutAttempt.findUnique({ where: { id: prepared.attemptId } });
    expect(attempt?.state).toBe("SESSION_UNKNOWN");
    expect(attempt?.state).not.toBe("SESSION_FAILED");
    expect(attempt?.state).not.toBe("CLOSED");
    const reservation = await prisma.inventoryReservation.findFirst({
      where: { checkoutAttemptId: prepared.attemptId },
    });
    expect(reservation?.activeQty).toBe(1);
  });

  it("old no-id SESSION_UNKNOWN still does not release because of age", async () => {
    const { prepared } = await prepareOpenAttempt();
    await prisma.checkoutAttempt.update({
      where: { id: prepared.attemptId },
      data: {
        state: "SESSION_UNKNOWN",
        stripeCheckoutSessionId: null,
        expiresAt: new Date(Date.now() - 60 * 60 * 1000),
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    });
    const result = await applyFoundationCheckoutProviderObservation(prisma, prepared.attemptId, {
      kind: "missing_session_id",
    });
    expect(result.classification).toBe("NEEDS_OPERATOR");
    const reservation = await prisma.inventoryReservation.findFirst({
      where: { checkoutAttemptId: prepared.attemptId },
    });
    expect(reservation?.activeQty).toBe(1);
    const attempt = await prisma.checkoutAttempt.findUnique({ where: { id: prepared.attemptId } });
    expect(attempt?.state).toBe("SESSION_UNKNOWN");
  });

  it("provider not-found does not release", async () => {
    const { prepared, sessionId } = await prepareOpenAttempt();
    const result = await applyFoundationCheckoutProviderObservation(prisma, prepared.attemptId, {
      kind: "provider_not_found",
      stripeCheckoutSessionId: sessionId,
    });
    expect(result.classification).toBe("NEEDS_OPERATOR");
    const reservation = await prisma.inventoryReservation.findFirst({
      where: { checkoutAttemptId: prepared.attemptId },
    });
    expect(reservation?.activeQty).toBe(1);
    const attempt = await prisma.checkoutAttempt.findUnique({ where: { id: prepared.attemptId } });
    expect(attempt?.state).toBe("SESSION_OPEN");
  });

  it("local PAID wins over expired+unpaid observation", async () => {
    const { prepared, sessionId } = await prepareOpenAttempt();
    await prisma.checkoutAttempt.update({
      where: { id: prepared.attemptId },
      data: { paymentStatus: "PAID" },
    });
    const result = await applyFoundationCheckoutProviderObservation(
      prisma,
      prepared.attemptId,
      sessionObservation(sessionId, "expired", "unpaid")
    );
    expect(result.classification).toBe("PAID_NEEDS_FULFILLMENT");
    const reservation = await prisma.inventoryReservation.findFirst({
      where: { checkoutAttemptId: prepared.attemptId },
    });
    expect(reservation?.activeQty).toBe(1);
    expect(reservation?.releasedQty).toBe(0);
  });

  it("webhook vs expire observation serializes on the attempt lock", async () => {
    const { ctx, prepared, sessionId } = await prepareOpenAttempt();
    const results = await Promise.allSettled([
      applyFoundationCheckoutProviderObservation(
        prisma,
        prepared.attemptId,
        sessionObservation(sessionId, "expired", "unpaid")
      ),
      finalizeFoundationCheckoutPayment(prisma, { attemptId: prepared.attemptId }),
    ]);
    const reservation = await prisma.inventoryReservation.findFirst({
      where: { checkoutAttemptId: prepared.attemptId },
    });
    const converted = reservation?.convertedQty === 1 && reservation.activeQty === 0 && reservation.releasedQty === 0;
    const released = reservation?.releasedQty === 1 && reservation.convertedQty === 0;
    expect(converted || released).toBe(true);
    expect(Boolean(converted) && Boolean(released)).toBe(false);
    if (converted) {
      expect(
        await prisma.inventoryEvent.count({
          where: { variantId: ctx.variantId, eventType: "RESERVATION_RELEASE" },
        })
      ).toBe(0);
      expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    } else {
      const attempt = await prisma.checkoutAttempt.findUnique({ where: { id: prepared.attemptId } });
      expect(attempt?.paymentStatus).toBe("PAID");
      expect(attempt?.state).toBe("CLOSED");
      expect(results.some((r) => r.status === "rejected")).toBe(true);
    }
  });

  it("expire-first then paid records PAID without CONVERT", async () => {
    const { ctx, prepared, sessionId } = await prepareOpenAttempt();
    await applyFoundationCheckoutProviderObservation(
      prisma,
      prepared.attemptId,
      sessionObservation(sessionId, "expired", "unpaid")
    );
    await expect(finalizeFoundationCheckoutPayment(prisma, { attemptId: prepared.attemptId })).rejects.toThrow();
    const attempt = await prisma.checkoutAttempt.findUnique({ where: { id: prepared.attemptId } });
    expect(attempt?.paymentStatus).toBe("PAID");
    expect(attempt?.state).toBe("CLOSED");
    const reservation = await prisma.inventoryReservation.findFirst({
      where: { checkoutAttemptId: prepared.attemptId },
    });
    expect(reservation?.releasedQty).toBe(1);
    expect(reservation?.convertedQty).toBe(0);
    const order = await prisma.storeOrder.findFirst({ where: { checkoutAttemptId: prepared.attemptId } });
    expect(order?.commerceStatus).not.toBe("FINALIZED");
    expect(
      await prisma.inventoryEvent.count({
        where: { variantId: ctx.variantId, eventType: "RESERVATION_CONVERT" },
      })
    ).toBe(0);
    const afterPaid = await applyFoundationCheckoutProviderObservation(
      prisma,
      prepared.attemptId,
      sessionObservation(sessionId, "complete", "paid")
    );
    expect(afterPaid.classification).toBe("PAID_NOT_CONVERTIBLE");
    expect(order?.status).toBe("canceled");
    const afterMark = await prisma.storeOrder.findFirst({ where: { checkoutAttemptId: prepared.attemptId } });
    expect(afterMark?.commerceStatus).toBe("UNFULFILLABLE");
    expect(afterMark?.status).toBe("canceled");
  });

  it("candidate listing is bounded, oldest first, and skips fully finalized", async () => {
    const stale = new Date(Date.now() - 40 * 60 * 1000);
    const open = await prepareOpenAttempt();
    const unknown = await prepareOpenAttempt();
    const noId = await prepareOpenAttempt();
    const paidFinal = await prepareOpenAttempt();
    await prisma.checkoutAttempt.update({
      where: { id: open.prepared.attemptId },
      data: { expiresAt: stale, createdAt: stale },
    });
    await prisma.checkoutAttempt.update({
      where: { id: unknown.prepared.attemptId },
      data: { state: "SESSION_UNKNOWN", createdAt: new Date(stale.getTime() + 1000) },
    });
    await prisma.checkoutAttempt.update({
      where: { id: noId.prepared.attemptId },
      data: {
        state: "SESSION_UNKNOWN",
        stripeCheckoutSessionId: null,
        createdAt: new Date(stale.getTime() + 2000),
      },
    });
    await finalizeFoundationCheckoutPayment(prisma, { attemptId: paidFinal.prepared.attemptId });
    await prisma.checkoutAttempt.update({
      where: { id: paidFinal.prepared.attemptId },
      data: { createdAt: new Date(stale.getTime() + 3000) },
    });

    const pendingPayout = await listFoundationCheckoutReconciliationCandidates(prisma, { take: 500, now: new Date() });
    expect(pendingPayout.map((row) => row.id)).toContain(paidFinal.prepared.attemptId);

    await prisma.storeOrder.updateMany({
      where: { checkoutAttemptId: paidFinal.prepared.attemptId },
      data: { status: "paid" },
    });

    const bounded = await listFoundationCheckoutReconciliationCandidates(prisma, { take: 20, now: new Date() });
    expect(bounded.length).toBeLessThanOrEqual(20);
    const all = await listFoundationCheckoutReconciliationCandidates(prisma, { take: 500, now: new Date() });
    const ours = all
      .filter((row) =>
        [open.prepared.attemptId, unknown.prepared.attemptId, noId.prepared.attemptId, paidFinal.prepared.attemptId].includes(
          row.id
        )
      )
      .map((row) => row.id);
    expect(ours).toEqual([open.prepared.attemptId, unknown.prepared.attemptId, noId.prepared.attemptId]);
    expect(ours).not.toContain(paidFinal.prepared.attemptId);
  });

  it("LEGACY mode is not a reconciliation cron writer mode", () => {
    expect(foundationCheckoutReconciliationCronAllowed("LEGACY")).toBe(false);
    expect(foundationCheckoutReconciliationCronAllowed("FROZEN")).toBe(false);
    expect(foundationCheckoutReconciliationCronAllowed("BACKFILLING")).toBe(false);
    expect(foundationCheckoutReconciliationCronAllowed("FOUNDATION")).toBe(true);
    expect(foundationCheckoutReconciliationCronAllowed("UNFROZEN")).toBe(true);
  });

  it("expired reconciliation is idempotent", async () => {
    const { ctx, prepared, sessionId } = await prepareOpenAttempt();
    const first = await applyFoundationCheckoutProviderObservation(
      prisma,
      prepared.attemptId,
      sessionObservation(sessionId, "expired", "unpaid")
    );
    const quantityAfterFirst = (await prisma.storeItem.findUnique({ where: { id: ctx.item.id } }))?.quantity;
    const second = await applyFoundationCheckoutProviderObservation(
      prisma,
      prepared.attemptId,
      sessionObservation(sessionId, "expired", "unpaid")
    );
    expect(first.classification).toBe("EXPIRED_RELEASED");
    expect(second.classification).toBe("EXPIRED_RELEASED");
    expect(
      await prisma.inventoryEvent.count({
        where: { variantId: ctx.variantId, eventType: "RESERVATION_RELEASE" },
      })
    ).toBe(1);
    const item = await prisma.storeItem.findUnique({ where: { id: ctx.item.id } });
    expect(item?.quantity).toBe(quantityAfterFirst);
    const attempt = await prisma.checkoutAttempt.findUnique({ where: { id: prepared.attemptId } });
    expect(attempt?.state).toBe("CLOSED");
  });

  it("no_payment_required fails closed for review", async () => {
    const { prepared, sessionId } = await prepareOpenAttempt();
    const result = await applyFoundationCheckoutProviderObservation(
      prisma,
      prepared.attemptId,
      sessionObservation(sessionId, "complete", "no_payment_required")
    );
    expect(result.classification).toBe("REQUIRES_REVIEW");
    const reservation = await prisma.inventoryReservation.findFirst({
      where: { checkoutAttemptId: prepared.attemptId },
    });
    expect(reservation?.activeQty).toBe(1);
  });

  it("TTL expire helper remains available but provider path does not mark SESSION_FAILED", async () => {
    const { prepared } = await prepareOpenAttempt();
    const decision = await expireFoundationCheckoutAttempt(prisma, prepared.attemptId);
    expect(decision).toBe("release_and_cancel");
  });

  it("shipped FINALIZED orders with incomplete TransferOperation remain payout candidates", async () => {
    const { ctx, prepared, sessionId } = await prepareOpenAttempt();
    await prisma.checkoutAttempt.update({
      where: { id: prepared.attemptId },
      data: { paymentStatus: "PAID", stripePaymentIntentId: "pi_ship" },
    });
    await finalizeFoundationCheckoutPayment(prisma, {
      attemptId: prepared.attemptId,
      stripeCheckoutSessionId: sessionId,
      stripePaymentIntentId: "pi_ship",
    });
    const order = await prisma.storeOrder.findFirst({ where: { checkoutAttemptId: prepared.attemptId } });
    expect(order).toBeTruthy();
    await ensureFoundationTransferIntent(prisma, {
      storeOrderId: order!.id,
      memberId: ctx.member.id,
      amountCents: 990,
    });
    await prisma.storeOrder.update({
      where: { id: order!.id },
      data: { status: "shipped", commerceStatus: "FINALIZED" },
    });
    const classified = await applyFoundationCheckoutProviderObservation(
      prisma,
      prepared.attemptId,
      sessionObservation(sessionId, "complete", "paid", { paymentIntentId: "pi_ship" })
    );
    expect(classified.classification).toBe("PAID_NEEDS_FULFILLMENT");
    const candidates = await listFoundationCheckoutReconciliationCandidates(prisma, { take: 500, now: new Date() });
    expect(candidates.map((row) => row.id)).toContain(prepared.attemptId);
  });

  it("SUCCEEDED TransferOperation with missing sale ledger remains PAID_NEEDS_FULFILLMENT", async () => {
    const { ctx, prepared, sessionId } = await prepareOpenAttempt();
    await prisma.checkoutAttempt.update({
      where: { id: prepared.attemptId },
      data: { paymentStatus: "PAID", stripePaymentIntentId: "pi_repair" },
    });
    await finalizeFoundationCheckoutPayment(prisma, {
      attemptId: prepared.attemptId,
      stripeCheckoutSessionId: sessionId,
      stripePaymentIntentId: "pi_repair",
    });
    const order = await prisma.storeOrder.findFirst({ where: { checkoutAttemptId: prepared.attemptId } });
    expect(order).toBeTruthy();
    await ensureFoundationTransferIntent(prisma, {
      storeOrderId: order!.id,
      memberId: ctx.member.id,
      amountCents: 990,
    });
    await persistFoundationTransferSuccess(prisma, {
      storeOrderId: order!.id,
      stripeTransferId: `tr_repair_${order!.id}`,
    });
    await prisma.storeOrder.update({
      where: { id: order!.id },
      data: { status: "paid", commerceStatus: "FINALIZED" },
    });
    expect(await prisma.sellerBalanceTransaction.count({ where: { orderId: order!.id, type: "sale" } })).toBe(0);
    const classified = await applyFoundationCheckoutProviderObservation(
      prisma,
      prepared.attemptId,
      sessionObservation(sessionId, "complete", "paid", { paymentIntentId: "pi_repair" })
    );
    expect(classified.classification).toBe("PAID_NEEDS_FULFILLMENT");
    const candidates = await listFoundationCheckoutReconciliationCandidates(prisma, { take: 500, now: new Date() });
    expect(candidates.map((row) => row.id)).toContain(prepared.attemptId);
  });
});
