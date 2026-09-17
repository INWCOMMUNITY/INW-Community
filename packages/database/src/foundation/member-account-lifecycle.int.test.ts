import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeOrDeleteMemberAccount, durableCommerceFinancialNone } from "../member-account-lifecycle";
import {
  createCheckoutAttempt,
  createListing,
  createMember,
  createOrder,
  createStoreItem,
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
