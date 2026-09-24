import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  COMMERCE_FOUNDATION_CUTOVER_SINGLETON_ID,
  CommerceFoundationCutoverBlockedError,
  CommerceFoundationWriterModeError,
  transitionCommerceFoundationCutover,
} from "../commerce-foundation-cutover";
import {
  canonicalCheckoutVariantIdentity,
  checkoutPrepareAdvisoryLockKeys,
  classifyStripeSessionCreateFailure,
  expireFoundationCheckoutAttempt,
  failCheckoutAttemptAndRelease,
  finalizeFoundationCheckoutPayment,
  FOUNDATION_MTO_PURCHASE_CAP,
  foundationAttemptExpiryDecision,
  FoundationCheckoutNotConvertibleError,
  FoundationCheckoutReuseError,
  hashFoundationCart,
  markCheckoutAttemptSessionOpen,
  markCheckoutAttemptSessionUnknown,
  prepareFoundationCheckout,
  stripeCheckoutRequestOptions,
} from "../commerce-foundation-checkout";
import {
  FoundationInsufficientAvailabilityError,
  FoundationMissingStateError,
} from "../commerce-foundation-inventory";
import {
  convertReservation,
  holdTrackedReservation,
  projectStoreItemQuantity,
  releaseReservation,
  restockTrackedVariant,
  setTrackedOnHand,
  trackedAvailable,
} from "../commerce-foundation-inventory";
import {
  applyFoundationSellerQuantitySets,
  assertFoundationMatrixStructureUnchanged,
  markFoundationListingSold,
  provisionNativeFoundationListing,
  relistFoundationListing,
  restockFoundationOrderLine,
} from "../commerce-foundation-listing";
import { reconcileStoreItemQuantities, verifyFoundationListingHealth } from "../commerce-foundation-health";
import { FoundationVariantResolutionError, resolveCheckoutVariant } from "../commerce-foundation-variant-resolution";
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
  await transitionCommerceFoundationCutover(prisma, { to: "FROZEN" });
  await transitionCommerceFoundationCutover(prisma, {
    to: "BACKFILLING",
    engineSha: "engine-test",
    manifestHash: "manifest-test",
  });
  await transitionCommerceFoundationCutover(prisma, { to: "FOUNDATION" });
}

async function trackedSimple(qty: number, opts?: { skipEnter?: boolean }) {
  if (!opts?.skipEnter) await enterFoundation();
  const member = await createMember(prisma, "inv");
  const item = await createStoreItem(prisma, member.id, "Simple tracked", { quantity: qty });
  const provisioned = await prisma.$transaction((tx) => provisionNativeFoundationListing(tx, item.id));
  return { member, item, variantId: provisioned.variantIds[0] };
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

describe("foundation inventory SET / HOLD / RELEASE / CONVERT", () => {
  it("SIMPLE seller SET updates onHand, preserves reserved, appends SET, bumps version, projects quantity", async () => {
    const ctx = await trackedSimple(2);
    const buyer = await createMember(prisma, "set-buyer");
    const attempt = await prisma.checkoutAttempt.create({
      data: {
        buyerMemberId: buyer.id,
        cartHash: "set-cart",
        amountCents: 1000,
        stripeIdempotencyKey: `idem-simple-set-${ctx.item.id}`,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const order = await prisma.storeOrder.create({
      data: {
        buyerId: buyer.id,
        sellerId: ctx.member.id,
        totalCents: 1000,
        subtotalCents: 1000,
        checkoutAttemptId: attempt.id,
      },
    });
    const line = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        storeItemId: ctx.item.id,
        quantity: 1,
        priceCentsAtPurchase: 1000,
        variantId: ctx.variantId,
      },
    });
    await prisma.$transaction((tx) =>
      holdTrackedReservation(tx, {
        checkoutAttemptId: attempt.id,
        storeOrderId: order.id,
        orderItemId: line.id,
        variantId: ctx.variantId,
        qty: 1,
        expiresAt: new Date(Date.now() + 60_000),
      })
    );

    const before = await prisma.inventoryState.findUnique({ where: { variantId: ctx.variantId } });
    expect(before?.onHand).toBe(2);
    expect(before?.reserved).toBe(1);
    expect(before?.availabilityVersion).toBe(2);

    const result = await prisma.$transaction((tx) =>
      setTrackedOnHand(tx, {
        variantId: ctx.variantId,
        targetOnHand: 5,
        commandId: `cmd-set-${ctx.item.id}`,
        memberId: ctx.member.id,
      })
    );
    expect(result.onHand).toBe(5);
    expect(result.reserved).toBe(1);
    expect(result.quantity).toBe(4);

    const after = await prisma.inventoryState.findUnique({ where: { variantId: ctx.variantId } });
    expect(after?.availabilityVersion).toBe(3);
    const events = await prisma.inventoryEvent.findMany({
      where: { variantId: ctx.variantId, eventType: "SET" },
    });
    expect(events).toHaveLength(1);
    expect(events[0].targetOnHand).toBe(5);
  });

  it("MATRIX seller SET mutates one Variant only and projects the aggregate", async () => {
    await enterFoundation();
    const member = await createMember(prisma, "matrix");
    const item = await createStoreItem(prisma, member.id, "Matrix", {
      quantity: 3,
      variants: {
        axes: [{ name: "Color", values: ["Red", "Blue"] }],
        skus: [
          { options: { Color: "Red" }, quantity: 2 },
          { options: { Color: "Blue" }, quantity: 1 },
        ],
      },
    });
    const provisioned = await prisma.$transaction((tx) => provisionNativeFoundationListing(tx, item.id));
    expect(provisioned.kind).toBe("matrix");
    const variants = await prisma.storeVariant.findMany({ where: { storeItemId: item.id } });
    const red = variants.find((v) => JSON.stringify(v.options).toLowerCase().includes("red"))!;
    const blue = variants.find((v) => JSON.stringify(v.options).toLowerCase().includes("blue"))!;
    const redId = red.id;
    await prisma.$transaction((tx) =>
      setTrackedOnHand(tx, {
        variantId: redId,
        targetOnHand: 9,
        commandId: `matrix-set-${item.id}`,
        memberId: member.id,
      })
    );
    const redState = await prisma.inventoryState.findUnique({ where: { variantId: redId } });
    const blueState = await prisma.inventoryState.findUnique({ where: { variantId: blue.id } });
    expect(redState?.onHand).toBe(9);
    expect(blueState?.onHand).toBe(1);
    expect(blue.id).toBe(blue.id);
    const projected = await prisma.storeItem.findUnique({ where: { id: item.id } });
    expect(projected?.quantity).toBe(10);
  });

  it("rejects a single quantity SET against a matrix listing", async () => {
    await enterFoundation();
    const member = await createMember(prisma, "ambig");
    const item = await createStoreItem(prisma, member.id, "Ambiguous matrix", {
      quantity: 3,
      variants: {
        axes: [{ name: "Color", values: ["Red", "Blue"] }],
        skus: [
          { options: { Color: "Red" }, quantity: 2 },
          { options: { Color: "Blue" }, quantity: 1 },
        ],
      },
    });
    await prisma.$transaction((tx) => provisionNativeFoundationListing(tx, item.id));
    await expect(
      prisma.$transaction((tx) =>
        applyFoundationSellerQuantitySets(tx, {
          storeItemId: item.id,
          memberId: member.id,
          commandId: `ambig-${item.id}`,
          simpleTarget: 4,
        })
      )
    ).rejects.toMatchObject({ code: "ambiguous_bulk_quantity" });
  });

  it("HOLD reduces available and projects quantity; concurrent last-unit HOLD allows one winner", async () => {
    const ctx = await trackedSimple(1);
    const buyer = await createMember(prisma, "hold");
    const attempt = await prisma.checkoutAttempt.create({
      data: {
        buyerMemberId: buyer.id,
        cartHash: "hold",
        amountCents: 1000,
        stripeIdempotencyKey: `hold-${ctx.item.id}`,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const order = await prisma.storeOrder.create({
      data: {
        buyerId: buyer.id,
        sellerId: ctx.member.id,
        totalCents: 1000,
        subtotalCents: 1000,
        checkoutAttemptId: attempt.id,
      },
    });
    const line = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        storeItemId: ctx.item.id,
        quantity: 1,
        priceCentsAtPurchase: 1000,
        variantId: ctx.variantId,
      },
    });
    await prisma.$transaction((tx) =>
      holdTrackedReservation(tx, {
        checkoutAttemptId: attempt.id,
        storeOrderId: order.id,
        orderItemId: line.id,
        variantId: ctx.variantId,
        qty: 1,
        expiresAt: new Date(Date.now() + 60_000),
      })
    );
    const held = await prisma.inventoryState.findUnique({ where: { variantId: ctx.variantId } });
    expect(held?.onHand).toBe(1);
    expect(held?.reserved).toBe(1);
    expect(trackedAvailable(held!.onHand!, held!.reserved!)).toBe(0);
    const item = await prisma.storeItem.findUnique({ where: { id: ctx.item.id } });
    expect(item?.quantity).toBe(0);

    const heldReservation = await prisma.inventoryReservation.findUnique({ where: { orderItemId: line.id } });
    await prisma.$transaction((tx) =>
      releaseReservation(tx, {
        reservationId: heldReservation!.id,
        reason: "RESET",
      })
    );

    const buyerA = await createMember(prisma, "c1");
    const buyerB = await createMember(prisma, "c2");
    async function attemptHold(buyerId: string, suffix: string) {
      const a = await prisma.checkoutAttempt.create({
        data: {
          buyerMemberId: buyerId,
          cartHash: suffix,
          amountCents: 1000,
          stripeIdempotencyKey: `conc-${suffix}-${ctx.item.id}`,
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
      const o = await prisma.storeOrder.create({
        data: {
          buyerId,
          sellerId: ctx.member.id,
          totalCents: 1000,
          subtotalCents: 1000,
          checkoutAttemptId: a.id,
        },
      });
      const li = await prisma.orderItem.create({
        data: {
          orderId: o.id,
          storeItemId: ctx.item.id,
          quantity: 1,
          priceCentsAtPurchase: 1000,
          variantId: ctx.variantId,
        },
      });
      return prisma.$transaction((tx) =>
        holdTrackedReservation(tx, {
          checkoutAttemptId: a.id,
          storeOrderId: o.id,
          orderItemId: li.id,
          variantId: ctx.variantId,
          qty: 1,
          expiresAt: new Date(Date.now() + 60_000),
        })
      );
    }
    const results = await Promise.allSettled([attemptHold(buyerA.id, "a"), attemptHold(buyerB.id, "b")]);
    const wins = results.filter((r) => r.status === "fulfilled");
    const losses = results.filter((r) => r.status === "rejected");
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
    expect((losses[0] as PromiseRejectedResult).reason).toBeInstanceOf(FoundationInsufficientAvailabilityError);
  });

  it("RELEASE restores reserved/projection and is idempotent", async () => {
    const ctx = await trackedSimple(2);
    const prepared = await prepareFoundationCheckout(prisma, {
      buyerMemberId: (await createMember(prisma, "rel-buyer")).id,
      amountCents: 1000,
      orders: [
        {
          sellerId: ctx.member.id,
          subtotalCents: 1000,
          shippingCostCents: 0,
          totalCents: 1000,
          lines: [{ storeItemId: ctx.item.id, quantity: 1, priceCentsAtPurchase: 1000, variantId: ctx.variantId }],
        },
      ],
    });
    const reservation = await prisma.inventoryReservation.findFirst({
      where: { checkoutAttemptId: prepared.attemptId },
    });
    expect(reservation?.activeQty).toBe(1);
    await prisma.$transaction((tx) => releaseReservation(tx, { reservationId: reservation!.id, reason: "CANCEL" }));
    const after = await prisma.inventoryState.findUnique({ where: { variantId: ctx.variantId } });
    expect(after?.onHand).toBe(2);
    expect(after?.reserved).toBe(0);
    const qty = await prisma.storeItem.findUnique({ where: { id: ctx.item.id } });
    expect(qty?.quantity).toBe(2);
    await prisma.$transaction((tx) => releaseReservation(tx, { reservationId: reservation!.id, reason: "CANCEL" }));
    const again = await prisma.inventoryState.findUnique({ where: { variantId: ctx.variantId } });
    expect(again?.reserved).toBe(0);
    const releases = await prisma.inventoryEvent.findMany({
      where: { variantId: ctx.variantId, eventType: "RESERVATION_RELEASE" },
    });
    expect(releases).toHaveLength(1);
  });

  it("CONVERT consumes once; duplicate paid finalization does not consume again", async () => {
    const ctx = await trackedSimple(2);
    const buyer = await createMember(prisma, "pay");
    const prepared = await prepareFoundationCheckout(prisma, {
      buyerMemberId: buyer.id,
      amountCents: 1000,
      orders: [
        {
          sellerId: ctx.member.id,
          subtotalCents: 1000,
          shippingCostCents: 0,
          totalCents: 1000,
          lines: [{ storeItemId: ctx.item.id, quantity: 1, priceCentsAtPurchase: 1000, variantId: ctx.variantId }],
        },
      ],
    });
    const first = await finalizeFoundationCheckoutPayment(prisma, { attemptId: prepared.attemptId });
    expect(first.converted).toBe(1);
    const state = await prisma.inventoryState.findUnique({ where: { variantId: ctx.variantId } });
    expect(state?.onHand).toBe(1);
    expect(state?.reserved).toBe(0);
    const item = await prisma.storeItem.findUnique({ where: { id: ctx.item.id } });
    expect(item?.quantity).toBe(1);
    const converts = await prisma.inventoryEvent.findMany({
      where: { variantId: ctx.variantId, eventType: "RESERVATION_CONVERT" },
    });
    expect(converts).toHaveLength(1);
    const second = await finalizeFoundationCheckoutPayment(prisma, { attemptId: prepared.attemptId });
    expect(second.alreadyFinalized).toBe(true);
    const state2 = await prisma.inventoryState.findUnique({ where: { variantId: ctx.variantId } });
    expect(state2?.onHand).toBe(1);
  });

  it("fully reserved inventory projects 0 but stays active until CONVERT zeros onHand", async () => {
    const ctx = await trackedSimple(1);
    const buyer = await createMember(prisma, "full");
    const prepared = await prepareFoundationCheckout(prisma, {
      buyerMemberId: buyer.id,
      amountCents: 1000,
      orders: [
        {
          sellerId: ctx.member.id,
          subtotalCents: 1000,
          shippingCostCents: 0,
          totalCents: 1000,
          lines: [{ storeItemId: ctx.item.id, quantity: 1, priceCentsAtPurchase: 1000, variantId: ctx.variantId }],
        },
      ],
    });
    const heldItem = await prisma.storeItem.findUnique({ where: { id: ctx.item.id } });
    expect(heldItem?.quantity).toBe(0);
    expect(heldItem?.status).toBe("active");
    await finalizeFoundationCheckoutPayment(prisma, { attemptId: prepared.attemptId });
    const sold = await prisma.storeItem.findUnique({ where: { id: ctx.item.id } });
    expect(sold?.status).toBe("sold_out");
    expect(sold?.quantity).toBe(0);
  });

  it("matrix sold_out only when every Variant onHand is 0", async () => {
    await enterFoundation();
    const member = await createMember(prisma, "sold");
    const item = await createStoreItem(prisma, member.id, "Matrix sold", {
      quantity: 1,
      variants: {
        axes: [{ name: "Size", values: ["S", "M"] }],
        skus: [
          { options: { Size: "S" }, quantity: 0 },
          { options: { Size: "M" }, quantity: 1 },
        ],
      },
    });
    const provisioned = await prisma.$transaction((tx) => provisionNativeFoundationListing(tx, item.id));
    const afterProvision = await prisma.storeItem.findUnique({ where: { id: item.id } });
    expect(afterProvision?.status).toBe("active");
    const variants = await prisma.storeVariant.findMany({ where: { storeItemId: item.id } });
    const live = variants.find((v) => JSON.stringify(v.options).toLowerCase().includes('"m"'))!;
    await prisma.$transaction((tx) =>
      setTrackedOnHand(tx, { variantId: live.id, targetOnHand: 0, commandId: `zero-${item.id}` })
    );
    await prisma.$transaction(async (tx) => {
      const { maybeMarkSoldOutIfPhysicallyGone } = await import("../commerce-foundation-inventory");
      await maybeMarkSoldOutIfPhysicallyGone(tx, item.id);
    });
    const sold = await prisma.storeItem.findUnique({ where: { id: item.id } });
    expect(sold?.status).toBe("sold_out");
    expect(provisioned.variantIds).toHaveLength(2);
  });

  it("physical restock reactivates sold_out but not inactive listings", async () => {
    const ctx = await trackedSimple(1);
    await prisma.$transaction((tx) =>
      setTrackedOnHand(tx, { variantId: ctx.variantId, targetOnHand: 0, commandId: `empty-${ctx.item.id}` })
    );
    await prisma.storeItem.update({ where: { id: ctx.item.id }, data: { status: "sold_out" } });
    await prisma.$transaction((tx) =>
      restockTrackedVariant(tx, {
        variantId: ctx.variantId,
        qty: 1,
        kind: "PHYSICAL_RECEIPT",
        sourceFactId: `return-${ctx.item.id}`,
      })
    );
    const active = await prisma.storeItem.findUnique({ where: { id: ctx.item.id } });
    expect(active?.status).toBe("active");
    expect(active?.quantity).toBe(1);

    const inactive = await trackedSimple(0, { skipEnter: true });
    await prisma.storeItem.update({
      where: { id: inactive.item.id },
      data: { status: "inactive", endedAt: new Date() },
    });
    await prisma.$transaction((tx) =>
      restockTrackedVariant(tx, {
        variantId: inactive.variantId,
        qty: 1,
        kind: "PHYSICAL_RECEIPT",
        sourceFactId: `inactive-${inactive.item.id}`,
      })
    );
    const stillInactive = await prisma.storeItem.findUnique({ where: { id: inactive.item.id } });
    expect(stillInactive?.status).toBe("inactive");
  });

  it("MTO has null onHand/reserved, quantity 0, and checkout skips HOLD", async () => {
    await enterFoundation();
    const member = await createMember(prisma, "mto");
    const item = await createStoreItem(prisma, member.id, "MTO", {
      quantity: 999,
      inventoryTracking: "made_to_order",
    });
    const provisioned = await prisma.$transaction((tx) => provisionNativeFoundationListing(tx, item.id));
    const state = await prisma.inventoryState.findUnique({ where: { variantId: provisioned.variantIds[0] } });
    expect(state?.mode).toBe("MADE_TO_ORDER");
    expect(state?.onHand).toBeNull();
    expect(state?.reserved).toBeNull();
    const projected = await prisma.storeItem.findUnique({ where: { id: item.id } });
    expect(projected?.quantity).toBe(0);
    const buyer = await createMember(prisma, "mto-buy");
    const prepared = await prepareFoundationCheckout(prisma, {
      buyerMemberId: buyer.id,
      amountCents: 1000,
      orders: [
        {
          sellerId: member.id,
          subtotalCents: 1000,
          shippingCostCents: 0,
          totalCents: 1000,
          lines: [
            {
              storeItemId: item.id,
              quantity: 2,
              priceCentsAtPurchase: 500,
              variantId: provisioned.variantIds[0],
            },
          ],
        },
      ],
    });
    const reservations = await prisma.inventoryReservation.findMany({
      where: { checkoutAttemptId: prepared.attemptId },
    });
    expect(reservations).toHaveLength(0);
    const line = await prisma.orderItem.findFirst({ where: { orderId: prepared.orderIds[0] } });
    expect(line?.variantId).toBe(provisioned.variantIds[0]);
  });
});

describe("foundation checkout / resolution / expiry", () => {
  it("new OrderItem.variantId is populated; historical null rows remain valid", async () => {
    const ctx = await trackedSimple(2);
    const buyer = await createMember(prisma, "hist");
    const historical = await prisma.storeOrder.create({
      data: { buyerId: buyer.id, sellerId: ctx.member.id, totalCents: 1000, subtotalCents: 1000 },
    });
    const legacyLine = await prisma.orderItem.create({
      data: {
        orderId: historical.id,
        storeItemId: ctx.item.id,
        quantity: 1,
        priceCentsAtPurchase: 1000,
        variantId: null,
      },
    });
    expect(legacyLine.variantId).toBeNull();
    const prepared = await prepareFoundationCheckout(prisma, {
      buyerMemberId: buyer.id,
      amountCents: 1000,
      orders: [
        {
          sellerId: ctx.member.id,
          subtotalCents: 1000,
          shippingCostCents: 0,
          totalCents: 1000,
          lines: [{ storeItemId: ctx.item.id, quantity: 1, priceCentsAtPurchase: 1000 }],
        },
      ],
    });
    const fresh = await prisma.orderItem.findFirst({ where: { orderId: prepared.orderIds[0] } });
    expect(fresh?.variantId).toBe(ctx.variantId);
  });

  it("SIMPLE cart omits variantId and resolves default; MATRIX map resolves; bad matrix rejects", async () => {
    const ctx = await trackedSimple(1);
    const simple = await resolveCheckoutVariant(prisma, ctx.item.id, {});
    expect(simple.id).toBe(ctx.variantId);

    const member = await createMember(prisma, "map");
    const item = await createStoreItem(prisma, member.id, "Mapped", {
      quantity: 1,
      variants: {
        axes: [{ name: "Color", values: ["Red"] }],
        skus: [{ options: { Color: "Red" }, quantity: 1 }],
      },
    });
    const provisioned = await prisma.$transaction((tx) => provisionNativeFoundationListing(tx, item.id));
    await prisma.variantBackfillMap.create({
      data: {
        storeItemId: item.id,
        memberId: member.id,
        sourceFingerprint: "matrix:color=red",
        variantId: provisioned.variantIds[0],
      },
    });
    const mapped = await resolveCheckoutVariant(prisma, item.id, { optionJson: { Color: "Red" } });
    expect(mapped.id).toBe(provisioned.variantIds[0]);
    const nativeMember = await createMember(prisma, "native-mx");
    const nativeItem = await createStoreItem(prisma, nativeMember.id, "Native matrix", {
      quantity: 1,
      variants: {
        axes: [{ name: "Size", values: ["M"] }],
        skus: [{ options: { Size: "M" }, quantity: 1 }],
      },
    });
    const nativeProvisioned = await prisma.$transaction((tx) =>
      provisionNativeFoundationListing(tx, nativeItem.id)
    );
    const nativeResolved = await resolveCheckoutVariant(prisma, nativeItem.id, {
      optionJson: { Size: "M" },
    });
    expect(nativeResolved.id).toBe(nativeProvisioned.variantIds[0]);
    await expect(resolveCheckoutVariant(prisma, item.id, { optionJson: { Color: "Nope" } })).rejects.toBeInstanceOf(
      FoundationVariantResolutionError
    );
  });

  it("multi-seller checkout rolls back when one seller cannot reserve", async () => {
    const a = await trackedSimple(1);
    const sellerB = await createMember(prisma, "b");
    const itemB = await createStoreItem(prisma, sellerB.id, "Empty B", { quantity: 0 });
    await prisma.$transaction((tx) => provisionNativeFoundationListing(tx, itemB.id));
    const buyer = await createMember(prisma, "multi");
    await expect(
      prepareFoundationCheckout(prisma, {
        buyerMemberId: buyer.id,
        amountCents: 2000,
        orders: [
          {
            sellerId: a.member.id,
            subtotalCents: 1000,
            shippingCostCents: 0,
            totalCents: 1000,
            lines: [{ storeItemId: a.item.id, quantity: 1, priceCentsAtPurchase: 1000, variantId: a.variantId }],
          },
          {
            sellerId: sellerB.id,
            subtotalCents: 1000,
            shippingCostCents: 0,
            totalCents: 1000,
            lines: [{ storeItemId: itemB.id, quantity: 1, priceCentsAtPurchase: 1000 }],
          },
        ],
      })
    ).rejects.toBeInstanceOf(FoundationInsufficientAvailabilityError);
    const attempts = await prisma.checkoutAttempt.findMany({ where: { buyerMemberId: buyer.id } });
    expect(attempts).toHaveLength(0);
    const reservations = await prisma.inventoryReservation.findMany({ where: { storeItemId: a.item.id } });
    expect(reservations).toHaveLength(0);
    const state = await prisma.inventoryState.findUnique({ where: { variantId: a.variantId } });
    expect(state?.reserved).toBe(0);
  });

  it("definitive Stripe failure releases holds; unknown outcome keeps them", async () => {
    const ctx = await trackedSimple(1);
    const buyer = await createMember(prisma, "stripe");
    const prepared = await prepareFoundationCheckout(prisma, {
      buyerMemberId: buyer.id,
      amountCents: 1000,
      orders: [
        {
          sellerId: ctx.member.id,
          subtotalCents: 1000,
          shippingCostCents: 0,
          totalCents: 1000,
          lines: [{ storeItemId: ctx.item.id, quantity: 1, priceCentsAtPurchase: 1000, variantId: ctx.variantId }],
        },
      ],
    });
    expect(classifyStripeSessionCreateFailure({ type: "StripeInvalidRequestError" })).toBe("failed");
    expect(classifyStripeSessionCreateFailure({ type: "StripeConnectionError" })).toBe("unknown");
    await failCheckoutAttemptAndRelease(prisma, prepared.attemptId);
    const failed = await prisma.checkoutAttempt.findUnique({ where: { id: prepared.attemptId } });
    expect(failed?.state).toBe("SESSION_FAILED");
    const released = await prisma.inventoryReservation.findFirst({
      where: { checkoutAttemptId: prepared.attemptId },
    });
    expect(released?.activeQty).toBe(0);
    const qty = await prisma.storeItem.findUnique({ where: { id: ctx.item.id } });
    expect(qty?.quantity).toBe(1);

    const prepared2 = await prepareFoundationCheckout(prisma, {
      buyerMemberId: buyer.id,
      amountCents: 1000,
      orders: [
        {
          sellerId: ctx.member.id,
          subtotalCents: 1000,
          shippingCostCents: 0,
          totalCents: 1000,
          lines: [{ storeItemId: ctx.item.id, quantity: 1, priceCentsAtPurchase: 1000, variantId: ctx.variantId }],
        },
      ],
    });
    await markCheckoutAttemptSessionUnknown(prisma, { attemptId: prepared2.attemptId });
    const unknown = await prisma.checkoutAttempt.findUnique({ where: { id: prepared2.attemptId } });
    expect(unknown?.state).toBe("SESSION_UNKNOWN");
    const stillHeld = await prisma.inventoryReservation.findFirst({
      where: { checkoutAttemptId: prepared2.attemptId },
    });
    expect(stillHeld?.activeQty).toBe(1);
  });

  it("LEGACY does not write foundation tables for SET", async () => {
    const member = await createMember(prisma, "legacy");
    const item = await createStoreItem(prisma, member.id, "Legacy", { quantity: 4 });
    await expect(
      prisma.$transaction((tx) =>
        setTrackedOnHand(tx, { variantId: "missing", targetOnHand: 1, commandId: "x", memberId: member.id })
      )
    ).rejects.toBeInstanceOf(CommerceFoundationWriterModeError);
    expect(await prisma.storeVariant.count({ where: { storeItemId: item.id } })).toBe(0);
    expect(await prisma.inventoryState.count({ where: { storeItemId: item.id } })).toBe(0);
    expect(await prisma.inventoryEvent.count({ where: { storeItemId: item.id } })).toBe(0);
  });

  it("FROZEN and BACKFILLING block foundation SET", async () => {
    await transitionCommerceFoundationCutover(prisma, { to: "FROZEN" });
    await expect(
      prisma.$transaction((tx) => setTrackedOnHand(tx, { variantId: "x", targetOnHand: 1, commandId: "f" }))
    ).rejects.toBeInstanceOf(CommerceFoundationCutoverBlockedError);
    await transitionCommerceFoundationCutover(prisma, {
      to: "BACKFILLING",
      engineSha: "e",
      manifestHash: "m",
    });
    await expect(
      prisma.$transaction((tx) => setTrackedOnHand(tx, { variantId: "x", targetOnHand: 1, commandId: "b" }))
    ).rejects.toBeInstanceOf(CommerceFoundationCutoverBlockedError);
  });

  it("FOUNDATION missing Variant fails closed", async () => {
    await enterFoundation();
    const member = await createMember(prisma, "missing");
    const item = await createStoreItem(prisma, member.id, "No variants", { quantity: 2 });
    await expect(resolveCheckoutVariant(prisma, item.id, {})).rejects.toBeInstanceOf(FoundationVariantResolutionError);
    await expect(
      prepareFoundationCheckout(prisma, {
        buyerMemberId: (await createMember(prisma, "miss-buy")).id,
        amountCents: 1000,
        orders: [
          {
            sellerId: member.id,
            subtotalCents: 1000,
            shippingCostCents: 0,
            totalCents: 1000,
            lines: [{ storeItemId: item.id, quantity: 1, priceCentsAtPurchase: 1000 }],
          },
        ],
      })
    ).rejects.toBeInstanceOf(FoundationVariantResolutionError);
    expect(await prisma.inventoryEvent.count({ where: { storeItemId: item.id } })).toBe(0);
  });

  it("compatibility projection matches sum available across SET/HOLD/RELEASE/CONVERT/RESTOCK", async () => {
    const ctx = await trackedSimple(4);
    const check = async (expected: number) => {
      const mismatches = await reconcileStoreItemQuantities(prisma, [ctx.item.id]);
      expect(mismatches).toEqual([]);
      const item = await prisma.storeItem.findUnique({ where: { id: ctx.item.id } });
      expect(item?.quantity).toBe(expected);
      const health = await verifyFoundationListingHealth(prisma, ctx.item.id);
      expect(health.filter((i) => i.code === "quantity_projection")).toEqual([]);
    };
    await check(4);
    await prisma.$transaction((tx) =>
      setTrackedOnHand(tx, { variantId: ctx.variantId, targetOnHand: 6, commandId: `p1-${ctx.item.id}` })
    );
    await check(6);
    const prepared = await prepareFoundationCheckout(prisma, {
      buyerMemberId: (await createMember(prisma, "proj")).id,
      amountCents: 1000,
      orders: [
        {
          sellerId: ctx.member.id,
          subtotalCents: 1000,
          shippingCostCents: 0,
          totalCents: 1000,
          lines: [{ storeItemId: ctx.item.id, quantity: 2, priceCentsAtPurchase: 500, variantId: ctx.variantId }],
        },
      ],
    });
    await check(4);
    const reservation = await prisma.inventoryReservation.findFirst({
      where: { checkoutAttemptId: prepared.attemptId },
    });
    await prisma.$transaction((tx) => releaseReservation(tx, { reservationId: reservation!.id, reason: "TEST" }));
    await check(6);
    const prepared2 = await prepareFoundationCheckout(prisma, {
      buyerMemberId: (await createMember(prisma, "proj2")).id,
      amountCents: 1000,
      orders: [
        {
          sellerId: ctx.member.id,
          subtotalCents: 1000,
          shippingCostCents: 0,
          totalCents: 1000,
          lines: [{ storeItemId: ctx.item.id, quantity: 1, priceCentsAtPurchase: 1000, variantId: ctx.variantId }],
        },
      ],
    });
    await finalizeFoundationCheckoutPayment(prisma, { attemptId: prepared2.attemptId });
    await check(5);
    await prisma.$transaction((tx) =>
      restockTrackedVariant(tx, {
        variantId: ctx.variantId,
        qty: 1,
        kind: "UNDO_CONSUMPTION",
        sourceFactId: `undo-${ctx.item.id}`,
      })
    );
    await check(6);
  });

  it("expiry does not release a paid-but-unfinalized attempt", async () => {
    const ctx = await trackedSimple(1);
    const buyer = await createMember(prisma, "exp");
    const prepared = await prepareFoundationCheckout(prisma, {
      buyerMemberId: buyer.id,
      amountCents: 1000,
      orders: [
        {
          sellerId: ctx.member.id,
          subtotalCents: 1000,
          shippingCostCents: 0,
          totalCents: 1000,
          lines: [{ storeItemId: ctx.item.id, quantity: 1, priceCentsAtPurchase: 1000, variantId: ctx.variantId }],
        },
      ],
    });
    await prisma.checkoutAttempt.update({
      where: { id: prepared.attemptId },
      data: { paymentStatus: "PAID", state: "SESSION_OPEN" },
    });
    expect(
      foundationAttemptExpiryDecision({
        state: "SESSION_OPEN",
        paymentStatus: "PAID",
      })
    ).toBe("finalize");
    const decision = await expireFoundationCheckoutAttempt(prisma, prepared.attemptId);
    expect(decision).toBe("finalize");
    const reservation = await prisma.inventoryReservation.findFirst({
      where: { checkoutAttemptId: prepared.attemptId },
    });
    expect(reservation?.activeQty).toBe(1);
    const order = await prisma.storeOrder.findFirst({ where: { checkoutAttemptId: prepared.attemptId } });
    expect(order?.status).toBe("pending");
    expect(order?.commerceStatus).toBe("PENDING");
  });
});

function checkoutLines(sellerId: string, itemId: string, variantId: string, quantity = 1) {
  return {
    sellerId,
    subtotalCents: 1000 * quantity,
    shippingCostCents: 0,
    totalCents: 1000 * quantity,
    lines: [{ storeItemId: itemId, quantity, priceCentsAtPurchase: 1000, variantId }],
  };
}

describe("prompt-65 checkout idempotency / races / restock", () => {
  it("Stripe Checkout Session options use the attempt idempotency key and retries reuse holds", async () => {
    const ctx = await trackedSimple(1);
    const buyer = await createMember(prisma, "idem");
    const input = {
      buyerMemberId: buyer.id,
      amountCents: 1000,
      orders: [checkoutLines(ctx.member.id, ctx.item.id, ctx.variantId)],
    };
    const first = await prepareFoundationCheckout(prisma, input);
    expect(stripeCheckoutRequestOptions(first).idempotencyKey).toBe(first.stripeIdempotencyKey);
    const second = await prepareFoundationCheckout(prisma, input);
    expect(second.reused).toBe(true);
    expect(second.attemptId).toBe(first.attemptId);
    expect(second.stripeIdempotencyKey).toBe(first.stripeIdempotencyKey);
    expect(await prisma.checkoutAttempt.count({ where: { buyerMemberId: buyer.id } })).toBe(1);
    expect(await prisma.inventoryReservation.count({ where: { checkoutAttemptId: first.attemptId } })).toBe(1);
  });

  it("session create success then local persist failure keeps holds as SESSION_UNKNOWN", async () => {
    const ctx = await trackedSimple(1);
    const buyer = await createMember(prisma, "persist");
    const input = {
      buyerMemberId: buyer.id,
      amountCents: 1000,
      orders: [checkoutLines(ctx.member.id, ctx.item.id, ctx.variantId)],
    };
    const prepared = await prepareFoundationCheckout(prisma, input);
    await markCheckoutAttemptSessionUnknown(prisma, {
      attemptId: prepared.attemptId,
      stripeCheckoutSessionId: `cs_persist_${prepared.attemptId}`,
    });
    const attempt = await prisma.checkoutAttempt.findUnique({ where: { id: prepared.attemptId } });
    expect(attempt?.state).toBe("SESSION_UNKNOWN");
    expect(attempt?.stripeCheckoutSessionId).toBe(`cs_persist_${prepared.attemptId}`);
    const reservation = await prisma.inventoryReservation.findFirst({
      where: { checkoutAttemptId: prepared.attemptId },
    });
    expect(reservation?.activeQty).toBe(1);
    expect(reservation?.releasedQty).toBe(0);
    const retry = await prepareFoundationCheckout(prisma, input);
    expect(retry.reused).toBe(true);
    expect(retry.attemptId).toBe(prepared.attemptId);
    expect(retry.stripeCheckoutSessionId).toBe(`cs_persist_${prepared.attemptId}`);
    expect(await prisma.checkoutAttempt.count({ where: { buyerMemberId: buyer.id } })).toBe(1);
  });

  it("SESSION_UNKNOWN without a recoverable Session id reuses the same attempt and key (no second attempt)", async () => {
    const ctx = await trackedSimple(1);
    const buyer = await createMember(prisma, "unknown");
    const input = {
      buyerMemberId: buyer.id,
      amountCents: 1000,
      orders: [checkoutLines(ctx.member.id, ctx.item.id, ctx.variantId)],
    };
    const prepared = await prepareFoundationCheckout(prisma, input);
    await markCheckoutAttemptSessionUnknown(prisma, { attemptId: prepared.attemptId });
    const retry = await prepareFoundationCheckout(prisma, input);
    expect(retry.reused).toBe(true);
    expect(retry.attemptId).toBe(prepared.attemptId);
    expect(retry.stripeIdempotencyKey).toBe(prepared.stripeIdempotencyKey);
    expect(retry.state).toBe("SESSION_UNKNOWN");
    expect(retry.stripeCheckoutSessionId).toBeNull();
    expect(await prisma.checkoutAttempt.count({ where: { buyerMemberId: buyer.id } })).toBe(1);
    const reservation = await prisma.inventoryReservation.findFirst({
      where: { checkoutAttemptId: prepared.attemptId },
    });
    expect(reservation?.activeQty).toBe(1);
  });

  it("idempotency mismatch / timeout classify as unknown; InvalidRequest as failed", () => {
    expect(
      classifyStripeSessionCreateFailure({
        type: "StripeIdempotencyError",
        message: "Keys for idempotent requests can only be used with the same parameters",
      })
    ).toBe("unknown");
    expect(
      classifyStripeSessionCreateFailure({
        type: "StripeInvalidRequestError",
        message: "Keys for idempotent requests can only be used with the same parameters",
      })
    ).toBe("unknown");
    expect(classifyStripeSessionCreateFailure({ type: "StripeConnectionError" })).toBe("unknown");
    expect(classifyStripeSessionCreateFailure({ message: "socket hang up" })).toBe("unknown");
    expect(classifyStripeSessionCreateFailure({ type: "StripeAPIError", statusCode: 500 })).toBe("unknown");
    expect(classifyStripeSessionCreateFailure({ type: "StripeInvalidRequestError", statusCode: 400 })).toBe(
      "failed"
    );
  });

  it("failCheckoutAttemptAndRelease refuses SESSION_UNKNOWN and SESSION_OPEN with known session", async () => {
    const ctx = await trackedSimple(1);
    const buyer = await createMember(prisma, "norelease");
    const prepared = await prepareFoundationCheckout(prisma, {
      buyerMemberId: buyer.id,
      amountCents: 1000,
      orders: [checkoutLines(ctx.member.id, ctx.item.id, ctx.variantId)],
    });
    await markCheckoutAttemptSessionUnknown(prisma, { attemptId: prepared.attemptId });
    await failCheckoutAttemptAndRelease(prisma, prepared.attemptId);
    const unknown = await prisma.checkoutAttempt.findUnique({ where: { id: prepared.attemptId } });
    expect(unknown?.state).toBe("SESSION_UNKNOWN");
    expect(
      (await prisma.inventoryReservation.findFirst({ where: { checkoutAttemptId: prepared.attemptId } }))
        ?.activeQty
    ).toBe(1);

    await markCheckoutAttemptSessionOpen(prisma, {
      attemptId: prepared.attemptId,
      stripeCheckoutSessionId: `cs_open_${prepared.attemptId}`,
    });
    await failCheckoutAttemptAndRelease(prisma, prepared.attemptId);
    const open = await prisma.checkoutAttempt.findUnique({ where: { id: prepared.attemptId } });
    expect(open?.state).toBe("SESSION_OPEN");
    expect(
      (await prisma.inventoryReservation.findFirst({ where: { checkoutAttemptId: prepared.attemptId } }))
        ?.activeQty
    ).toBe(1);
  });

  it("different Stripe Session id for same attempt fails closed", async () => {
    const ctx = await trackedSimple(1);
    const buyer = await createMember(prisma, "conflict");
    const prepared = await prepareFoundationCheckout(prisma, {
      buyerMemberId: buyer.id,
      amountCents: 1000,
      orders: [checkoutLines(ctx.member.id, ctx.item.id, ctx.variantId)],
    });
    await markCheckoutAttemptSessionOpen(prisma, {
      attemptId: prepared.attemptId,
      stripeCheckoutSessionId: `cs_a_${prepared.attemptId}`,
    });
    await expect(
      markCheckoutAttemptSessionOpen(prisma, {
        attemptId: prepared.attemptId,
        stripeCheckoutSessionId: `cs_b_${prepared.attemptId}`,
      })
    ).rejects.toMatchObject({ code: "checkout_session_conflict" });
    await expect(
      finalizeFoundationCheckoutPayment(prisma, {
        attemptId: prepared.attemptId,
        stripeCheckoutSessionId: `cs_b_${prepared.attemptId}`,
      })
    ).rejects.toMatchObject({ code: "checkout_session_conflict" });
    const attempt = await prisma.checkoutAttempt.findUnique({ where: { id: prepared.attemptId } });
    expect(attempt?.stripeCheckoutSessionId).toBe(`cs_a_${prepared.attemptId}`);
  });

  it("known session completion finalizes once; webhook replay is idempotent", async () => {
    const ctx = await trackedSimple(1);
    const buyer = await createMember(prisma, "once");
    const prepared = await prepareFoundationCheckout(prisma, {
      buyerMemberId: buyer.id,
      amountCents: 1000,
      orders: [checkoutLines(ctx.member.id, ctx.item.id, ctx.variantId)],
    });
    const sessionId = `cs_once_${prepared.attemptId}`;
    await markCheckoutAttemptSessionOpen(prisma, {
      attemptId: prepared.attemptId,
      stripeCheckoutSessionId: sessionId,
    });
    const first = await finalizeFoundationCheckoutPayment(prisma, {
      attemptId: prepared.attemptId,
      stripeCheckoutSessionId: sessionId,
      stripeEventId: `evt_once_${prepared.attemptId}`,
      eventType: "checkout.session.completed",
    });
    expect(first.alreadyFinalized).toBe(false);
    expect(first.converted).toBe(1);
    const second = await finalizeFoundationCheckoutPayment(prisma, {
      attemptId: prepared.attemptId,
      stripeCheckoutSessionId: sessionId,
      stripeEventId: `evt_once_replay_${prepared.attemptId}`,
      eventType: "checkout.session.completed",
    });
    expect(second.alreadyFinalized).toBe(true);
    expect(second.converted).toBe(0);
    expect(await prisma.storeOrder.count({ where: { checkoutAttemptId: prepared.attemptId } })).toBe(1);
    expect(
      await prisma.inventoryEvent.count({
        where: { variantId: ctx.variantId, eventType: "RESERVATION_CONVERT" },
      })
    ).toBe(1);
  });

  it("terminal SESSION_FAILED allows a new CheckoutAttempt with a new generation key", async () => {
    const ctx = await trackedSimple(1);
    const buyer = await createMember(prisma, "newgen");
    const input = {
      buyerMemberId: buyer.id,
      amountCents: 1000,
      orders: [checkoutLines(ctx.member.id, ctx.item.id, ctx.variantId)],
    };
    const first = await prepareFoundationCheckout(prisma, input);
    await failCheckoutAttemptAndRelease(prisma, first.attemptId);
    const second = await prepareFoundationCheckout(prisma, input);
    expect(second.reused).toBe(false);
    expect(second.attemptId).not.toBe(first.attemptId);
    expect(second.stripeIdempotencyKey).toContain("_g1");
    expect(second.stripeIdempotencyKey).not.toBe(first.stripeIdempotencyKey);
  });

  it("paid finalization after RELEASE does not mark commerce FINALIZED", async () => {
    const ctx = await trackedSimple(1);
    const buyer = await createMember(prisma, "rel-pay");
    const prepared = await prepareFoundationCheckout(prisma, {
      buyerMemberId: buyer.id,
      amountCents: 1000,
      orders: [checkoutLines(ctx.member.id, ctx.item.id, ctx.variantId)],
    });
    const expired = await expireFoundationCheckoutAttempt(prisma, prepared.attemptId);
    expect(expired).toBe("release_and_cancel");
    await expect(finalizeFoundationCheckoutPayment(prisma, { attemptId: prepared.attemptId })).rejects.toBeInstanceOf(
      FoundationCheckoutNotConvertibleError
    );
    const order = await prisma.storeOrder.findFirst({ where: { checkoutAttemptId: prepared.attemptId } });
    expect(order?.commerceStatus).toBe("PENDING");
    const reservation = await prisma.inventoryReservation.findFirst({
      where: { checkoutAttemptId: prepared.attemptId },
    });
    expect(reservation?.releasedQty).toBe(1);
    expect(reservation?.convertedQty).toBe(0);
    const events = await prisma.inventoryEvent.findMany({
      where: { variantId: ctx.variantId, eventType: "RESERVATION_CONVERT" },
    });
    expect(events).toHaveLength(0);
    const attempt = await prisma.checkoutAttempt.findUnique({ where: { id: prepared.attemptId } });
    expect(attempt?.paymentStatus).toBe("PAID");
    expect(attempt?.state).toBe("CLOSED");
    expect(attempt?.state).not.toBe("PAID");
  });

  it("expiry vs paid finalization concurrency yields exactly one terminal inventory outcome", async () => {
    const ctx = await trackedSimple(1);
    const buyer = await createMember(prisma, "race");
    const prepared = await prepareFoundationCheckout(prisma, {
      buyerMemberId: buyer.id,
      amountCents: 1000,
      orders: [checkoutLines(ctx.member.id, ctx.item.id, ctx.variantId)],
    });
    const results = await Promise.allSettled([
      expireFoundationCheckoutAttempt(prisma, prepared.attemptId),
      finalizeFoundationCheckoutPayment(prisma, { attemptId: prepared.attemptId }),
    ]);
    const reservation = await prisma.inventoryReservation.findFirst({
      where: { checkoutAttemptId: prepared.attemptId },
    });
    const order = await prisma.storeOrder.findFirst({ where: { checkoutAttemptId: prepared.attemptId } });
    const converted = reservation?.convertedQty === 1 && reservation.activeQty === 0 && reservation.releasedQty === 0;
    const released = reservation?.releasedQty === 1 && reservation.convertedQty === 0;
    expect(converted || released).toBe(true);
    expect(Boolean(converted) && Boolean(released)).toBe(false);
    if (converted) {
      expect(order?.commerceStatus).toBe("FINALIZED");
    } else {
      expect(order?.commerceStatus).toBe("PENDING");
      expect(results.some((r) => r.status === "rejected")).toBe(true);
    }
  });

  it("sibling Variant mutations project the exact final available sum", async () => {
    await enterFoundation();
    const member = await createMember(prisma, "sib");
    const item = await createStoreItem(prisma, member.id, "Matrix", {
      quantity: 5,
      variants: {
        axes: [{ name: "Color", values: ["Red", "Blue"] }],
        skus: [
          { options: { Color: "Red" }, quantity: 2 },
          { options: { Color: "Blue" }, quantity: 3 },
        ],
      },
    });
    const provisioned = await prisma.$transaction((tx) => provisionNativeFoundationListing(tx, item.id));
    expect(provisioned.variantIds).toHaveLength(2);
    const [red, blue] = provisioned.variantIds;
    await Promise.all([
      prisma.$transaction((tx) =>
        setTrackedOnHand(tx, { variantId: red, targetOnHand: 5, commandId: `sib-red-${item.id}` })
      ),
      prisma.$transaction((tx) =>
        setTrackedOnHand(tx, { variantId: blue, targetOnHand: 7, commandId: `sib-blue-${item.id}` })
      ),
    ]);
    const states = await prisma.inventoryState.findMany({ where: { storeItemId: item.id } });
    const available = states.reduce((sum, state) => sum + trackedAvailable(state.onHand!, state.reserved!), 0);
    const projected = await prisma.storeItem.findUnique({ where: { id: item.id } });
    expect(projected?.quantity).toBe(12);
    expect(projected?.quantity).toBe(available);
  });

  it("Mark Sold with an active HOLD rejects and leaves reservation/status unchanged", async () => {
    const ctx = await trackedSimple(1);
    const buyer = await createMember(prisma, "sold-hold");
    await prepareFoundationCheckout(prisma, {
      buyerMemberId: buyer.id,
      amountCents: 1000,
      orders: [checkoutLines(ctx.member.id, ctx.item.id, ctx.variantId)],
    });
    await expect(
      prisma.$transaction((tx) =>
        markFoundationListingSold(tx, {
          storeItemId: ctx.item.id,
          memberId: ctx.member.id,
          commandId: `sold-${ctx.item.id}`,
        })
      )
    ).rejects.toMatchObject({ code: "set_below_reserved" });
    const reservation = await prisma.inventoryReservation.findFirst({ where: { storeItemId: ctx.item.id } });
    expect(reservation?.activeQty).toBe(1);
    const item = await prisma.storeItem.findUnique({ where: { id: ctx.item.id } });
    expect(item?.status).toBe("active");
    const state = await prisma.inventoryState.findUnique({ where: { variantId: ctx.variantId } });
    expect(state?.onHand).toBe(1);
    expect(state?.reserved).toBe(1);
  });

  it("FOUNDATION matrix structural drop is rejected and leaves Variant rows unchanged", async () => {
    await enterFoundation();
    const member = await createMember(prisma, "struct");
    const item = await createStoreItem(prisma, member.id, "Drop", {
      quantity: 2,
      variants: {
        axes: [{ name: "Size", values: ["S", "M"] }],
        skus: [
          { options: { Size: "S" }, quantity: 1 },
          { options: { Size: "M" }, quantity: 1 },
        ],
      },
    });
    await prisma.$transaction((tx) => provisionNativeFoundationListing(tx, item.id));
    const before = await prisma.storeVariant.findMany({ where: { storeItemId: item.id } });
    await expect(
      prisma.$transaction((tx) => assertFoundationMatrixStructureUnchanged(tx, item.id, ["matrix:size=s"]))
    ).rejects.toMatchObject({ code: "structural_variant_change" });
    const after = await prisma.storeVariant.findMany({ where: { storeItemId: item.id } });
    expect(after.map((v) => v.id).sort()).toEqual(before.map((v) => v.id).sort());
  });

  it("SIMPLE bulk undo/relist use SET; matrix parent quantity is rejected", async () => {
    const ctx = await trackedSimple(4);
    await prisma.$transaction((tx) =>
      applyFoundationSellerQuantitySets(tx, {
        storeItemId: ctx.item.id,
        memberId: ctx.member.id,
        commandId: `bulk-undo-${ctx.item.id}`,
        simpleTarget: 2,
      })
    );
    const afterUndo = await prisma.inventoryState.findUnique({ where: { variantId: ctx.variantId } });
    expect(afterUndo?.onHand).toBe(2);
    await prisma.$transaction((tx) =>
      relistFoundationListing(tx, {
        storeItemId: ctx.item.id,
        memberId: ctx.member.id,
        commandId: `bulk-relist-${ctx.item.id}`,
        simpleTarget: 9,
      })
    );
    const afterRelist = await prisma.inventoryState.findUnique({ where: { variantId: ctx.variantId } });
    expect(afterRelist?.onHand).toBe(9);

    const member = await createMember(prisma, "mx-bulk");
    const matrix = await createStoreItem(prisma, member.id, "MX", {
      quantity: 2,
      variants: {
        axes: [{ name: "Color", values: ["Red", "Blue"] }],
        skus: [
          { options: { Color: "Red" }, quantity: 1 },
          { options: { Color: "Blue" }, quantity: 1 },
        ],
      },
    });
    await prisma.$transaction((tx) => provisionNativeFoundationListing(tx, matrix.id));
    await expect(
      prisma.$transaction((tx) =>
        applyFoundationSellerQuantitySets(tx, {
          storeItemId: matrix.id,
          memberId: member.id,
          commandId: `bulk-relist-mx-${matrix.id}`,
          simpleTarget: 4,
        })
      )
    ).rejects.toMatchObject({ code: "ambiguous_bulk_quantity" });
  });

  it("cash restock uses InventoryState + event + projection, not StoreItem increment", async () => {
    const ctx = await trackedSimple(1);
    const buyer = await createMember(prisma, "cash");
    const prepared = await prepareFoundationCheckout(prisma, {
      buyerMemberId: buyer.id,
      amountCents: 1000,
      orders: [checkoutLines(ctx.member.id, ctx.item.id, ctx.variantId)],
    });
    await finalizeFoundationCheckoutPayment(prisma, { attemptId: prepared.attemptId });
    const line = await prisma.orderItem.findFirst({ where: { orderId: prepared.orderIds[0] } });
    await prisma.$transaction((tx) =>
      restockFoundationOrderLine(
        tx,
        { id: line!.id, storeItemId: ctx.item.id, quantity: 1, variantId: ctx.variantId },
        "UNDO_CONSUMPTION",
        `order-relist:${prepared.orderIds[0]}`
      )
    );
    await prisma.$transaction((tx) =>
      restockFoundationOrderLine(
        tx,
        { id: line!.id, storeItemId: ctx.item.id, quantity: 1, variantId: ctx.variantId },
        "UNDO_CONSUMPTION",
        `seller-cancel-local-delivery:${prepared.orderIds[0]}`
      )
    );
    const state = await prisma.inventoryState.findUnique({ where: { variantId: ctx.variantId } });
    expect(state?.onHand).toBe(2);
    const events = await prisma.inventoryEvent.findMany({
      where: { variantId: ctx.variantId, eventType: "UNDO_CONSUMPTION" },
    });
    expect(events).toHaveLength(2);
    const item = await prisma.storeItem.findUnique({ where: { id: ctx.item.id } });
    expect(item?.quantity).toBe(2);
  });

  it("two distinct restock operation IDs both apply; retries of each are no-ops", async () => {
    const ctx = await trackedSimple(0);
    const buyer = await createMember(prisma, "partial");
    const order = await prisma.storeOrder.create({
      data: { buyerId: buyer.id, sellerId: ctx.member.id, totalCents: 1000, subtotalCents: 1000 },
    });
    const line = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        storeItemId: ctx.item.id,
        quantity: 1,
        priceCentsAtPurchase: 1000,
        variantId: ctx.variantId,
      },
    });
    await prisma.$transaction((tx) =>
      restockFoundationOrderLine(
        tx,
        { id: line.id, storeItemId: ctx.item.id, quantity: 1, variantId: ctx.variantId },
        "PHYSICAL_RECEIPT",
        `return:${order.id}:r1`
      )
    );
    await prisma.$transaction((tx) =>
      restockFoundationOrderLine(
        tx,
        { id: line.id, storeItemId: ctx.item.id, quantity: 1, variantId: ctx.variantId },
        "PHYSICAL_RECEIPT",
        `return:${order.id}:r2`
      )
    );
    await prisma.$transaction((tx) =>
      restockFoundationOrderLine(
        tx,
        { id: line.id, storeItemId: ctx.item.id, quantity: 1, variantId: ctx.variantId },
        "PHYSICAL_RECEIPT",
        `return:${order.id}:r1`
      )
    );
    const state = await prisma.inventoryState.findUnique({ where: { variantId: ctx.variantId } });
    expect(state?.onHand).toBe(2);
    const events = await prisma.inventoryEvent.findMany({
      where: { variantId: ctx.variantId, eventType: "PHYSICAL_RECEIPT" },
    });
    expect(events).toHaveLength(2);
  });

  it("MTO return restock converges without tracked inventory mutation", async () => {
    await enterFoundation();
    const member = await createMember(prisma, "mto-restock");
    const item = await createStoreItem(prisma, member.id, "MTO restock", {
      quantity: 999,
      inventoryTracking: "made_to_order",
    });
    const provisioned = await prisma.$transaction((tx) => provisionNativeFoundationListing(tx, item.id));
    const variantId = provisioned.variantIds[0];
    const buyer = await createMember(prisma, "mto-restock-buy");
    const order = await prisma.storeOrder.create({
      data: { buyerId: buyer.id, sellerId: member.id, totalCents: 1000, subtotalCents: 1000 },
    });
    const line = await prisma.orderItem.create({
      data: {
        orderId: order.id,
        storeItemId: item.id,
        quantity: 1,
        priceCentsAtPurchase: 1000,
        variantId,
      },
    });
    const before = await prisma.inventoryState.findUnique({ where: { variantId } });
    await prisma.$transaction((tx) =>
      restockFoundationOrderLine(
        tx,
        { id: line.id, storeItemId: item.id, quantity: 1, variantId },
        "PHYSICAL_RECEIPT",
        `return:${order.id}`
      )
    );
    await prisma.$transaction((tx) =>
      restockFoundationOrderLine(
        tx,
        { id: line.id, storeItemId: item.id, quantity: 1, variantId },
        "PHYSICAL_RECEIPT",
        `return:${order.id}`
      )
    );
    const after = await prisma.inventoryState.findUnique({ where: { variantId } });
    expect(after?.mode).toBe("MADE_TO_ORDER");
    expect(after?.onHand).toBeNull();
    expect(after?.reserved).toBeNull();
    expect(after?.availabilityVersion).toBe(before?.availabilityVersion);
    expect(
      await prisma.inventoryEvent.count({ where: { variantId, eventType: { in: ["PHYSICAL_RECEIPT", "UNDO_CONSUMPTION"] } } })
    ).toBe(0);
  });

  it("direct Foundation checkout above the existing MTO cap leaves no attempt", async () => {
    await enterFoundation();
    const member = await createMember(prisma, "mto-cap");
    const item = await createStoreItem(prisma, member.id, "MTO cap", {
      quantity: 0,
      inventoryTracking: "made_to_order",
    });
    const provisioned = await prisma.$transaction((tx) => provisionNativeFoundationListing(tx, item.id));
    const buyer = await createMember(prisma, "mto-cap-buy");
    await expect(
      prepareFoundationCheckout(prisma, {
        buyerMemberId: buyer.id,
        amountCents: 1000 * (FOUNDATION_MTO_PURCHASE_CAP + 1),
        orders: [checkoutLines(member.id, item.id, provisioned.variantIds[0], FOUNDATION_MTO_PURCHASE_CAP + 1)],
      })
    ).rejects.toMatchObject({ code: "mto_purchase_cap" });
    expect(await prisma.checkoutAttempt.count({ where: { buyerMemberId: buyer.id } })).toBe(0);
    expect(await prisma.storeOrder.count({ where: { buyerId: buyer.id } })).toBe(0);
  });

  it("missing Variants cannot be bypassed with a direct StoreItem quantity write on SET", async () => {
    await enterFoundation();
    const member = await createMember(prisma, "missing");
    const item = await createStoreItem(prisma, member.id, "No variants", { quantity: 4 });
    await expect(
      prisma.$transaction((tx) =>
        applyFoundationSellerQuantitySets(tx, {
          storeItemId: item.id,
          memberId: member.id,
          commandId: "missing",
          simpleTarget: 9,
        })
      )
    ).rejects.toBeInstanceOf(FoundationMissingStateError);
    const unchanged = await prisma.storeItem.findUnique({ where: { id: item.id } });
    expect(unchanged?.quantity).toBe(4);
    expect(await prisma.inventoryState.count({ where: { storeItemId: item.id } })).toBe(0);
  });
});

describe("prompt-67 checkout hash / advisory lock / payment truth", () => {
  function hashOrder(
    sellerId: string,
    storeItemId: string,
    line: {
      quantity?: number;
      variantId?: string | null;
      variantJson?: unknown;
      fulfillmentType?: string | null;
      priceCentsAtPurchase?: number;
    },
    orderExtras?: { shippingCostCents?: number; totalCents?: number; shippingAddress?: object }
  ) {
    const quantity = line.quantity ?? 1;
    return {
      sellerId,
      subtotalCents: 1000 * quantity,
      shippingCostCents: orderExtras?.shippingCostCents ?? 0,
      totalCents: orderExtras?.totalCents ?? 1000 * quantity,
      shippingAddress: orderExtras?.shippingAddress,
      lines: [
        {
          storeItemId,
          quantity,
          priceCentsAtPurchase: line.priceCentsAtPurchase ?? 1000,
          variantId: line.variantId,
          variantJson: line.variantJson,
          fulfillmentType: line.fulfillmentType,
        },
      ],
    };
  }

  it("concurrent identical prepare reuses one attempt, HOLD, and stripeIdempotencyKey", async () => {
    const ctx = await trackedSimple(2);
    const buyer = await createMember(prisma, "conc");
    const input = {
      buyerMemberId: buyer.id,
      amountCents: 1000,
      orders: [checkoutLines(ctx.member.id, ctx.item.id, ctx.variantId)],
    };
    const [a, b] = await Promise.all([
      prepareFoundationCheckout(prisma, input),
      prepareFoundationCheckout(prisma, input),
    ]);
    expect(new Set([a.attemptId, b.attemptId]).size).toBe(1);
    expect(a.stripeIdempotencyKey).toBe(b.stripeIdempotencyKey);
    expect(a.stripeIdempotencyKey.includes("_g")).toBe(false);
    expect(await prisma.checkoutAttempt.count({ where: { buyerMemberId: buyer.id } })).toBe(1);
    expect(await prisma.inventoryReservation.count({ where: { checkoutAttemptId: a.attemptId } })).toBe(1);
    const keys = checkoutPrepareAdvisoryLockKeys(buyer.id, hashFoundationCart(input.orders, { amountCents: 1000 }));
    expect(checkoutPrepareAdvisoryLockKeys(buyer.id, hashFoundationCart(input.orders, { amountCents: 1000 }))).toEqual(
      keys
    );
  });

  it("same listing different MATRIX variants get different hashes, locks, and reservations", async () => {
    await enterFoundation();
    const member = await createMember(prisma, "mx-var");
    const item = await createStoreItem(prisma, member.id, "Colors", {
      quantity: 4,
      variants: {
        axes: [{ name: "Color", values: ["Red", "Blue"] }],
        skus: [
          { options: { Color: "Red" }, quantity: 2 },
          { options: { Color: "Blue" }, quantity: 2 },
        ],
      },
    });
    const provisioned = await prisma.$transaction((tx) => provisionNativeFoundationListing(tx, item.id));
    const [redId, blueId] = provisioned.variantIds;
    const buyer = await createMember(prisma, "mx-buy");
    const redInput = {
      buyerMemberId: buyer.id,
      amountCents: 1000,
      orders: [
        hashOrder(member.id, item.id, { variantJson: { Color: "Red" }, quantity: 1 }),
      ],
    };
    const blueInput = {
      buyerMemberId: buyer.id,
      amountCents: 1000,
      orders: [
        hashOrder(member.id, item.id, { variantJson: { Color: "Blue" }, quantity: 1 }),
      ],
    };
    expect(hashFoundationCart(redInput.orders, { amountCents: 1000 })).not.toBe(
      hashFoundationCart(blueInput.orders, { amountCents: 1000 })
    );
    const [red, blue] = await Promise.all([
      prepareFoundationCheckout(prisma, redInput),
      prepareFoundationCheckout(prisma, blueInput),
    ]);
    expect(red.attemptId).not.toBe(blue.attemptId);
    expect(red.stripeIdempotencyKey).not.toBe(blue.stripeIdempotencyKey);
    const holds = await prisma.inventoryReservation.findMany({
      where: { checkoutAttemptId: { in: [red.attemptId, blue.attemptId] } },
    });
    expect(holds).toHaveLength(2);
    expect(new Set(holds.map((h) => h.variantId))).toEqual(new Set([redId, blueId]));
  });

  it("equivalent option JSON key order hashes identically", () => {
    const a = hashFoundationCart([
      hashOrder("seller", "item", { variantJson: { Color: "Red", Size: "M" } }),
    ]);
    const b = hashFoundationCart([
      hashOrder("seller", "item", { variantJson: { Size: "M", Color: "Red" } }),
    ]);
    expect(a).toBe(b);
    expect(canonicalCheckoutVariantIdentity({ variantJson: { Color: "Red", Size: "M" } })).toBe(
      canonicalCheckoutVariantIdentity({ variantJson: { Size: "M", Color: "Red" } })
    );
  });

  it("quantity 1 vs 2 hashes differently", () => {
    const one = hashFoundationCart([hashOrder("seller", "item", { variantId: "v1", quantity: 1 })]);
    const two = hashFoundationCart([hashOrder("seller", "item", { variantId: "v1", quantity: 2 })]);
    expect(one).not.toBe(two);
  });

  it("ship vs pickup fulfillment hashes differently", () => {
    const ship = hashFoundationCart([
      hashOrder("seller", "item", { variantId: "v1", fulfillmentType: "ship" }),
    ]);
    const pickup = hashFoundationCart([
      hashOrder("seller", "item", { variantId: "v1", fulfillmentType: "pickup" }),
    ]);
    expect(ship).not.toBe(pickup);
  });

  it("sequential retry still reuses attempt and HOLD after advisory locking", async () => {
    const ctx = await trackedSimple(1);
    const buyer = await createMember(prisma, "seq");
    const input = {
      buyerMemberId: buyer.id,
      amountCents: 1000,
      orders: [checkoutLines(ctx.member.id, ctx.item.id, ctx.variantId)],
    };
    const first = await prepareFoundationCheckout(prisma, input);
    const second = await prepareFoundationCheckout(prisma, input);
    expect(second.reused).toBe(true);
    expect(second.attemptId).toBe(first.attemptId);
    expect(second.stripeIdempotencyKey).toBe(first.stripeIdempotencyKey);
    expect(await prisma.inventoryReservation.count({ where: { checkoutAttemptId: first.attemptId } })).toBe(1);
  });

  it("released-then-paid records payment PAID without CONVERT or FINALIZED", async () => {
    const ctx = await trackedSimple(1);
    const buyer = await createMember(prisma, "rel-p67");
    const prepared = await prepareFoundationCheckout(prisma, {
      buyerMemberId: buyer.id,
      amountCents: 1000,
      orders: [checkoutLines(ctx.member.id, ctx.item.id, ctx.variantId)],
    });
    await expireFoundationCheckoutAttempt(prisma, prepared.attemptId);
    await expect(
      finalizeFoundationCheckoutPayment(prisma, {
        attemptId: prepared.attemptId,
        stripeEventId: `evt_rel_${prepared.attemptId}`,
        eventType: "payment_intent.succeeded",
      })
    ).rejects.toBeInstanceOf(FoundationCheckoutNotConvertibleError);
    const attempt = await prisma.checkoutAttempt.findUnique({ where: { id: prepared.attemptId } });
    expect(attempt?.paymentStatus).toBe("PAID");
    expect(attempt?.state).toBe("CLOSED");
    const order = await prisma.storeOrder.findFirst({ where: { checkoutAttemptId: prepared.attemptId } });
    expect(order?.commerceStatus).toBe("PENDING");
    expect(order?.status).toBe("canceled");
    const reservation = await prisma.inventoryReservation.findFirst({
      where: { checkoutAttemptId: prepared.attemptId },
    });
    expect(reservation?.releasedQty).toBe(1);
    expect(reservation?.convertedQty).toBe(0);
    expect(
      await prisma.inventoryEvent.count({
        where: { variantId: ctx.variantId, eventType: "RESERVATION_CONVERT" },
      })
    ).toBe(0);
  });

  it("payment truth survives convert failure and is not rolled back", async () => {
    const ctx = await trackedSimple(1);
    const buyer = await createMember(prisma, "surv");
    const prepared = await prepareFoundationCheckout(prisma, {
      buyerMemberId: buyer.id,
      amountCents: 1000,
      orders: [checkoutLines(ctx.member.id, ctx.item.id, ctx.variantId)],
    });
    await expireFoundationCheckoutAttempt(prisma, prepared.attemptId);
    await expect(finalizeFoundationCheckoutPayment(prisma, { attemptId: prepared.attemptId })).rejects.toBeInstanceOf(
      FoundationCheckoutNotConvertibleError
    );
    const attempt = await prisma.checkoutAttempt.findUnique({ where: { id: prepared.attemptId } });
    expect(attempt?.paymentStatus).toBe("PAID");
  });

  it("expiry after paid-but-unfinalized does not RELEASE or drop payment truth", async () => {
    const ctx = await trackedSimple(1);
    const buyer = await createMember(prisma, "exp-paid");
    const prepared = await prepareFoundationCheckout(prisma, {
      buyerMemberId: buyer.id,
      amountCents: 1000,
      orders: [checkoutLines(ctx.member.id, ctx.item.id, ctx.variantId)],
    });
    await expireFoundationCheckoutAttempt(prisma, prepared.attemptId);
    await expect(finalizeFoundationCheckoutPayment(prisma, { attemptId: prepared.attemptId })).rejects.toBeInstanceOf(
      FoundationCheckoutNotConvertibleError
    );
    const decision = await expireFoundationCheckoutAttempt(prisma, prepared.attemptId);
    expect(decision).toBe("finalize");
    const attempt = await prisma.checkoutAttempt.findUnique({ where: { id: prepared.attemptId } });
    expect(attempt?.paymentStatus).toBe("PAID");
    const reservation = await prisma.inventoryReservation.findFirst({
      where: { checkoutAttemptId: prepared.attemptId },
    });
    expect(reservation?.releasedQty).toBe(1);
    expect(reservation?.convertedQty).toBe(0);
    expect(reservation?.activeQty).toBe(0);
    const order = await prisma.storeOrder.findFirst({ where: { checkoutAttemptId: prepared.attemptId } });
    expect(order?.commerceStatus).not.toBe("FINALIZED");
  });

  it("duplicate paid event after failed CONVERT does not mutate inventory or downgrade payment", async () => {
    const ctx = await trackedSimple(1);
    const buyer = await createMember(prisma, "dup-paid");
    const prepared = await prepareFoundationCheckout(prisma, {
      buyerMemberId: buyer.id,
      amountCents: 1000,
      orders: [checkoutLines(ctx.member.id, ctx.item.id, ctx.variantId)],
    });
    await expireFoundationCheckoutAttempt(prisma, prepared.attemptId);
    await expect(
      finalizeFoundationCheckoutPayment(prisma, {
        attemptId: prepared.attemptId,
        stripeEventId: `evt_dup_a_${prepared.attemptId}`,
        eventType: "payment_intent.succeeded",
      })
    ).rejects.toBeInstanceOf(FoundationCheckoutNotConvertibleError);
    await expect(
      finalizeFoundationCheckoutPayment(prisma, {
        attemptId: prepared.attemptId,
        stripeEventId: `evt_dup_b_${prepared.attemptId}`,
        eventType: "checkout.session.completed",
      })
    ).rejects.toBeInstanceOf(FoundationCheckoutNotConvertibleError);
    const attempt = await prisma.checkoutAttempt.findUnique({ where: { id: prepared.attemptId } });
    expect(attempt?.paymentStatus).toBe("PAID");
    expect(
      await prisma.inventoryEvent.count({
        where: { variantId: ctx.variantId, eventType: "RESERVATION_CONVERT" },
      })
    ).toBe(0);
    expect(
      await prisma.stripeEventEvidence.count({
        where: { checkoutAttemptId: prepared.attemptId },
      })
    ).toBe(2);
  });

  it("PI then session paid events convert inventory once", async () => {
    const ctx = await trackedSimple(1);
    const buyer = await createMember(prisma, "evt-ord");
    const prepared = await prepareFoundationCheckout(prisma, {
      buyerMemberId: buyer.id,
      amountCents: 1000,
      orders: [checkoutLines(ctx.member.id, ctx.item.id, ctx.variantId)],
    });
    const first = await finalizeFoundationCheckoutPayment(prisma, {
      attemptId: prepared.attemptId,
      stripePaymentIntentId: `pi_${prepared.attemptId}`,
      stripeEventId: `evt_pi_${prepared.attemptId}`,
      eventType: "payment_intent.succeeded",
    });
    expect(first.converted).toBe(1);
    const second = await finalizeFoundationCheckoutPayment(prisma, {
      attemptId: prepared.attemptId,
      stripeCheckoutSessionId: `cs_${prepared.attemptId}`,
      stripePaymentIntentId: `pi_${prepared.attemptId}`,
      stripeEventId: `evt_cs_${prepared.attemptId}`,
      eventType: "checkout.session.completed",
    });
    expect(second.alreadyFinalized).toBe(true);
    expect(second.converted).toBe(0);
    const reservation = await prisma.inventoryReservation.findFirst({
      where: { checkoutAttemptId: prepared.attemptId },
    });
    expect(reservation?.convertedQty).toBe(1);
    expect(
      await prisma.inventoryEvent.count({
        where: { variantId: ctx.variantId, eventType: "RESERVATION_CONVERT" },
      })
    ).toBe(1);
  });

  it("session then PI paid events convert inventory once", async () => {
    const ctx = await trackedSimple(1);
    const buyer = await createMember(prisma, "evt-ses");
    const prepared = await prepareFoundationCheckout(prisma, {
      buyerMemberId: buyer.id,
      amountCents: 1000,
      orders: [checkoutLines(ctx.member.id, ctx.item.id, ctx.variantId)],
    });
    const first = await finalizeFoundationCheckoutPayment(prisma, {
      attemptId: prepared.attemptId,
      stripeCheckoutSessionId: `cs_first_${prepared.attemptId}`,
      stripeEventId: `evt_cs_first_${prepared.attemptId}`,
      eventType: "checkout.session.completed",
    });
    expect(first.converted).toBe(1);
    const second = await finalizeFoundationCheckoutPayment(prisma, {
      attemptId: prepared.attemptId,
      stripeCheckoutSessionId: `cs_first_${prepared.attemptId}`,
      stripePaymentIntentId: `pi_later_${prepared.attemptId}`,
      stripeEventId: `evt_pi_later_${prepared.attemptId}`,
      eventType: "payment_intent.succeeded",
    });
    expect(second.alreadyFinalized).toBe(true);
    expect(
      await prisma.inventoryEvent.count({
        where: { variantId: ctx.variantId, eventType: "RESERVATION_CONVERT" },
      })
    ).toBe(1);
  });
});

