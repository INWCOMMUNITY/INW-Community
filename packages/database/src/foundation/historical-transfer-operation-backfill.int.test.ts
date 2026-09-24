import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  evaluateFoundationPayoutRefundDisposition,
  beginFoundationTransferAttempt,
  foundationTransferIdempotencyKey,
  completeFoundationSellerPayoutLedger,
} from "../commerce-foundation-transfer";
import { prepareFoundationReturnSellerSettlement } from "../commerce-foundation-return-entitlement";
import { createMember, createStoreReturn } from "./fixtures";
import { foundationTestDatabaseUrl } from "./local-url";
import {
  analyzeHistoricalTransferOperationBackfill,
  applyHistoricalTransferOperationBackfill,
  classifyHistoricalTransferOperationCandidate,
  hashHistoricalToCandidates,
  reconstructHistoricalSellerTransferCents,
  HISTORICAL_STOREFRONT_TRANSFER_CURRENCY,
  type HistoricalToCandidateEvidence,
} from "./historical-transfer-operation-backfill";

let prisma: PrismaClient;

beforeAll(() => {
  prisma = new PrismaClient({
    datasources: { db: { url: foundationTestDatabaseUrl() } },
    log: ["error"],
  });
});

afterAll(async () => {
  await prisma?.$disconnect();
});

let seq = 0;
function nonce(prefix = "hto") {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

function baseEvidence(
  overrides: Partial<HistoricalToCandidateEvidence> = {}
): HistoricalToCandidateEvidence {
  const storeOrderId = overrides.storeOrderId ?? "ord_test";
  const sellerId = overrides.sellerId ?? "seller_test";
  const totalCents = overrides.totalCents ?? 1000;
  const platformFeeCents = overrides.platformFeeCents ?? 0;
  const salesTaxReserveCents = overrides.salesTaxReserveCents ?? 10;
  const expected = reconstructHistoricalSellerTransferCents({
    totalCents: totalCents as number,
    platformFeeCents: platformFeeCents as number,
    salesTaxReserveCents: salesTaxReserveCents as number,
  });
  return {
    storeOrderId,
    sellerId,
    status: "paid",
    stripeSellerTransferId: "tr_hist_abc123xyz",
    totalCents,
    subtotalCents: 1000,
    platformFeeCents,
    salesTaxReserveCents,
    stripeRefundId: null,
    refundCompletedAt: null,
    saleLedgers: [
      {
        id: "sale1",
        memberId: sellerId!,
        amountCents: expected,
        stripeTransferId: null,
        createdAt: new Date("2026-06-01T12:00:00.000Z"),
      },
    ],
    returnDebits: [],
    existingTransferOperation: null,
    canonicalKeyCollision: false,
    transferIdOwnedElsewhere: false,
    ...overrides,
  };
}

async function seedR1Shape(args?: {
  status?: string;
  transferId?: string;
  totalCents?: number;
  platformFeeCents?: number;
  salesTaxReserveCents?: number;
  saleAmountOverride?: number;
  withReturnDebit?: boolean;
  stripeRefundId?: string | null;
  refundCompletedAt?: Date | null;
  extraSale?: boolean;
  wrongSellerSale?: boolean;
}) {
  const seller = await createMember(prisma, "hto-seller");
  const other = args?.wrongSellerSale ? await createMember(prisma, "hto-other") : null;
  const buyer = await createMember(prisma, "hto-buyer");
  const totalCents = args?.totalCents ?? 1000;
  const platformFeeCents = args?.platformFeeCents ?? 0;
  const salesTaxReserveCents = args?.salesTaxReserveCents ?? 10;
  const expected = reconstructHistoricalSellerTransferCents({
    totalCents,
    platformFeeCents,
    salesTaxReserveCents,
  });
  const transferId = args?.transferId ?? `tr_${nonce()}`;
  const order = await prisma.storeOrder.create({
    data: {
      buyerId: buyer.id,
      sellerId: seller.id,
      totalCents,
      subtotalCents: totalCents,
      platformFeeCents,
      salesTaxReserveCents,
      status: args?.status ?? "paid",
      stripeSellerTransferId: transferId,
      stripeRefundId: args?.stripeRefundId ?? undefined,
      refundCompletedAt: args?.refundCompletedAt ?? undefined,
    },
  });
  const saleCreatedAt = new Date("2026-06-15T10:00:00.000Z");
  await prisma.sellerBalanceTransaction.create({
    data: {
      memberId: args?.wrongSellerSale && other ? other.id : seller.id,
      type: "sale",
      amountCents: args?.saleAmountOverride ?? expected,
      orderId: order.id,
      createdAt: saleCreatedAt,
    },
  });
  if (args?.extraSale) {
    await prisma.sellerBalanceTransaction.create({
      data: {
        memberId: seller.id,
        type: "sale",
        amountCents: expected,
        orderId: order.id,
      },
    });
  }
  if (args?.withReturnDebit) {
    await prisma.sellerBalanceTransaction.create({
      data: {
        memberId: seller.id,
        type: "return",
        amountCents: -expected,
        orderId: order.id,
      },
    });
  }
  return { seller, buyer, order, expected, transferId, saleCreatedAt };
}

describe("historical TO backfill — pure classifier", () => {
  it("Prompt-131 R1 shape (sale ledger without stripeTransferId) → R1", () => {
    const r = classifyHistoricalTransferOperationCandidate(baseEvidence());
    expect(r.classification).toBe("R1_UNAMBIGUOUS_PAID");
    expect(r.saleLedgerHasStripeTransferId).toBe(false);
    expect(r.currency).toBe(HISTORICAL_STOREFRONT_TRANSFER_CURRENCY);
  });

  it("sale amount mismatch → R2", () => {
    const e = baseEvidence();
    e.saleLedgers[0]!.amountCents = 1;
    expect(classifyHistoricalTransferOperationCandidate(e).classification).toBe(
      "R2_AMOUNT_OR_LEDGER_AMBIGUOUS"
    );
  });

  it("no sale ledger → R2", () => {
    const e = baseEvidence({ saleLedgers: [] });
    expect(classifyHistoricalTransferOperationCandidate(e).classification).toBe(
      "R2_AMOUNT_OR_LEDGER_AMBIGUOUS"
    );
  });

  it("duplicate sale ledgers → R2", () => {
    const e = baseEvidence();
    e.saleLedgers.push({ ...e.saleLedgers[0]!, id: "sale2" });
    expect(classifyHistoricalTransferOperationCandidate(e).classification).toBe(
      "R2_AMOUNT_OR_LEDGER_AMBIGUOUS"
    );
  });

  it("wrong seller on sale ledger → R4", () => {
    const e = baseEvidence();
    e.saleLedgers[0]!.memberId = "other_seller";
    expect(classifyHistoricalTransferOperationCandidate(e).classification).toBe(
      "R4_DATA_INCONSISTENCY"
    );
  });

  it("key collision → R4", () => {
    const e = baseEvidence({ canonicalKeyCollision: true });
    expect(classifyHistoricalTransferOperationCandidate(e).classification).toBe(
      "R4_DATA_INCONSISTENCY"
    );
  });

  it("transfer ID owned elsewhere → R4", () => {
    const e = baseEvidence({ transferIdOwnedElsewhere: true });
    expect(classifyHistoricalTransferOperationCandidate(e).classification).toBe(
      "R4_DATA_INCONSISTENCY"
    );
  });

  it("blank transfer ID → not R1", () => {
    const e = baseEvidence({ stripeSellerTransferId: "   " });
    expect(classifyHistoricalTransferOperationCandidate(e).classification).toBe(
      "NOT_A_LEGACY_TRANSFER_CANDIDATE"
    );
  });

  it("exact existing TO → ALREADY_CANONICAL", () => {
    const e = baseEvidence({
      existingTransferOperation: {
        id: "to1",
        storeOrderId: "ord_test",
        status: "SUCCEEDED",
        stripeTransferId: "tr_hist_abc123xyz",
        providerIdempotencyKey: foundationTransferIdempotencyKey("ord_test"),
        memberId: "seller_test",
        amountCents: 990,
        currency: "usd",
      },
    });
    expect(classifyHistoricalTransferOperationCandidate(e).classification).toBe("ALREADY_CANONICAL");
  });

  it.each([
    ["wrong memberId", { memberId: "other_seller" }],
    ["wrong amountCents", { amountCents: 1 }],
    ["wrong currency", { currency: "eur" }],
    ["wrong providerIdempotencyKey", { providerIdempotencyKey: "nwc_store_transfer_other" }],
    ["wrong stripeTransferId", { stripeTransferId: "tr_other" }],
    ["FAILED status", { status: "FAILED" }],
    ["UNCERTAIN status", { status: "UNCERTAIN" }],
    ["PENDING status", { status: "PENDING" }],
    ["PROCESSING status", { status: "PROCESSING" }],
  ] as const)("existing TO %s → R4 conflict", (_label, patch) => {
    const e = baseEvidence({
      existingTransferOperation: {
        id: "to1",
        storeOrderId: "ord_test",
        status: "SUCCEEDED",
        stripeTransferId: "tr_hist_abc123xyz",
        providerIdempotencyKey: foundationTransferIdempotencyKey("ord_test"),
        memberId: "seller_test",
        amountCents: 990,
        currency: "usd",
        ...patch,
      },
    });
    const r = classifyHistoricalTransferOperationCandidate(e);
    expect(r.classification).toBe("R4_DATA_INCONSISTENCY");
    expect(r.reasonCodes).toContain("EXISTING_TRANSFER_OPERATION_CONFLICT");
  });

  it("Prompt-131 R3 shape → R3", () => {
    const e = baseEvidence({
      status: "refunded",
      stripeRefundId: "re_abc",
      refundCompletedAt: new Date("2026-09-01T00:00:00.000Z"),
      returnDebits: [
        {
          id: "ret1",
          memberId: "seller_test",
          amountCents: -990,
          createdAt: new Date("2026-09-01T01:00:00.000Z"),
        },
      ],
    });
    const r = classifyHistoricalTransferOperationCandidate(e);
    expect(r.classification).toBe("R3_ALREADY_REFUNDED_LEGACY");
    expect(r.reasonCodes).toContain("LEGACY_REFUND_COMPLETED_WITH_RETURN_DEBIT");
  });

  it("refunded status alone is NOT R3", () => {
    const e = baseEvidence({ status: "refunded" });
    const r = classifyHistoricalTransferOperationCandidate(e);
    expect(r.classification).toBe("R2_AMOUNT_OR_LEDGER_AMBIGUOUS");
    expect(r.reasonCodes).toContain("REFUNDED_STATUS_WITHOUT_SETTLEMENT_EVIDENCE");
  });

  it("candidate hash is stable without generatedAt", () => {
    const a = classifyHistoricalTransferOperationCandidate(baseEvidence({ storeOrderId: "a" }));
    const b = classifyHistoricalTransferOperationCandidate(baseEvidence({ storeOrderId: "a" }));
    expect(hashHistoricalToCandidates([a])).toBe(hashHistoricalToCandidates([b]));
  });
});

describe("historical TO backfill — real PostgreSQL", () => {
  it("R1 exact production shape: create SUCCEEDED TO with historical timestamps; no ledger mutation", async () => {
    const { order, expected, transferId, saleCreatedAt, seller } = await seedR1Shape();
    const saleBefore = await prisma.sellerBalanceTransaction.count({
      where: { orderId: order.id },
    });

    const preview = await analyzeHistoricalTransferOperationBackfill(prisma, {
      storeOrderIds: [order.id],
    });
    expect(preview.counts.R1_UNAMBIGUOUS_PAID).toBe(1);
    expect(preview.mode).toBe("PREVIEW");

    const { manifest, createdTransferOperations } = await applyHistoricalTransferOperationBackfill(
      prisma,
      { storeOrderIds: [order.id], engineSha: "test-sha" }
    );
    expect(manifest.counts.created).toBe(1);
    expect(createdTransferOperations).toHaveLength(1);
    const to = createdTransferOperations[0]!;
    expect(to.status).toBe("SUCCEEDED");
    expect(to.stripeTransferId).toBe(transferId);
    expect(to.amountCents).toBe(expected);
    expect(to.currency).toBe("usd");
    expect(to.memberId).toBe(seller.id);
    expect(to.providerIdempotencyKey).toBe(foundationTransferIdempotencyKey(order.id));
    expect(to.retryCount).toBe(0);
    expect(to.lastError).toBeNull();
    expect(to.createdAt.toISOString()).toBe(saleCreatedAt.toISOString());
    expect(to.succeededAt!.toISOString()).toBe(saleCreatedAt.toISOString());

    const saleAfter = await prisma.sellerBalanceTransaction.count({ where: { orderId: order.id } });
    expect(saleAfter).toBe(saleBefore);

    const orderAfter = await prisma.storeOrder.findUnique({ where: { id: order.id } });
    expect(orderAfter!.stripeSellerTransferId).toBe(transferId);
    expect(orderAfter!.status).toBe("paid");
  });

  it("R3 exact production shape: no TO created; overall PARTIAL_BLOCKED_RESIDUALS", async () => {
    const { order } = await seedR1Shape({
      status: "refunded",
      withReturnDebit: true,
      stripeRefundId: `re_${nonce()}`,
      refundCompletedAt: new Date("2026-09-09T12:00:00.000Z"),
    });
    const preview = await analyzeHistoricalTransferOperationBackfill(prisma, {
      storeOrderIds: [order.id],
    });
    expect(preview.counts.R3_ALREADY_REFUNDED_LEGACY).toBe(1);

    const { manifest, createdTransferOperations } = await applyHistoricalTransferOperationBackfill(
      prisma,
      { storeOrderIds: [order.id] }
    );
    expect(createdTransferOperations).toHaveLength(0);
    expect(manifest.overallStatus).toBe("PARTIAL_BLOCKED_RESIDUALS");
    expect(manifest.conflicts.some((c) => c.storeOrderId === order.id)).toBe(true);
    expect(await prisma.transferOperation.count({ where: { storeOrderId: order.id } })).toBe(0);
  });

  it("stale preview: evidence changes before apply → refuse mutation", async () => {
    const { order, expected } = await seedR1Shape();
    const preview = await analyzeHistoricalTransferOperationBackfill(prisma, {
      storeOrderIds: [order.id],
    });
    expect(preview.counts.R1_UNAMBIGUOUS_PAID).toBe(1);

    await prisma.sellerBalanceTransaction.create({
      data: {
        memberId: order.sellerId,
        type: "sale",
        amountCents: expected,
        orderId: order.id,
      },
    });

    const { manifest, createdTransferOperations } = await applyHistoricalTransferOperationBackfill(
      prisma,
      {
        storeOrderIds: [order.id],
        expectedCandidateHash: preview.candidateHash,
      }
    );
    expect(createdTransferOperations).toHaveLength(0);
    expect(manifest.overallStatus).toBe("REFUSED");
    expect(manifest.applyResults[0]!.outcome).toBe("REFUSED_STALE");
  });

  it("existing TO → ALREADY_CANONICAL; second apply creates zero rows", async () => {
    const { order, expected, transferId, seller } = await seedR1Shape();
    await prisma.transferOperation.create({
      data: {
        storeOrderId: order.id,
        memberId: seller.id,
        providerIdempotencyKey: foundationTransferIdempotencyKey(order.id),
        stripeTransferId: transferId,
        amountCents: expected,
        currency: "usd",
        status: "SUCCEEDED",
        retryCount: 0,
      },
    });
    const { manifest, createdTransferOperations } = await applyHistoricalTransferOperationBackfill(
      prisma,
      { storeOrderIds: [order.id] }
    );
    expect(createdTransferOperations).toHaveLength(0);
    expect(manifest.applyResults[0]!.outcome).toBe("ALREADY_CANONICAL");
    expect(await prisma.transferOperation.count({ where: { storeOrderId: order.id } })).toBe(1);
  });

  it("transfer-ID collision across orders → R4 conflict, never ALREADY_CANONICAL", async () => {
    const sharedTr = `tr_shared_${nonce()}`;
    const a = await seedR1Shape({ transferId: sharedTr });
    const b = await seedR1Shape({ transferId: sharedTr });
    const first = await applyHistoricalTransferOperationBackfill(prisma, {
      storeOrderIds: [a.order.id],
    });
    expect(first.createdTransferOperations).toHaveLength(1);
    const second = await applyHistoricalTransferOperationBackfill(prisma, {
      storeOrderIds: [b.order.id],
    });
    expect(second.createdTransferOperations).toHaveLength(0);
    expect(second.manifest.applyResults[0]!.outcome).toBe("SKIPPED_NOT_R1");
    expect(second.manifest.applyResults[0]!.classification).toBe("R4_DATA_INCONSISTENCY");
    expect(second.manifest.applyResults[0]!.outcome).not.toBe("ALREADY_CANONICAL");
    expect(await prisma.transferOperation.count({ where: { stripeTransferId: sharedTr } })).toBe(1);
    expect(await prisma.transferOperation.count({ where: { storeOrderId: b.order.id } })).toBe(0);
  });

  it("concurrent same-order apply: one CREATED + one verified ALREADY_CANONICAL", async () => {
    const { order, expected, transferId, seller } = await seedR1Shape();
    const [r1, r2] = await Promise.all([
      applyHistoricalTransferOperationBackfill(prisma, { storeOrderIds: [order.id] }),
      applyHistoricalTransferOperationBackfill(prisma, { storeOrderIds: [order.id] }),
    ]);
    const created =
      r1.createdTransferOperations.length + r2.createdTransferOperations.length;
    const already =
      (r1.manifest.applyResults[0]?.outcome === "ALREADY_CANONICAL" ? 1 : 0) +
      (r2.manifest.applyResults[0]?.outcome === "ALREADY_CANONICAL" ? 1 : 0);
    expect(created).toBe(1);
    expect(already).toBe(1);
    const to = await prisma.transferOperation.findUnique({ where: { storeOrderId: order.id } });
    expect(to).not.toBeNull();
    expect(to!.status).toBe("SUCCEEDED");
    expect(to!.memberId).toBe(seller.id);
    expect(to!.amountCents).toBe(expected);
    expect(to!.stripeTransferId).toBe(transferId);
    expect(to!.providerIdempotencyKey).toBe(foundationTransferIdempotencyKey(order.id));
    expect(await prisma.transferOperation.count({ where: { storeOrderId: order.id } })).toBe(1);
  });

  it("FAILED existing TO with matching fields → R4, no overwrite", async () => {
    const { order, expected, transferId, seller } = await seedR1Shape();
    await prisma.transferOperation.create({
      data: {
        storeOrderId: order.id,
        memberId: seller.id,
        providerIdempotencyKey: foundationTransferIdempotencyKey(order.id),
        stripeTransferId: transferId,
        amountCents: expected,
        currency: "usd",
        status: "FAILED",
        retryCount: 0,
        lastError: "historical_noise",
      },
    });
    const preview = await analyzeHistoricalTransferOperationBackfill(prisma, {
      storeOrderIds: [order.id],
    });
    expect(preview.counts.R4_DATA_INCONSISTENCY).toBe(1);
    const { createdTransferOperations, manifest } = await applyHistoricalTransferOperationBackfill(
      prisma,
      { storeOrderIds: [order.id] }
    );
    expect(createdTransferOperations).toHaveLength(0);
    expect(manifest.applyResults[0]!.classification).toBe("R4_DATA_INCONSISTENCY");
    const to = await prisma.transferOperation.findUnique({ where: { storeOrderId: order.id } });
    expect(to!.status).toBe("FAILED");
    expect(to!.lastError).toBe("historical_noise");
  });

  it("mixed R1 + R3 apply → R1 created, R3 blocked, PARTIAL_BLOCKED_RESIDUALS", async () => {
    const r1 = await seedR1Shape();
    const r3 = await seedR1Shape({
      status: "refunded",
      withReturnDebit: true,
      stripeRefundId: `re_${nonce()}`,
      refundCompletedAt: new Date(),
    });
    const { manifest, createdTransferOperations } = await applyHistoricalTransferOperationBackfill(
      prisma,
      { storeOrderIds: [r1.order.id, r3.order.id] }
    );
    expect(createdTransferOperations).toHaveLength(1);
    expect(manifest.counts.created).toBe(1);
    expect(manifest.overallStatus).toBe("PARTIAL_BLOCKED_RESIDUALS");
    expect(await prisma.transferOperation.count({ where: { storeOrderId: r1.order.id } })).toBe(1);
    expect(await prisma.transferOperation.count({ where: { storeOrderId: r3.order.id } })).toBe(0);
    expect(manifest.conflicts.some((c) => c.storeOrderId === r3.order.id)).toBe(true);
  });

  it("after R1: Unit-2 disposition is TRANSFER_SUCCEEDED (paid-first)", async () => {
    const { order, expected, seller } = await seedR1Shape();
    const before = evaluateFoundationPayoutRefundDisposition({
      commerceStatus: "FINALIZED",
      transferOperation: null,
    });
    expect(before).toBe("NO_TRANSFER_ATTEMPTED");

    await applyHistoricalTransferOperationBackfill(prisma, { storeOrderIds: [order.id] });
    const to = await prisma.transferOperation.findUnique({ where: { storeOrderId: order.id } });
    expect(
      evaluateFoundationPayoutRefundDisposition({
        commerceStatus: "FINALIZED",
        transferOperation: to,
      })
    ).toBe("TRANSFER_SUCCEEDED");

    const storeReturn = await createStoreReturn(prisma, { orderId: order.id });
    const settlement = await prepareFoundationReturnSellerSettlement(prisma, {
      storeOrderId: order.id,
      storeReturnId: storeReturn.id,
      memberId: seller.id,
      originalSaleTransferCents: expected,
      entitlementAmountCents: 0,
      currency: "usd",
    });
    expect(settlement.kind).toBe("ORIGINAL_TRANSFER_SUCCEEDED");
    if (settlement.kind === "ORIGINAL_TRANSFER_SUCCEEDED") {
      expect(settlement.stripeTransferId).toBe(to!.stripeTransferId);
    }
  });

  it("after R1: payout begin is already_succeeded; ledger complete creates nothing", async () => {
    const { order, expected, seller } = await seedR1Shape();
    await prisma.storeOrder.update({
      where: { id: order.id },
      data: { commerceStatus: "FINALIZED", status: "paid" },
    });
    await applyHistoricalTransferOperationBackfill(prisma, { storeOrderIds: [order.id] });

    const begin = await beginFoundationTransferAttempt(prisma, {
      storeOrderId: order.id,
    });
    expect(begin.action).toBe("already_succeeded");

    const saleBefore = await prisma.sellerBalanceTransaction.count({
      where: { orderId: order.id, type: "sale" },
    });
    const ledger = await completeFoundationSellerPayoutLedger(prisma, {
      storeOrderId: order.id,
      sellerCreditsCents: expected,
    });
    expect(ledger.ledgerCreated).toBe(false);
    const saleAfter = await prisma.sellerBalanceTransaction.count({
      where: { orderId: order.id, type: "sale" },
    });
    expect(saleAfter).toBe(saleBefore);
  });

  it("R3 cannot be turned into paid-first TO by this unit", async () => {
    const { order } = await seedR1Shape({
      status: "refunded",
      withReturnDebit: true,
      stripeRefundId: `re_${nonce()}`,
      refundCompletedAt: new Date(),
    });
    await applyHistoricalTransferOperationBackfill(prisma, { storeOrderIds: [order.id] });
    expect(await prisma.transferOperation.count({ where: { storeOrderId: order.id } })).toBe(0);
    expect(
      evaluateFoundationPayoutRefundDisposition({
        commerceStatus: "FINALIZED",
        transferOperation: null,
      })
    ).toBe("NO_TRANSFER_ATTEMPTED");
  });

  it("sale amount mismatch / no ledger / wrong seller fixtures via apply skip", async () => {
    const mismatch = await seedR1Shape({ saleAmountOverride: 1 });
    const none = await seedR1Shape();
    await prisma.sellerBalanceTransaction.deleteMany({ where: { orderId: none.order.id } });
    const wrong = await seedR1Shape({ wrongSellerSale: true });

    const m = await analyzeHistoricalTransferOperationBackfill(prisma, {
      storeOrderIds: [mismatch.order.id, none.order.id, wrong.order.id],
    });
    expect(m.counts.R2_AMOUNT_OR_LEDGER_AMBIGUOUS).toBeGreaterThanOrEqual(2);
    expect(m.counts.R4_DATA_INCONSISTENCY).toBeGreaterThanOrEqual(1);
  });

  it("static: module source has no Stripe/network imports", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "historical-transfer-operation-backfill");
    const files = fs.readdirSync(dir).filter((f: string) => f.endsWith(".ts"));
    const blob = files.map((f: string) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n");
    expect(blob).not.toMatch(/from ["']stripe["']/);
    expect(blob).not.toMatch(/createReversal/);
    expect(blob).not.toMatch(/\bfetch\s*\(/);
    expect(blob).not.toMatch(/shippo/i);
    expect(blob).not.toMatch(/completeFoundationSellerPayoutLedger\s*\(/);
    expect(blob).not.toMatch(/import\s*\{[^}]*completeFoundationSellerPayoutLedger/);
  });
});

describe("historical TO backfill — cutover allowlist", () => {
  it("apply cutover allowlist is LEGACY and FROZEN only", async () => {
    const { HISTORICAL_TO_ALLOWED_APPLY_CUTOVER_MODES } = await import(
      "./historical-transfer-operation-backfill"
    );
    expect([...HISTORICAL_TO_ALLOWED_APPLY_CUTOVER_MODES]).toEqual(["LEGACY", "FROZEN"]);
  });
});
