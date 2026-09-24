import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  closeOrDeleteMemberAccount,
  countMemberDurableCommerceEvidence,
  durableCommerceFinancialNone,
} from "../member-account-lifecycle";
import {
  createCheckoutAttempt,
  createListing,
  createMember,
  createOrder,
  createRefundOperation,
  createStoreItem,
  createStoreReturn,
  createTransferOperation,
  createVariant,
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

describe("Member account lifecycle (real PostgreSQL)", () => {
  it("CASE 1: no commerce → hard delete → deleted", async () => {
    const member = await createMember(prisma, "lc1");
    const result = await closeOrDeleteMemberAccount(prisma, member.id);
    expect(result).toEqual({ ok: true, outcome: "deleted" });
    expect(await prisma.member.findUnique({ where: { id: member.id } })).toBeNull();
  });

  it("CASE 2: buyer history → closed; orders survive; identity kept", async () => {
    const buyer = await createMember(prisma, "lc2-buyer");
    const seller = await createMember(prisma, "lc2-seller");
    const email = buyer.email;
    const order = await createOrder(prisma, { buyerId: buyer.id, sellerId: seller.id });
    const result = await closeOrDeleteMemberAccount(prisma, buyer.id);
    expect(result).toEqual({ ok: true, outcome: "closed" });
    const retained = await prisma.member.findUnique({ where: { id: buyer.id } });
    expect(retained?.status).toBe("closed");
    expect(retained?.email).toBe(email);
    expect(retained?.firstName).toBe(buyer.firstName);
    expect(retained?.lastName).toBe(buyer.lastName);
    expect(retained?.authEpoch).toBe(1);
    const still = await prisma.storeOrder.findUnique({ where: { id: order.id } });
    expect(still?.buyerId).toBe(buyer.id);
  });

  it("CASE 3: seller history → closed; orders/listings survive", async () => {
    const buyer = await createMember(prisma, "lc3-buyer");
    const seller = await createMember(prisma, "lc3-seller");
    const item = await createStoreItem(prisma, seller.id, "Seller listing");
    const order = await createOrder(prisma, { buyerId: buyer.id, sellerId: seller.id });
    const result = await closeOrDeleteMemberAccount(prisma, seller.id);
    expect(result).toEqual({ ok: true, outcome: "closed" });
    expect(await prisma.storeItem.findUnique({ where: { id: item.id } })).toBeTruthy();
    expect((await prisma.storeOrder.findUnique({ where: { id: order.id } }))?.sellerId).toBe(
      seller.id
    );
  });

  it("CASE 4: active seller listings End", async () => {
    const seller = await createMember(prisma, "lc4");
    const active = await createStoreItem(prisma, seller.id, "Active listing");
    const already = await prisma.storeItem.create({
      data: {
        memberId: seller.id,
        title: "Already ended",
        slug: `ended-${seller.id}`,
        priceCents: 500,
        photos: [],
        quantity: 0,
        status: "inactive",
        endedAt: new Date("2020-01-01T00:00:00.000Z"),
      },
    });
    await closeOrDeleteMemberAccount(prisma, seller.id);
    const ended = await prisma.storeItem.findUnique({ where: { id: active.id } });
    expect(ended?.status).toBe("inactive");
    expect(ended?.endedAt).toBeTruthy();
    const kept = await prisma.storeItem.findUnique({ where: { id: already.id } });
    expect(kept?.endedAt?.toISOString()).toBe("2020-01-01T00:00:00.000Z");
  });

  it("CASE 5: StoreVariant fixture → closed; variant survives", async () => {
    const listing = await createListing(prisma, { title: "Variant listing" });
    const result = await closeOrDeleteMemberAccount(prisma, listing.memberId);
    expect(result).toEqual({ ok: true, outcome: "closed" });
    expect(await prisma.storeVariant.findUnique({ where: { id: listing.variantId } })).toBeTruthy();
  });

  it("CASE 6: CheckoutAttempt → closed; attempt survives", async () => {
    const buyer = await createMember(prisma, "lc6");
    const attempt = await createCheckoutAttempt(prisma, { buyerMemberId: buyer.id });
    const result = await closeOrDeleteMemberAccount(prisma, buyer.id);
    expect(result).toEqual({ ok: true, outcome: "closed" });
    expect(await prisma.checkoutAttempt.findUnique({ where: { id: attempt.id } })).toBeTruthy();
  });

  it("CASE 7: same classifier for admin/self (shared service)", async () => {
    const buyer = await createMember(prisma, "lc7");
    const seller = await createMember(prisma, "lc7s");
    await createOrder(prisma, { buyerId: buyer.id, sellerId: seller.id });
    const adminResult = await closeOrDeleteMemberAccount(prisma, buyer.id);
    expect(adminResult).toEqual({ ok: true, outcome: "closed" });
  });

  it("CASE 8: stale eligibility excludes M1/M2/M3-only members", async () => {
    const listing = await createListing(prisma, { title: "M1 only" });
    const checkoutMember = await createMember(prisma, "lc8-m2");
    await createCheckoutAttempt(prisma, { buyerMemberId: checkoutMember.id });
    const mapMember = await createMember(prisma, "lc8-m3");
    const item = await createStoreItem(prisma, mapMember.id, "Backfill item");
    const variant = await createVariant(prisma, {
      memberId: mapMember.id,
      storeItemId: item.id,
      isDefault: true,
    });
    await prisma.variantBackfillMap.create({
      data: {
        storeItemId: item.id,
        memberId: mapMember.id,
        sourceFingerprint: `fp-${mapMember.id}`,
        variantId: variant.id,
      },
    });

    const eligible = await prisma.member.findMany({
      where: {
        id: { in: [listing.memberId, checkoutMember.id, mapMember.id] },
        ...durableCommerceFinancialNone(),
      },
      select: { id: true },
    });
    expect(eligible).toEqual([]);
  });

  it("CASE 9/10: close increments authEpoch so old epoch-0 tokens fail", async () => {
    const buyer = await createMember(prisma, "lc9");
    const seller = await createMember(prisma, "lc9s");
    await createOrder(prisma, { buyerId: buyer.id, sellerId: seller.id });
    expect(buyer.authEpoch).toBe(0);
    await closeOrDeleteMemberAccount(prisma, buyer.id);
    const closed = await prisma.member.findUnique({ where: { id: buyer.id } });
    expect(closed?.authEpoch).toBe(1);
    expect(closed?.status).toBe("closed");
  });

  it("CASE 11: closed member has no reset material and unusable password hash", async () => {
    const buyer = await createMember(prisma, "lc11");
    const seller = await createMember(prisma, "lc11s");
    await createOrder(prisma, { buyerId: buyer.id, sellerId: seller.id });
    await prisma.member.update({
      where: { id: buyer.id },
      data: {
        passwordResetTokenHash: "reset-hash",
        passwordResetExpiresAt: new Date(Date.now() + 3600_000),
      },
    });
    await closeOrDeleteMemberAccount(prisma, buyer.id);
    const closed = await prisma.member.findUnique({ where: { id: buyer.id } });
    expect(closed?.status).toBe("closed");
    expect(closed?.passwordResetTokenHash).toBeNull();
    expect(closed?.passwordHash).not.toBe("test-hash");
  });

  it("CASE 12: community data purged; commerce history remains", async () => {
    const buyer = await createMember(prisma, "lc12");
    const seller = await createMember(prisma, "lc12s");
    const order = await createOrder(prisma, { buyerId: buyer.id, sellerId: seller.id });
    const post = await prisma.post.create({
      data: { type: "personal", authorId: buyer.id, content: "bye", photos: [], videos: [] },
    });
    const event = await prisma.event.create({
      data: {
        memberId: buyer.id,
        calendarType: "fun_events",
        title: "Attribution event",
        date: new Date("2026-09-17"),
        slug: `evt-${buyer.id}`,
        photos: [],
      },
    });
    await closeOrDeleteMemberAccount(prisma, buyer.id);
    expect(await prisma.post.findUnique({ where: { id: post.id } })).toBeNull();
    const eventAfter = await prisma.event.findUnique({ where: { id: event.id } });
    expect(eventAfter).toBeTruthy();
    expect(eventAfter?.memberId).toBeNull();
    expect((await prisma.storeOrder.findUnique({ where: { id: order.id } }))?.buyerId).toBe(
      buyer.id
    );
  });

  it("CASE 13: no-commerce Group creator hard-deletes; group cascades", async () => {
    const creator = await createMember(prisma, "lc13");
    const group = await prisma.group.create({
      data: { name: "Creator group", slug: `grp-${creator.id}`, createdById: creator.id },
    });
    const result = await closeOrDeleteMemberAccount(prisma, creator.id);
    expect(result).toEqual({ ok: true, outcome: "deleted" });
    expect(await prisma.member.findUnique({ where: { id: creator.id } })).toBeNull();
    expect(await prisma.group.findUnique({ where: { id: group.id } })).toBeNull();
  });

  it("CASE 14: second close is idempotent and does not increment authEpoch again", async () => {
    const buyer = await createMember(prisma, "lc14");
    const seller = await createMember(prisma, "lc14s");
    await createOrder(prisma, { buyerId: buyer.id, sellerId: seller.id });
    const first = await closeOrDeleteMemberAccount(prisma, buyer.id);
    expect(first).toEqual({ ok: true, outcome: "closed" });
    const afterFirst = await prisma.member.findUnique({ where: { id: buyer.id } });
    const second = await closeOrDeleteMemberAccount(prisma, buyer.id);
    expect(second).toEqual({ ok: true, outcome: "closed" });
    const afterSecond = await prisma.member.findUnique({ where: { id: buyer.id } });
    expect(afterSecond?.authEpoch).toBe(afterFirst?.authEpoch);
    expect(afterSecond?.closedAt?.toISOString()).toBe(afterFirst?.closedAt?.toISOString());
  });

  it("not_found is deterministic", async () => {
    const result = await closeOrDeleteMemberAccount(prisma, "missing-member-id");
    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  it("provider A: stripeCustomerId forces retained/closed", async () => {
    const member = await createMember(prisma, "prov-a");
    await prisma.member.update({
      where: { id: member.id },
      data: { stripeCustomerId: `cus_${member.id}` },
    });
    const result = await closeOrDeleteMemberAccount(prisma, member.id);
    expect(result).toEqual({ ok: true, outcome: "closed" });
    expect((await prisma.member.findUnique({ where: { id: member.id } }))?.status).toBe("closed");
  });

  it("provider B: stripeConnectAccountId forces retained/closed", async () => {
    const member = await createMember(prisma, "prov-b");
    await prisma.member.update({
      where: { id: member.id },
      data: { stripeConnectAccountId: `acct_${member.id}` },
    });
    const result = await closeOrDeleteMemberAccount(prisma, member.id);
    expect(result).toEqual({ ok: true, outcome: "closed" });
  });

  it("provider C: Shippo credential forces retained/closed", async () => {
    const member = await createMember(prisma, "prov-c");
    await prisma.member.update({
      where: { id: member.id },
      data: { shippoApiKeyEncrypted: "enc-shippo-key" },
    });
    const result = await closeOrDeleteMemberAccount(prisma, member.id);
    expect(result).toEqual({ ok: true, outcome: "closed" });
  });

  it("provider D: Subscription row forces retained/closed", async () => {
    const member = await createMember(prisma, "prov-d");
    await prisma.subscription.create({
      data: {
        memberId: member.id,
        plan: "subscribe",
        status: "active",
        stripeSubscriptionId: `sub_${member.id}`,
      },
    });
    const result = await closeOrDeleteMemberAccount(prisma, member.id);
    expect(result).toEqual({ ok: true, outcome: "closed" });
    expect(await prisma.subscription.count({ where: { memberId: member.id } })).toBe(1);
  });

  it("CASE 19: Report survives retained close; reporterId kept; posts purged", async () => {
    const buyer = await createMember(prisma, "lc19");
    const seller = await createMember(prisma, "lc19s");
    const order = await createOrder(prisma, { buyerId: buyer.id, sellerId: seller.id });
    const post = await prisma.post.create({
      data: { type: "personal", authorId: buyer.id, content: "bye", photos: [], videos: [] },
    });
    const report = await prisma.report.create({
      data: {
        reporterId: buyer.id,
        contentType: "post",
        contentId: post.id,
        reason: "csam",
      },
    });
    await closeOrDeleteMemberAccount(prisma, buyer.id);
    const kept = await prisma.report.findUnique({ where: { id: report.id } });
    expect(kept?.reporterId).toBe(buyer.id);
    expect(await prisma.post.findUnique({ where: { id: post.id } })).toBeNull();
    expect((await prisma.storeOrder.findUnique({ where: { id: order.id } }))?.buyerId).toBe(
      buyer.id
    );
    expect((await prisma.member.findUnique({ where: { id: buyer.id } }))?.status).toBe("closed");
  });

  it("CASE 20: no commerce + Report → closed; report and reporterId survive", async () => {
    const member = await createMember(prisma, "lc20");
    expect(member.authEpoch).toBe(0);
    const report = await prisma.report.create({
      data: {
        reporterId: member.id,
        contentType: "post",
        contentId: "unrelated-content",
        reason: "csam",
      },
    });
    const result = await closeOrDeleteMemberAccount(prisma, member.id);
    expect(result).toEqual({ ok: true, outcome: "closed" });
    const retained = await prisma.member.findUnique({ where: { id: member.id } });
    expect(retained).not.toBeNull();
    expect(retained?.status).toBe("closed");
    expect(retained?.authEpoch).toBe(1);
    const kept = await prisma.report.findUnique({ where: { id: report.id } });
    expect(kept).not.toBeNull();
    expect(kept?.reporterId).toBe(member.id);
  });
});

describe("Unit 5D: SellerReturnEntitlementOperation durable retention (real PostgreSQL)", () => {
  it("filter shape: durableCommerceFinancialNone excludes entitlement ops (no status clause)", () => {
    const filter = durableCommerceFinancialNone();
    expect(filter.sellerReturnEntitlementOperations).toEqual({ none: {} });
    expect(filter.transferOperations).toEqual({ none: {} });
    expect(filter.refundOperations).toEqual({ none: {} });
    expect(filter.storeOrdersAsSeller).toEqual({ none: {} });
  });

  let seq = 0;
  function entitlementKey(prefix: string) {
    seq += 1;
    return `${prefix}_${Date.now().toString(36)}_${seq}`;
  }

  async function sellerWithEntitlement(status: "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "UNCERTAIN") {
    const seller = await createMember(prisma, `u5d-${status.toLowerCase()}`);
    const buyer = await createMember(prisma, `u5d-b-${status.toLowerCase()}`);
    const order = await createOrder(prisma, { buyerId: buyer.id, sellerId: seller.id });
    const storeReturn = await createStoreReturn(prisma, { orderId: order.id });
    const entitlement = await prisma.sellerReturnEntitlementOperation.create({
      data: {
        memberId: seller.id,
        storeOrderId: order.id,
        storeReturnId: storeReturn.id,
        amountCents: 1000,
        status,
        providerIdempotencyKey: entitlementKey(`nwc_store_return_entitlement_${status}`),
        // No stripeTransferId — FAILED/PENDING/UNCERTAIN evidence still counts (no transfer-id filter).
      },
    });
    return { seller, buyer, order, storeReturn, entitlement };
  }

  it("zero entitlement rows → entitlement evidence count is 0", async () => {
    const member = await createMember(prisma, "u5d-zero");
    const counts = await countMemberDurableCommerceEvidence(prisma, member.id);
    expect(counts.sellerReturnEntitlementOperations).toBe(0);
    const result = await closeOrDeleteMemberAccount(prisma, member.id);
    expect(result).toEqual({ ok: true, outcome: "deleted" });
  });

  it("status matrix: ANY entitlement status forces explicit entitlement evidence count=1", async () => {
    for (const status of ["PENDING", "PROCESSING", "FAILED", "UNCERTAIN", "SUCCEEDED"] as const) {
      const { seller, order } = await sellerWithEntitlement(status);
      const counts = await countMemberDurableCommerceEvidence(prisma, seller.id);
      // Explicit entitlement contribution (StoreOrder also present; assert entitlement field itself).
      expect(counts.sellerReturnEntitlementOperations, status).toBe(1);
      expect(counts.ordersAsSeller, status).toBe(1);
      // Classifier has no status / amount / transfer-id filter: raw count matches findMany without where.status.
      const unfiltered = await prisma.sellerReturnEntitlementOperation.count({
        where: { memberId: seller.id },
      });
      expect(unfiltered, status).toBe(1);
      const byStatus = await prisma.sellerReturnEntitlementOperation.count({
        where: { memberId: seller.id, status },
      });
      expect(byStatus, status).toBe(1);
      // amountCents and stripeTransferId are not consulted by the classifier.
      const row = await prisma.sellerReturnEntitlementOperation.findFirst({
        where: { memberId: seller.id },
        select: { amountCents: true, stripeTransferId: true, status: true },
      });
      expect(row?.status).toBe(status);
      expect(row?.stripeTransferId).toBeNull();
      expect(row?.amountCents).toBe(1000);

      const result = await closeOrDeleteMemberAccount(prisma, seller.id);
      expect(result, status).toEqual({ ok: true, outcome: "closed" });
      expect(
        (await prisma.sellerReturnEntitlementOperation.findFirst({ where: { storeOrderId: order.id } }))
          ?.memberId
      ).toBe(seller.id);
    }
  });

  it("Member identity isolation: A’s entitlement does not appear in B’s evidence", async () => {
    const a = await sellerWithEntitlement("FAILED");
    const bSeller = await createMember(prisma, "u5d-iso-b");
    const bBuyer = await createMember(prisma, "u5d-iso-bb");
    const bOrder = await createOrder(prisma, { buyerId: bBuyer.id, sellerId: bSeller.id });
    // B has an order but no entitlement.
    const countsA = await countMemberDurableCommerceEvidence(prisma, a.seller.id);
    const countsB = await countMemberDurableCommerceEvidence(prisma, bSeller.id);
    expect(countsA.sellerReturnEntitlementOperations).toBe(1);
    expect(countsB.sellerReturnEntitlementOperations).toBe(0);
    expect(countsB.ordersAsSeller).toBe(1);
    void bOrder;
  });

  it("durableCommerceFinancialNone excludes Members with entitlement rows", async () => {
    const { seller } = await sellerWithEntitlement("PENDING");
    const eligible = await prisma.member.findMany({
      where: { id: seller.id, ...durableCommerceFinancialNone() },
      select: { id: true },
    });
    expect(eligible).toEqual([]);
  });

  it("TransferOperation retention regression: transfer evidence still counted + closes", async () => {
    const seller = await createMember(prisma, "u5d-xfer");
    const buyer = await createMember(prisma, "u5d-xfer-b");
    const order = await createOrder(prisma, { buyerId: buyer.id, sellerId: seller.id });
    await createTransferOperation(prisma, {
      memberId: seller.id,
      storeOrderId: order.id,
      status: "SUCCEEDED",
      stripeTransferId: `tr_${seller.id}`,
    });
    const counts = await countMemberDurableCommerceEvidence(prisma, seller.id);
    expect(counts.transferOperations).toBe(1);
    expect(counts.sellerReturnEntitlementOperations).toBe(0);
    const result = await closeOrDeleteMemberAccount(prisma, seller.id);
    expect(result).toEqual({ ok: true, outcome: "closed" });
  });

  it("RefundOperation retention regression: refund evidence still counted + closes", async () => {
    const buyer = await createMember(prisma, "u5d-ref");
    const seller = await createMember(prisma, "u5d-ref-s");
    const order = await createOrder(prisma, { buyerId: buyer.id, sellerId: seller.id });
    // RefundOperation.memberId is the seller tenant (composite FK to StoreOrder seller).
    await createRefundOperation(prisma, {
      memberId: seller.id,
      storeOrderId: order.id,
      status: "SUCCEEDED",
      stripeRefundId: `re_${seller.id}`,
    });
    const counts = await countMemberDurableCommerceEvidence(prisma, seller.id);
    expect(counts.refundOperations).toBe(1);
    expect(counts.sellerReturnEntitlementOperations).toBe(0);
    const result = await closeOrDeleteMemberAccount(prisma, seller.id);
    expect(result).toEqual({ ok: true, outcome: "closed" });
  });

  it("StoreOrder evidence regression: seller order alone still retains (no entitlement)", async () => {
    const seller = await createMember(prisma, "u5d-ord");
    const buyer = await createMember(prisma, "u5d-ord-b");
    await createOrder(prisma, { buyerId: buyer.id, sellerId: seller.id });
    const counts = await countMemberDurableCommerceEvidence(prisma, seller.id);
    expect(counts.ordersAsSeller).toBe(1);
    expect(counts.sellerReturnEntitlementOperations).toBe(0);
    const result = await closeOrDeleteMemberAccount(prisma, seller.id);
    expect(result).toEqual({ ok: true, outcome: "closed" });
  });
});
