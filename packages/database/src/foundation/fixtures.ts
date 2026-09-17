import type { PrismaClient } from "@prisma/client";

export type ListingFixture = {
  memberId: string;
  itemId: string;
  variantId: string;
};

let seq = 0;

function nonce(): string {
  seq += 1;
  return `${Date.now().toString(36)}${seq}${Math.random().toString(36).slice(2, 8)}`;
}

export async function createMember(prisma: PrismaClient, label = "m") {
  return prisma.member.create({
    data: {
      email: `${label}-${nonce()}@foundation.test`,
      passwordHash: "test-hash",
      firstName: "Foundation",
      lastName: label,
    },
  });
}

export async function createStoreItem(
  prisma: PrismaClient,
  memberId: string,
  title = "Foundation item"
) {
  return prisma.storeItem.create({
    data: {
      memberId,
      title,
      slug: `foundation-${nonce()}`,
      priceCents: 1000,
      photos: [],
      quantity: 0,
    },
  });
}

export async function createVariant(
  prisma: PrismaClient,
  args: {
    memberId: string;
    storeItemId: string;
    isDefault?: boolean;
    sku?: string | null;
    priceCents?: number;
  }
) {
  return prisma.storeVariant.create({
    data: {
      memberId: args.memberId,
      storeItemId: args.storeItemId,
      isDefault: args.isDefault ?? false,
      sku: args.sku ?? null,
      priceCents: args.priceCents ?? 1000,
      options: {},
    },
  });
}

export async function createListing(
  prisma: PrismaClient,
  opts?: { isDefault?: boolean; title?: string }
): Promise<ListingFixture> {
  const member = await createMember(prisma);
  const item = await createStoreItem(prisma, member.id, opts?.title);
  const variant = await createVariant(prisma, {
    memberId: member.id,
    storeItemId: item.id,
    isDefault: opts?.isDefault ?? true,
  });
  return { memberId: member.id, itemId: item.id, variantId: variant.id };
}

export async function createOrder(
  prisma: PrismaClient,
  args: { buyerId: string; sellerId: string; checkoutAttemptId?: string | null }
) {
  return prisma.storeOrder.create({
    data: {
      buyerId: args.buyerId,
      sellerId: args.sellerId,
      totalCents: 1000,
      subtotalCents: 1000,
      ...(args.checkoutAttemptId ? { checkoutAttemptId: args.checkoutAttemptId } : {}),
    },
  });
}

export async function createCheckoutAttempt(
  prisma: PrismaClient,
  args: {
    buyerMemberId: string;
    stripeIdempotencyKey?: string;
    stripeCheckoutSessionId?: string | null;
    stripePaymentIntentId?: string | null;
    amountCents?: number;
  }
) {
  return prisma.checkoutAttempt.create({
    data: {
      buyerMemberId: args.buyerMemberId,
      cartHash: `cart-${nonce()}`,
      amountCents: args.amountCents ?? 1000,
      stripeIdempotencyKey: args.stripeIdempotencyKey ?? `idem-${nonce()}`,
      stripeCheckoutSessionId: args.stripeCheckoutSessionId ?? undefined,
      stripePaymentIntentId: args.stripePaymentIntentId ?? undefined,
    },
  });
}

export async function createOrderLine(
  prisma: PrismaClient,
  args: {
    orderId: string;
    storeItemId: string;
    variantId?: string | null;
    quantity?: number;
  }
) {
  return prisma.orderItem.create({
    data: {
      orderId: args.orderId,
      storeItemId: args.storeItemId,
      quantity: args.quantity ?? 1,
      priceCentsAtPurchase: 1000,
      variantId: args.variantId ?? null,
    },
  });
}

export async function createReservation(
  prisma: PrismaClient,
  args: {
    memberId: string;
    checkoutAttemptId: string;
    storeOrderId: string;
    orderItemId: string;
    variantId: string;
    storeItemId: string;
    originalQty?: number;
    activeQty?: number;
    convertedQty?: number;
    releasedQty?: number;
    invalidatedQty?: number;
    expiresAt?: Date;
  }
) {
  const originalQty = args.originalQty ?? 5;
  const convertedQty = args.convertedQty ?? 0;
  const releasedQty = args.releasedQty ?? 0;
  const invalidatedQty = args.invalidatedQty ?? 0;
  const activeQty = args.activeQty ?? originalQty - convertedQty - releasedQty - invalidatedQty;
  return prisma.inventoryReservation.create({
    data: {
      memberId: args.memberId,
      checkoutAttemptId: args.checkoutAttemptId,
      storeOrderId: args.storeOrderId,
      orderItemId: args.orderItemId,
      variantId: args.variantId,
      storeItemId: args.storeItemId,
      originalQty,
      activeQty,
      convertedQty,
      releasedQty,
      invalidatedQty,
      expiresAt: args.expiresAt ?? new Date(Date.now() + 15 * 60 * 1000),
    },
  });
}

export async function createStripeEvidence(
  prisma: PrismaClient,
  args?: {
    stripeEventId?: string;
    checkoutAttemptId?: string | null;
    eventType?: string;
  }
) {
  return prisma.stripeEventEvidence.create({
    data: {
      stripeEventId: args?.stripeEventId ?? `evt_${nonce()}`,
      eventType: args?.eventType ?? "checkout.session.completed",
      stripeCreatedAt: new Date(),
      payload: { id: args?.stripeEventId ?? "evt", type: args?.eventType ?? "checkout.session.completed" },
      checkoutAttemptId: args?.checkoutAttemptId ?? undefined,
    },
  });
}

export async function createRefundOperation(
  prisma: PrismaClient,
  args: {
    memberId: string;
    storeOrderId: string;
    orderItemId?: string | null;
    checkoutAttemptId?: string | null;
    kind?: "FULL" | "PARTIAL" | "COURTESY" | "RETURN";
    amountCents?: number;
    restockRequested?: boolean;
    providerIdempotencyKey?: string;
    stripeRefundId?: string | null;
    status?: "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "UNCERTAIN";
  }
) {
  return prisma.refundOperation.create({
    data: {
      memberId: args.memberId,
      storeOrderId: args.storeOrderId,
      orderItemId: args.orderItemId ?? undefined,
      checkoutAttemptId: args.checkoutAttemptId ?? undefined,
      kind: args.kind ?? "PARTIAL",
      amountCents: args.amountCents ?? 100,
      restockRequested: args.restockRequested ?? false,
      providerIdempotencyKey: args.providerIdempotencyKey ?? `re_${nonce()}`,
      stripeRefundId: args.stripeRefundId ?? undefined,
      status: args.status ?? "PENDING",
    },
  });
}

export async function createTransferOperation(
  prisma: PrismaClient,
  args: {
    memberId: string;
    storeOrderId: string;
    amountCents?: number;
    providerIdempotencyKey?: string;
    stripeTransferId?: string | null;
    status?: "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "UNCERTAIN";
  }
) {
  return prisma.transferOperation.create({
    data: {
      memberId: args.memberId,
      storeOrderId: args.storeOrderId,
      amountCents: args.amountCents ?? 900,
      providerIdempotencyKey: args.providerIdempotencyKey ?? `tr_${nonce()}`,
      stripeTransferId: args.stripeTransferId ?? undefined,
      status: args.status ?? "PENDING",
    },
  });
}

export function dbCode(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    return String((err as { code: unknown }).code);
  }
  return "";
}

export function dbMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function isUniqueViolation(err: unknown): boolean {
  const msg = dbMessage(err);
  return dbCode(err) === "P2002" || msg.includes("23505") || /unique/i.test(msg);
}

export function isFkViolation(err: unknown): boolean {
  const msg = dbMessage(err);
  return dbCode(err) === "P2003" || msg.includes("23503") || /foreign key/i.test(msg);
}

export function isCheckViolation(err: unknown): boolean {
  const msg = dbMessage(err);
  return (
    dbCode(err) === "P2004" ||
    msg.includes("23514") ||
    /check constraint/i.test(msg) ||
    /violates check/i.test(msg)
  );
}

export async function expectRejects(
  action: () => Promise<unknown>,
  kind: "unique" | "fk" | "check" | "restrict"
): Promise<unknown> {
  try {
    await action();
  } catch (err) {
    if (kind === "unique" && isUniqueViolation(err)) return err;
    if (kind === "fk" && isFkViolation(err)) return err;
    if (kind === "check" && isCheckViolation(err)) return err;
    if (kind === "restrict") {
      const msg = dbMessage(err);
      if (isFkViolation(err) || msg.includes("23503") || /restrict|referenced/i.test(msg)) {
        return err;
      }
    }
    throw err;
  }
  throw new Error(`Expected ${kind} rejection, but the write succeeded`);
}
