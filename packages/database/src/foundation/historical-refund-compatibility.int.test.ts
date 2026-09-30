/**
 * R3 historical-refund compatibility — pure classifier + real PostgreSQL proofs.
 *
 * Excluded from packages/database tsc (imports apps/main public restock/settlement).
 * Vitest compiles via foundation alias against disposable Foundation Postgres.
 */
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  foundationSellerPayoutRecoveryWhere,
  lockFoundationPayoutOutForRefund,
} from "../commerce-foundation-transfer";
import { prepareFoundationReturnSellerSettlement } from "../commerce-foundation-return-entitlement";
import { reconstructHistoricalSellerTransferCents } from "./historical-transfer-operation-backfill";
import {
  analyzeHistoricalRefundCompatibility,
  classifyHistoricalRefundCompatibility,
  hashHistoricalRefundCompatibilityRecords,
  hasStrongHistoricalSettledFingerprintIgnoringCanonicalOps,
  isCanonicalFoundationOpOnlyAnomalyReasons,
  resolveHistoricalRefundRuntimeDecision,
  runHistoricalExternalRefundRestockBranch,
  shouldSkipSellerLedgerDebitForHistoricalRefund,
  type HistoricalRefundCompatibilityEvidence,
  type HistoricalRefundCompatibilityReasonCode,
} from "./historical-refund-compatibility";
import { restockAfterExternalRefund } from "../../../../apps/main/src/lib/stripe/refund-store-order";
import { completeReceivedStoreReturnSettlement } from "../../../../apps/main/src/lib/store-return-settlement";
import { createMember, createStoreReturn, createTransferOperation, createRefundOperation } from "./fixtures";
import { foundationTestDatabaseUrl } from "./local-url";

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
function nonce(prefix = "hrc") {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

function baseEvidence(
  overrides: Partial<HistoricalRefundCompatibilityEvidence> = {}
): HistoricalRefundCompatibilityEvidence {
  const storeOrderId = overrides.storeOrderId ?? "ord_r3";
  const sellerId = overrides.sellerId ?? "seller_r3";
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
    status: "refunded",
    stripeSellerTransferId: "tr_legacy_r3_abc",
    stripeRefundId: "re_legacy_1",
    refundCompletedAt: new Date("2026-07-01T00:00:00.000Z"),
    totalCents,
    platformFeeCents,
    salesTaxReserveCents,
    saleLedgers: [
      {
        id: "sale1",
        memberId: sellerId!,
        type: "sale",
        amountCents: expected,
        orderId: storeOrderId,
        stripeTransferId: null,
        createdAt: new Date("2026-06-01T00:00:00.000Z"),
      },
    ],
    returnDebits: [
      {
        id: "ret1",
        memberId: sellerId!,
        type: "return",
        amountCents: -expected,
        orderId: storeOrderId,
        stripeTransferId: null,
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
      },
    ],
    transferOperation: null,
    refundOperationCount: 0,
    sellerReturnEntitlementOperationCount: 0,
    ...overrides,
  };
}

async function seedStrictR3(args?: {
  inventoryRestoredAt?: Date | null;
  wrongSellerDebit?: boolean;
  wrongDebitAmount?: boolean;
  noReturnDebit?: boolean;
  duplicateReturn?: boolean;
  noSale?: boolean;
  duplicateSale?: boolean;
  wrongSaleSeller?: boolean;
  wrongSaleAmount?: boolean;
  status?: string;
  stripeRefundId?: string | null;
  refundCompletedAt?: Date | null;
  withTransfer?: "SUCCEEDED" | "FAILED";
  withRefundOperation?: boolean;
  withEntitlement?: boolean;
}) {
  const seller = await createMember(prisma, "hrc-seller");
  const other = await createMember(prisma, "hrc-other");
  const buyer = await createMember(prisma, "hrc-buyer");
  const totalCents = 1000;
  const platformFeeCents = 0;
  const salesTaxReserveCents = 10;
  const expected = reconstructHistoricalSellerTransferCents({
    totalCents,
    platformFeeCents,
    salesTaxReserveCents,
  });
  const order = await prisma.storeOrder.create({
    data: {
      buyerId: buyer.id,
      sellerId: seller.id,
      totalCents,
      subtotalCents: totalCents,
      platformFeeCents,
      salesTaxReserveCents,
      status: args?.status ?? "refunded",
      stripeSellerTransferId: `tr_${nonce()}`,
      stripeRefundId: args?.stripeRefundId === null ? undefined : (args?.stripeRefundId ?? `re_${nonce()}`),
      refundCompletedAt:
        args?.refundCompletedAt === null
          ? undefined
          : (args?.refundCompletedAt ?? new Date("2026-07-01T00:00:00.000Z")),
      inventoryRestoredAt: args?.inventoryRestoredAt === undefined ? null : args.inventoryRestoredAt,
      commerceStatus: "FINALIZED",
    },
  });

  if (!args?.noSale) {
    await prisma.sellerBalanceTransaction.create({
      data: {
        memberId: args?.wrongSaleSeller ? other.id : seller.id,
        type: "sale",
        amountCents: args?.wrongSaleAmount ? expected - 1 : expected,
        orderId: order.id,
      },
    });
    if (args?.duplicateSale) {
      await prisma.sellerBalanceTransaction.create({
        data: {
          memberId: seller.id,
          type: "sale",
          amountCents: expected,
          orderId: order.id,
        },
      });
    }
  }

  if (!args?.noReturnDebit) {
    await prisma.sellerBalanceTransaction.create({
      data: {
        memberId: args?.wrongSellerDebit ? other.id : seller.id,
        type: "return",
        amountCents: args?.wrongDebitAmount ? -(expected - 1) : -expected,
        orderId: order.id,
      },
    });
    if (args?.duplicateReturn) {
      await prisma.sellerBalanceTransaction.create({
        data: {
          memberId: seller.id,
          type: "return",
          amountCents: -expected,
          orderId: order.id,
        },
      });
    }
  }

  if (args?.withTransfer) {
    await createTransferOperation(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      amountCents: expected,
      status: args.withTransfer,
      stripeTransferId: args.withTransfer === "SUCCEEDED" ? `tr_to_${nonce()}` : null,
      providerIdempotencyKey: `nwc_store_transfer_${order.id}`,
    });
  }

  if (args?.withRefundOperation) {
    await createRefundOperation(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      amountCents: 1000,
    });
  }

  if (args?.withEntitlement) {
    const sr = await createStoreReturn(prisma, { orderId: order.id, status: "received" });
    await prisma.sellerReturnEntitlementOperation.create({
      data: {
        storeOrderId: order.id,
        storeReturnId: sr.id,
        memberId: seller.id,
        amountCents: 100,
        currency: "usd",
        providerIdempotencyKey: `nwc_store_return_entitlement_${order.id}`,
        status: "PENDING",
      },
    });
  }

  return { seller, buyer, other, order, expected };
}

describe("historical refund compatibility — pure classifier", () => {
  it("exact production R3 shape → SETTLED", () => {
    const r = classifyHistoricalRefundCompatibility(baseEvidence());
    expect(r.classification).toBe("HISTORICAL_REFUND_ALREADY_SETTLED");
    expect(r.reasonCodes).toContain("RETURN_DEBIT_EXACT_ONE");
  });

  it("wrong seller return debit → ANOMALY", () => {
    const e = baseEvidence();
    e.returnDebits[0]!.memberId = "other";
    expect(classifyHistoricalRefundCompatibility(e).classification).toBe("HISTORICAL_REFUND_ANOMALY");
    expect(classifyHistoricalRefundCompatibility(e).reasonCodes).toContain("RETURN_DEBIT_SELLER_MISMATCH");
  });

  it("wrong return amount → ANOMALY", () => {
    const e = baseEvidence();
    e.returnDebits[0]!.amountCents = -1;
    expect(classifyHistoricalRefundCompatibility(e).classification).toBe("HISTORICAL_REFUND_ANOMALY");
    expect(classifyHistoricalRefundCompatibility(e).reasonCodes).toContain("RETURN_DEBIT_AMOUNT_MISMATCH");
  });

  it("zero return debit → AMBIGUOUS", () => {
    const e = baseEvidence({ returnDebits: [] });
    expect(classifyHistoricalRefundCompatibility(e).classification).toBe("HISTORICAL_REFUND_AMBIGUOUS");
    expect(classifyHistoricalRefundCompatibility(e).reasonCodes).toContain("RETURN_DEBIT_MISSING");
  });

  it("duplicate return debit → ANOMALY", () => {
    const e = baseEvidence();
    e.returnDebits.push({ ...e.returnDebits[0]!, id: "ret2" });
    expect(classifyHistoricalRefundCompatibility(e).classification).toBe("HISTORICAL_REFUND_ANOMALY");
    expect(classifyHistoricalRefundCompatibility(e).reasonCodes).toContain("RETURN_DEBIT_DUPLICATE");
  });

  it("no sale → AMBIGUOUS", () => {
    expect(classifyHistoricalRefundCompatibility(baseEvidence({ saleLedgers: [] })).classification).toBe(
      "HISTORICAL_REFUND_AMBIGUOUS"
    );
  });

  it("duplicate sale → ANOMALY", () => {
    const e = baseEvidence();
    e.saleLedgers.push({ ...e.saleLedgers[0]!, id: "sale2" });
    expect(classifyHistoricalRefundCompatibility(e).classification).toBe("HISTORICAL_REFUND_ANOMALY");
  });

  it("wrong sale seller → ANOMALY", () => {
    const e = baseEvidence();
    e.saleLedgers[0]!.memberId = "other";
    expect(classifyHistoricalRefundCompatibility(e).classification).toBe("HISTORICAL_REFUND_ANOMALY");
  });

  it("wrong sale amount → ANOMALY", () => {
    const e = baseEvidence();
    e.saleLedgers[0]!.amountCents = 1;
    expect(classifyHistoricalRefundCompatibility(e).classification).toBe("HISTORICAL_REFUND_ANOMALY");
  });

  it("status refunded only without completion → AMBIGUOUS", () => {
    const e = baseEvidence({ stripeRefundId: null, refundCompletedAt: null });
    expect(classifyHistoricalRefundCompatibility(e).classification).toBe("HISTORICAL_REFUND_AMBIGUOUS");
  });

  it("refund id but wrong status → NOT historical", () => {
    const e = baseEvidence({ status: "paid" });
    expect(classifyHistoricalRefundCompatibility(e).classification).toBe("NOT_HISTORICAL_LEGACY_REFUND");
  });

  it("paid Foundation shape (legacy id + TO) → NOT historical (ordinary Foundation continues)", () => {
    const e = baseEvidence({
      status: "paid",
      transferOperation: {
        id: "to1",
        status: "SUCCEEDED",
        stripeTransferId: "tr_x",
        amountCents: 990,
        memberId: "seller_r3",
      },
    });
    expect(classifyHistoricalRefundCompatibility(e).classification).toBe("NOT_HISTORICAL_LEGACY_REFUND");
    expect(classifyHistoricalRefundCompatibility(e).reasonCodes).toContain("ORDER_STATUS_NOT_REFUNDED");
  });

  it("refundCompletedAt alone + refunded → can SETTLE", () => {
    const e = baseEvidence({ stripeRefundId: null, refundCompletedAt: new Date() });
    expect(classifyHistoricalRefundCompatibility(e).classification).toBe("HISTORICAL_REFUND_ALREADY_SETTLED");
  });

  it("stripeRefundId alone + refunded → can SETTLE", () => {
    const e = baseEvidence({ refundCompletedAt: null, stripeRefundId: "re_x" });
    expect(classifyHistoricalRefundCompatibility(e).classification).toBe("HISTORICAL_REFUND_ALREADY_SETTLED");
  });

  it("SUCCEEDED TO present → ANOMALY", () => {
    const e = baseEvidence({
      transferOperation: {
        id: "to1",
        status: "SUCCEEDED",
        stripeTransferId: "tr_x",
        amountCents: 990,
        memberId: "seller_r3",
      },
    });
    expect(classifyHistoricalRefundCompatibility(e).classification).toBe("HISTORICAL_REFUND_ANOMALY");
  });

  it("FAILED TO present → ANOMALY", () => {
    const e = baseEvidence({
      transferOperation: {
        id: "to1",
        status: "FAILED",
        stripeTransferId: null,
        amountCents: 990,
        memberId: "seller_r3",
      },
    });
    expect(classifyHistoricalRefundCompatibility(e).classification).toBe("HISTORICAL_REFUND_ANOMALY");
  });

  it("RefundOperation present → ANOMALY", () => {
    const e = baseEvidence({ refundOperationCount: 1 });
    expect(classifyHistoricalRefundCompatibility(e).classification).toBe("HISTORICAL_REFUND_ANOMALY");
  });

  it("entitlement operation present → ANOMALY", () => {
    const e = baseEvidence({ sellerReturnEntitlementOperationCount: 1 });
    expect(classifyHistoricalRefundCompatibility(e).classification).toBe("HISTORICAL_REFUND_ANOMALY");
  });

  it("missing legacy transfer id → NOT historical", () => {
    const e = baseEvidence({ stripeSellerTransferId: null });
    expect(classifyHistoricalRefundCompatibility(e).classification).toBe("NOT_HISTORICAL_LEGACY_REFUND");
  });

  it("evidence hash is stable and excludes generatedAt", () => {
    const a = classifyHistoricalRefundCompatibility(baseEvidence());
    const b = classifyHistoricalRefundCompatibility(baseEvidence());
    expect(hashHistoricalRefundCompatibilityRecords([a])).toBe(hashHistoricalRefundCompatibilityRecords([b]));
  });

  it("static: module source has no Stripe/network imports", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "historical-refund-compatibility");
    const files = fs.readdirSync(dir).filter((f: string) => f.endsWith(".ts"));
    const blob = files.map((f: string) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n");
    expect(blob).not.toMatch(/from ["']stripe["']/);
    expect(blob).not.toMatch(/\bfetch\s*\(/);
    expect(blob).not.toMatch(/from ["']node:https?["']/);
  });
});

describe("historical refund compatibility — runtime provenance", () => {
  function decide(evidence: HistoricalRefundCompatibilityEvidence) {
    const record = classifyHistoricalRefundCompatibility(evidence);
    return { record, decision: resolveHistoricalRefundRuntimeDecision(record, evidence) };
  }

  it("clean SETTLED → NOOP", () => {
    const { decision } = decide(baseEvidence());
    expect(decision.action).toBe("HISTORICAL_FINANCIAL_NOOP");
  });

  it("AMBIGUOUS → REVIEW", () => {
    const { decision } = decide(baseEvidence({ returnDebits: [] }));
    expect(decision.action).toBe("HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED");
  });

  it("ledger ANOMALY → REVIEW", () => {
    const e = baseEvidence();
    e.returnDebits[0]!.memberId = "other";
    expect(decide(e).decision.action).toBe("HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED");
  });

  it("R3 exact + SUCCEEDED TO → REVIEW (not CONTINUE)", () => {
    const e = baseEvidence({
      transferOperation: {
        id: "to1",
        status: "SUCCEEDED",
        stripeTransferId: "tr_x",
        amountCents: 990,
        memberId: "seller_r3",
      },
    });
    const { record, decision } = decide(e);
    expect(record.classification).toBe("HISTORICAL_REFUND_ANOMALY");
    expect(hasStrongHistoricalSettledFingerprintIgnoringCanonicalOps(e)).toBe(true);
    expect(decision.action).toBe("HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED");
  });

  it("R3 exact + RefundOperation → REVIEW", () => {
    const { decision } = decide(baseEvidence({ refundOperationCount: 1 }));
    expect(decision.action).toBe("HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED");
  });

  it("R3 exact + SREO → REVIEW", () => {
    const { decision } = decide(baseEvidence({ sellerReturnEntitlementOperationCount: 1 }));
    expect(decision.action).toBe("HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED");
  });

  it("R3 exact + all Foundation ops → REVIEW", () => {
    const { decision } = decide(
      baseEvidence({
        transferOperation: {
          id: "to1",
          status: "FAILED",
          stripeTransferId: null,
          amountCents: 990,
          memberId: "seller_r3",
        },
        refundOperationCount: 1,
        sellerReturnEntitlementOperationCount: 1,
      })
    );
    expect(decision.action).toBe("HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED");
  });

  it("ledger mismatch + TO → REVIEW", () => {
    const e = baseEvidence({
      transferOperation: {
        id: "to1",
        status: "SUCCEEDED",
        stripeTransferId: "tr_x",
        amountCents: 990,
        memberId: "seller_r3",
      },
    });
    e.returnDebits[0]!.amountCents = -1;
    expect(decide(e).decision.action).toBe("HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED");
  });

  it("canonical-only TO anomaly / no historical return fingerprint → CONTINUE", () => {
    const e = baseEvidence({
      returnDebits: [],
      transferOperation: {
        id: "to1",
        status: "SUCCEEDED",
        stripeTransferId: "tr_x",
        amountCents: 990,
        memberId: "seller_r3",
      },
    });
    const { record, decision } = decide(e);
    expect(record.classification).toBe("HISTORICAL_REFUND_ANOMALY");
    expect(hasStrongHistoricalSettledFingerprintIgnoringCanonicalOps(e)).toBe(false);
    expect(decision.action).toBe("CONTINUE_ORDINARY_FOUNDATION");
  });

  it("canonical-only RefundOp / no return fingerprint → CONTINUE", () => {
    const e = baseEvidence({ returnDebits: [], refundOperationCount: 1, transferOperation: null });
    // Without TO, classifier may hit refund op after refunded path... with returnDebits empty
    // After TO absent, RO present → ANOMALY early
    const { decision } = decide(e);
    expect(decision.action).toBe("CONTINUE_ORDINARY_FOUNDATION");
  });

  it("Foundation paid nonrefunded → CONTINUE", () => {
    const { record, decision } = decide(
      baseEvidence({
        status: "paid",
        transferOperation: {
          id: "to1",
          status: "SUCCEEDED",
          stripeTransferId: "tr_x",
          amountCents: 990,
          memberId: "seller_r3",
        },
      })
    );
    expect(record.classification).toBe("NOT_HISTORICAL_LEGACY_REFUND");
    expect(decision.action).toBe("CONTINUE_ORDINARY_FOUNDATION");
  });

  it("unknown anomaly reason defaults REVIEW", () => {
    const record = classifyHistoricalRefundCompatibility(baseEvidence({ returnDebits: [] }));
    const forged = {
      ...record,
      classification: "HISTORICAL_REFUND_ANOMALY" as const,
      reasonCodes: [
        "TRANSFER_OPERATION_PRESENT",
        "NOT_A_REAL_REASON",
      ] as HistoricalRefundCompatibilityReasonCode[],
    };
    expect(isCanonicalFoundationOpOnlyAnomalyReasons(forged.reasonCodes)).toBe(false);
    const decision = resolveHistoricalRefundRuntimeDecision(
      forged,
      baseEvidence({ returnDebits: [], transferOperation: null })
    );
    expect(decision.action).toBe("HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED");
  });

  it("ANOMALY without evidence argument defaults REVIEW", () => {
    const record = classifyHistoricalRefundCompatibility(
      baseEvidence({
        returnDebits: [],
        transferOperation: {
          id: "to1",
          status: "SUCCEEDED",
          stripeTransferId: "tr_x",
          amountCents: 990,
          memberId: "seller_r3",
        },
      })
    );
    expect(resolveHistoricalRefundRuntimeDecision(record).action).toBe(
      "HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED"
    );
  });
});

describe("historical refund compatibility — real DB", () => {
  it("production-shape SETTLED via analyze allowlist", async () => {
    const { order, expected } = await seedStrictR3();
    const manifest = await analyzeHistoricalRefundCompatibility(prisma, { storeOrderIds: [order.id] });
    expect(manifest.candidateCount).toBe(1);
    expect(manifest.candidates[0]!.classification).toBe("HISTORICAL_REFUND_ALREADY_SETTLED");
    expect(manifest.candidates[0]!.expectedSellerTransferCents).toBe(expected);
    expect(manifest.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("wrong-seller / wrong-amount / zero / duplicate debit matrix", async () => {
    const wrongSeller = await seedStrictR3({ wrongSellerDebit: true });
    const wrongAmt = await seedStrictR3({ wrongDebitAmount: true });
    const zero = await seedStrictR3({ noReturnDebit: true });
    const dup = await seedStrictR3({ duplicateReturn: true });
    const m = await analyzeHistoricalRefundCompatibility(prisma, {
      storeOrderIds: [wrongSeller.order.id, wrongAmt.order.id, zero.order.id, dup.order.id],
    });
    const byId = Object.fromEntries(m.candidates.map((c) => [c.storeOrderId, c.classification]));
    expect(byId[wrongSeller.order.id]).toBe("HISTORICAL_REFUND_ANOMALY");
    expect(byId[wrongAmt.order.id]).toBe("HISTORICAL_REFUND_ANOMALY");
    expect(byId[zero.order.id]).toBe("HISTORICAL_REFUND_AMBIGUOUS");
    expect(byId[dup.order.id]).toBe("HISTORICAL_REFUND_ANOMALY");
  });

  it("sale ledger anomaly matrix", async () => {
    const noSale = await seedStrictR3({ noSale: true });
    const dup = await seedStrictR3({ duplicateSale: true });
    const wrongSeller = await seedStrictR3({ wrongSaleSeller: true });
    const wrongAmt = await seedStrictR3({ wrongSaleAmount: true });
    const m = await analyzeHistoricalRefundCompatibility(prisma, {
      storeOrderIds: [noSale.order.id, dup.order.id, wrongSeller.order.id, wrongAmt.order.id],
    });
    const byId = Object.fromEntries(m.candidates.map((c) => [c.storeOrderId, c.classification]));
    expect(byId[noSale.order.id]).toBe("HISTORICAL_REFUND_AMBIGUOUS");
    expect(byId[dup.order.id]).toBe("HISTORICAL_REFUND_ANOMALY");
    expect(byId[wrongSeller.order.id]).toBe("HISTORICAL_REFUND_ANOMALY");
    expect(byId[wrongAmt.order.id]).toBe("HISTORICAL_REFUND_ANOMALY");
  });

  it("TO presence SUCCEEDED/FAILED → ANOMALY", async () => {
    const ok = await seedStrictR3({ withTransfer: "SUCCEEDED" });
    const fail = await seedStrictR3({ withTransfer: "FAILED" });
    // FAILED createTransferOperation may need stripeTransferId null - check fixture
    const m = await analyzeHistoricalRefundCompatibility(prisma, {
      storeOrderIds: [ok.order.id, fail.order.id],
    });
    expect(m.candidates.every((c) => c.classification === "HISTORICAL_REFUND_ANOMALY")).toBe(true);
  });

  it("Foundation RefundOperation / entitlement → ANOMALY", async () => {
    const ro = await seedStrictR3({ withRefundOperation: true });
    const ent = await seedStrictR3({ withEntitlement: true });
    const m = await analyzeHistoricalRefundCompatibility(prisma, {
      storeOrderIds: [ro.order.id, ent.order.id],
    });
    expect(m.candidates.every((c) => c.classification === "HISTORICAL_REFUND_ANOMALY")).toBe(true);
  });

  it("prepare settlement → HISTORICALLY_SETTLED with zero money mutations", async () => {
    const { seller, order, expected } = await seedStrictR3();
    const storeReturn = await createStoreReturn(prisma, {
      orderId: order.id,
      status: "received",
      receivedAt: new Date(),
    });
    const beforeTo = await prisma.transferOperation.count({ where: { storeOrderId: order.id } });
    const beforeDebits = await prisma.sellerBalanceTransaction.count({
      where: { orderId: order.id, type: "return" },
    });
    const beforeEnt = await prisma.sellerReturnEntitlementOperation.count({
      where: { storeOrderId: order.id },
    });

    const prepared = await prepareFoundationReturnSellerSettlement(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      storeReturnId: storeReturn.id,
      originalSaleTransferCents: expected,
      entitlementAmountCents: 0,
      currency: "usd",
    });
    expect(prepared.kind).toBe("HISTORICALLY_SETTLED");

    expect(await prisma.transferOperation.count({ where: { storeOrderId: order.id } })).toBe(beforeTo);
    expect(
      await prisma.sellerBalanceTransaction.count({ where: { orderId: order.id, type: "return" } })
    ).toBe(beforeDebits);
    expect(
      await prisma.sellerReturnEntitlementOperation.count({ where: { storeOrderId: order.id } })
    ).toBe(beforeEnt);
    expect(await prisma.refundOperation.count({ where: { storeOrderId: order.id } })).toBe(0);
  });

  it("prepare AMBIGUOUS (missing return debit): review-required, zero TO/entitlement/ledger", async () => {
    const { seller, order, expected } = await seedStrictR3({ noReturnDebit: true });
    const storeReturn = await createStoreReturn(prisma, { orderId: order.id, status: "received" });
    const prepared = await prepareFoundationReturnSellerSettlement(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      storeReturnId: storeReturn.id,
      originalSaleTransferCents: expected,
      entitlementAmountCents: 0,
      currency: "usd",
    });
    expect(prepared.kind).toBe("HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED");
    if (prepared.kind === "HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED") {
      expect(prepared.classification).toBe("HISTORICAL_REFUND_AMBIGUOUS");
    }
    expect(await prisma.transferOperation.count({ where: { storeOrderId: order.id } })).toBe(0);
    expect(
      await prisma.sellerReturnEntitlementOperation.count({ where: { storeOrderId: order.id } })
    ).toBe(0);
    expect(
      await prisma.sellerBalanceTransaction.count({ where: { orderId: order.id, type: "return" } })
    ).toBe(0);
  });

  it("prepare ANOMALY (wrong-seller debit): review-required, zero TO/entitlement", async () => {
    const { seller, order, expected } = await seedStrictR3({ wrongSellerDebit: true });
    const storeReturn = await createStoreReturn(prisma, { orderId: order.id, status: "received" });
    const beforeDebits = await prisma.sellerBalanceTransaction.count({
      where: { orderId: order.id, type: "return" },
    });
    const prepared = await prepareFoundationReturnSellerSettlement(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      storeReturnId: storeReturn.id,
      originalSaleTransferCents: expected,
      entitlementAmountCents: 0,
      currency: "usd",
    });
    expect(prepared.kind).toBe("HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED");
    if (prepared.kind === "HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED") {
      expect(prepared.classification).toBe("HISTORICAL_REFUND_ANOMALY");
    }
    expect(await prisma.transferOperation.count({ where: { storeOrderId: order.id } })).toBe(0);
    expect(
      await prisma.sellerReturnEntitlementOperation.count({ where: { storeOrderId: order.id } })
    ).toBe(0);
    expect(
      await prisma.sellerBalanceTransaction.count({ where: { orderId: order.id, type: "return" } })
    ).toBe(beforeDebits);
  });

  it("payout lock → HISTORICALLY_SETTLED with zero TO creation", async () => {
    const { order } = await seedStrictR3();
    const before = await prisma.transferOperation.count({ where: { storeOrderId: order.id } });
    const lock = await lockFoundationPayoutOutForRefund(prisma, { storeOrderId: order.id });
    expect(lock.kind).toBe("HISTORICALLY_SETTLED");
    expect(await prisma.transferOperation.count({ where: { storeOrderId: order.id } })).toBe(before);
  });

  it("payout lock AMBIGUOUS: review-required, TransferOperation count remains 0", async () => {
    const { order } = await seedStrictR3({ noReturnDebit: true });
    const lock = await lockFoundationPayoutOutForRefund(prisma, { storeOrderId: order.id });
    expect(lock.kind).toBe("HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED");
    expect(await prisma.transferOperation.count({ where: { storeOrderId: order.id } })).toBe(0);
  });

  it("payout lock ANOMALY: review-required, TransferOperation count remains 0", async () => {
    const { order } = await seedStrictR3({ wrongDebitAmount: true });
    const lock = await lockFoundationPayoutOutForRefund(prisma, { storeOrderId: order.id });
    expect(lock.kind).toBe("HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED");
    expect(await prisma.transferOperation.count({ where: { storeOrderId: order.id } })).toBe(0);
  });

  it("external restock SETTLED: inventory converges, return debit unchanged, replay safe", async () => {
    const { order, expected } = await seedStrictR3({ inventoryRestoredAt: null });
    const beforeDebits = await prisma.sellerBalanceTransaction.count({
      where: { orderId: order.id, type: "return", amountCents: -expected },
    });
    expect(beforeDebits).toBe(1);
    expect(await shouldSkipSellerLedgerDebitForHistoricalRefund(prisma, order.id)).toBe(true);

    const runOnce = async () => {
      const branch = await runHistoricalExternalRefundRestockBranch(prisma, order.id);
      expect(branch.handled).toBe(true);
      expect(branch.sellerDebitApplied).toBe(false);
    };

    await runOnce();
    await runOnce();
    const after = await prisma.storeOrder.findUnique({ where: { id: order.id } });
    expect(after?.inventoryRestoredAt).not.toBeNull();
    expect(
      await prisma.sellerBalanceTransaction.count({
        where: { orderId: order.id, type: "return", amountCents: -expected },
      })
    ).toBe(1);
    expect(await prisma.transferOperation.count({ where: { storeOrderId: order.id } })).toBe(0);
  });

  it("external restock AMBIGUOUS: zero debit/TO; inventory may converge", async () => {
    const { order } = await seedStrictR3({ noReturnDebit: true, inventoryRestoredAt: null });
    const branch = await runHistoricalExternalRefundRestockBranch(prisma, order.id);
    expect(branch.handled).toBe(true);
    expect(branch.decision.action).toBe("HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED");
    expect(branch.sellerDebitApplied).toBe(false);
    expect(await prisma.sellerBalanceTransaction.count({ where: { orderId: order.id, type: "return" } })).toBe(
      0
    );
    expect(await prisma.transferOperation.count({ where: { storeOrderId: order.id } })).toBe(0);
    const after = await prisma.storeOrder.findUnique({ where: { id: order.id } });
    expect(after?.inventoryRestoredAt).not.toBeNull();
  });

  it("external restock ANOMALY: zero debit/TO; inventory may converge", async () => {
    const { order } = await seedStrictR3({ wrongSellerDebit: true, inventoryRestoredAt: null });
    const beforeDebits = await prisma.sellerBalanceTransaction.count({
      where: { orderId: order.id, type: "return" },
    });
    const branch = await runHistoricalExternalRefundRestockBranch(prisma, order.id);
    expect(branch.handled).toBe(true);
    expect(branch.decision.classification).toBe("HISTORICAL_REFUND_ANOMALY");
    expect(branch.sellerDebitApplied).toBe(false);
    expect(
      await prisma.sellerBalanceTransaction.count({ where: { orderId: order.id, type: "return" } })
    ).toBe(beforeDebits);
    expect(await prisma.transferOperation.count({ where: { storeOrderId: order.id } })).toBe(0);
  });

  it("already-restored inventory: financial skip remains true", async () => {
    const { order } = await seedStrictR3({ inventoryRestoredAt: new Date() });
    expect(await shouldSkipSellerLedgerDebitForHistoricalRefund(prisma, order.id)).toBe(true);
  });

  it("real-PG concurrent restock-branch × prepare on strict R3: no money mutation", async () => {
    const { seller, order, expected } = await seedStrictR3({ inventoryRestoredAt: null });
    const storeReturn = await createStoreReturn(prisma, { orderId: order.id, status: "received" });
    const beforeDebits = await prisma.sellerBalanceTransaction.count({
      where: { orderId: order.id, type: "return" },
    });
    const beforeSales = await prisma.sellerBalanceTransaction.count({
      where: { orderId: order.id, type: "sale" },
    });

    // Exact historical branch used by restockAfterExternalRefund × prepareFoundationReturnSellerSettlement
    // (settlement early-returns on HISTORICALLY_SETTLED before buyer refund).
    const [restockBranch, prepared] = await Promise.all([
      runHistoricalExternalRefundRestockBranch(prisma, order.id),
      prepareFoundationReturnSellerSettlement(prisma, {
        storeOrderId: order.id,
        memberId: seller.id,
        storeReturnId: storeReturn.id,
        originalSaleTransferCents: expected,
        entitlementAmountCents: 0,
        currency: "usd",
      }),
    ]);

    expect(restockBranch.handled).toBe(true);
    expect(restockBranch.sellerDebitApplied).toBe(false);
    expect(prepared.kind).toBe("HISTORICALLY_SETTLED");
    expect(await prisma.transferOperation.count({ where: { storeOrderId: order.id } })).toBe(0);
    expect(
      await prisma.sellerReturnEntitlementOperation.count({ where: { storeOrderId: order.id } })
    ).toBe(0);
    expect(await prisma.refundOperation.count({ where: { storeOrderId: order.id } })).toBe(0);
    expect(
      await prisma.sellerBalanceTransaction.count({ where: { orderId: order.id, type: "return" } })
    ).toBe(beforeDebits);
    expect(
      await prisma.sellerBalanceTransaction.count({ where: { orderId: order.id, type: "sale" } })
    ).toBe(beforeSales);
    const after = await prisma.storeOrder.findUnique({ where: { id: order.id } });
    expect(after?.inventoryRestoredAt).not.toBeNull();
  });

  it("real-PG concurrent restock-branch × prepare on AMBIGUOUS: both fail-closed financially", async () => {
    const { seller, order, expected } = await seedStrictR3({
      noReturnDebit: true,
      inventoryRestoredAt: null,
    });
    const storeReturn = await createStoreReturn(prisma, { orderId: order.id, status: "received" });

    const [restockBranch, prepared] = await Promise.all([
      runHistoricalExternalRefundRestockBranch(prisma, order.id),
      prepareFoundationReturnSellerSettlement(prisma, {
        storeOrderId: order.id,
        memberId: seller.id,
        storeReturnId: storeReturn.id,
        originalSaleTransferCents: expected,
        entitlementAmountCents: 0,
        currency: "usd",
      }),
    ]);

    expect(restockBranch.handled).toBe(true);
    expect(restockBranch.sellerDebitApplied).toBe(false);
    expect(prepared.kind).toBe("HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED");
    expect(await prisma.transferOperation.count({ where: { storeOrderId: order.id } })).toBe(0);
    expect(
      await prisma.sellerBalanceTransaction.count({ where: { orderId: order.id, type: "return" } })
    ).toBe(0);
  });

  it("orphan received + SETTLED prepare: HISTORICALLY_SETTLED", async () => {
    const { seller, order, expected } = await seedStrictR3();
    const storeReturn = await createStoreReturn(prisma, { orderId: order.id, status: "received" });
    const prepared = await prepareFoundationReturnSellerSettlement(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      storeReturnId: storeReturn.id,
      originalSaleTransferCents: expected,
      entitlementAmountCents: 0,
      currency: "usd",
    });
    expect(prepared.kind).toBe("HISTORICALLY_SETTLED");
    const sr = await prisma.storeReturn.findUnique({ where: { id: storeReturn.id } });
    expect(sr?.status).toBe("received");
  });

  it("orphan received + AMBIGUOUS prepare: review-required", async () => {
    const { seller, order, expected } = await seedStrictR3({ noReturnDebit: true });
    const storeReturn = await createStoreReturn(prisma, { orderId: order.id, status: "received" });
    const prepared = await prepareFoundationReturnSellerSettlement(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      storeReturnId: storeReturn.id,
      originalSaleTransferCents: expected,
      entitlementAmountCents: 0,
      currency: "usd",
    });
    expect(prepared.kind).toBe("HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED");
    const sr = await prisma.storeReturn.findUnique({ where: { id: storeReturn.id } });
    expect(sr?.status).toBe("received");
  });

  it("payout recovery where excludes refunded R3", async () => {
    const { order } = await seedStrictR3();
    const hits = await prisma.storeOrder.findMany({
      where: { AND: [foundationSellerPayoutRecoveryWhere(), { id: order.id }] },
      select: { id: true },
    });
    expect(hits).toEqual([]);
  });

  it("NOT_HISTORICAL (no legacy transfer id): prepare continues ordinary path (may create lockout TO)", async () => {
    const seller = await createMember(prisma, "hrc-nh");
    const buyer = await createMember(prisma, "hrc-nh-b");
    const order = await prisma.storeOrder.create({
      data: {
        buyerId: buyer.id,
        sellerId: seller.id,
        totalCents: 1000,
        subtotalCents: 1000,
        platformFeeCents: 0,
        salesTaxReserveCents: 10,
        status: "paid",
        stripeSellerTransferId: null,
        commerceStatus: "FINALIZED",
      },
    });
    const storeReturn = await createStoreReturn(prisma, { orderId: order.id, status: "received" });
    const prepared = await prepareFoundationReturnSellerSettlement(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      storeReturnId: storeReturn.id,
      originalSaleTransferCents: 990,
      entitlementAmountCents: 0,
      currency: "usd",
    });
    expect(prepared.kind).not.toBe("HISTORICALLY_SETTLED");
    expect(prepared.kind).not.toBe("HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED");
  });

  it("prepare R3 + SUCCEEDED TO → REVIEW, zero financial writes", async () => {
    const { seller, order, expected } = await seedStrictR3({ withTransfer: "SUCCEEDED" });
    const storeReturn = await createStoreReturn(prisma, { orderId: order.id, status: "received" });
    const beforeDebits = await prisma.sellerBalanceTransaction.count({
      where: { orderId: order.id, type: "return" },
    });
    const prepared = await prepareFoundationReturnSellerSettlement(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      storeReturnId: storeReturn.id,
      originalSaleTransferCents: expected,
      entitlementAmountCents: 0,
      currency: "usd",
    });
    expect(prepared.kind).toBe("HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED");
    expect(await prisma.transferOperation.count({ where: { storeOrderId: order.id } })).toBe(1);
    expect(
      await prisma.sellerReturnEntitlementOperation.count({ where: { storeOrderId: order.id } })
    ).toBe(0);
    expect(
      await prisma.sellerBalanceTransaction.count({ where: { orderId: order.id, type: "return" } })
    ).toBe(beforeDebits);
  });

  it("prepare R3 + FAILED TO → REVIEW (no entitlement path)", async () => {
    const { seller, order, expected } = await seedStrictR3({ withTransfer: "FAILED" });
    const storeReturn = await createStoreReturn(prisma, { orderId: order.id, status: "received" });
    const prepared = await prepareFoundationReturnSellerSettlement(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      storeReturnId: storeReturn.id,
      originalSaleTransferCents: expected,
      entitlementAmountCents: 0,
      currency: "usd",
    });
    expect(prepared.kind).toBe("HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED");
    expect(
      await prisma.sellerReturnEntitlementOperation.count({ where: { storeOrderId: order.id } })
    ).toBe(0);
  });

  it("prepare R3 + RefundOperation → REVIEW", async () => {
    const { seller, order, expected } = await seedStrictR3({ withRefundOperation: true });
    const storeReturn = await createStoreReturn(prisma, { orderId: order.id, status: "received" });
    const prepared = await prepareFoundationReturnSellerSettlement(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      storeReturnId: storeReturn.id,
      originalSaleTransferCents: expected,
      entitlementAmountCents: 0,
      currency: "usd",
    });
    expect(prepared.kind).toBe("HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED");
  });

  it("prepare R3 + SREO → REVIEW", async () => {
    const { seller, order, expected } = await seedStrictR3({ withEntitlement: true });
    // seed withEntitlement already created a received StoreReturn
    const sr = await prisma.storeReturn.findFirst({ where: { orderId: order.id } });
    expect(sr).toBeTruthy();
    const prepared = await prepareFoundationReturnSellerSettlement(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      storeReturnId: sr!.id,
      originalSaleTransferCents: expected,
      entitlementAmountCents: 0,
      currency: "usd",
    });
    expect(prepared.kind).toBe("HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED");
  });

  it("payout-lock R3 + SUCCEEDED TO → REVIEW, TO unchanged", async () => {
    const { order } = await seedStrictR3({ withTransfer: "SUCCEEDED" });
    const before = await prisma.transferOperation.findUnique({ where: { storeOrderId: order.id } });
    const lock = await lockFoundationPayoutOutForRefund(prisma, { storeOrderId: order.id });
    expect(lock.kind).toBe("HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED");
    const after = await prisma.transferOperation.findUnique({ where: { storeOrderId: order.id } });
    expect(after?.status).toBe(before?.status);
    expect(after?.lastError).toBe(before?.lastError ?? null);
  });

  it("public restock R3 + SUCCEEDED TO: finance blocked, no debit", async () => {
    const { order, expected } = await seedStrictR3({
      withTransfer: "SUCCEEDED",
      inventoryRestoredAt: null,
    });
    const beforeDebits = await prisma.sellerBalanceTransaction.count({
      where: { orderId: order.id, type: "return", amountCents: -expected },
    });
    const stripe = { transfers: { createReversal: async () => { throw new Error("no reverse"); } } };
    await expect(restockAfterExternalRefund(order.id, stripe as never, prisma)).resolves.toBe(true);
    expect(
      await prisma.sellerBalanceTransaction.count({
        where: { orderId: order.id, type: "return", amountCents: -expected },
      })
    ).toBe(beforeDebits);
    const after = await prisma.storeOrder.findUnique({ where: { id: order.id } });
    expect(after?.inventoryRestoredAt).not.toBeNull();
  });

  it("public restock wrong-debit + TO: finance blocked", async () => {
    const { order } = await seedStrictR3({
      wrongDebitAmount: true,
      withTransfer: "SUCCEEDED",
      inventoryRestoredAt: null,
    });
    const beforeDebits = await prisma.sellerBalanceTransaction.count({
      where: { orderId: order.id, type: "return" },
    });
    await expect(restockAfterExternalRefund(order.id, null, prisma)).resolves.toBe(true);
    expect(
      await prisma.sellerBalanceTransaction.count({ where: { orderId: order.id, type: "return" } })
    ).toBe(beforeDebits);
  });

  it("public restock × public settlement concurrency on strict R3", async () => {
    const { seller, order, expected } = await seedStrictR3({ inventoryRestoredAt: null });
    const storeReturn = await createStoreReturn(prisma, {
      orderId: order.id,
      status: "received",
    });
    await prisma.storeReturn.update({
      where: { id: storeReturn.id },
      data: { refundAmountCents: 1000 },
    });
    const beforeDebits = await prisma.sellerBalanceTransaction.count({
      where: { orderId: order.id, type: "return" },
    });
    const beforeSales = await prisma.sellerBalanceTransaction.count({
      where: { orderId: order.id, type: "sale" },
    });
    const stripe = {
      refunds: { create: async () => { throw new Error("no buyer refund"); } },
      transfers: { createReversal: async () => { throw new Error("no reverse"); } },
    };

    const [restocked, settled] = await Promise.all([
      restockAfterExternalRefund(order.id, stripe as never, prisma),
      completeReceivedStoreReturnSettlement({
        stripe: stripe as never,
        storeOrderId: order.id,
        storeReturnId: storeReturn.id,
        memberId: seller.id,
        db: prisma,
      }),
    ]);

    expect(restocked).toBe(true);
    expect(settled.kind).toBe("HISTORICALLY_SETTLED");
    expect(await prisma.transferOperation.count({ where: { storeOrderId: order.id } })).toBe(0);
    expect(
      await prisma.sellerReturnEntitlementOperation.count({ where: { storeOrderId: order.id } })
    ).toBe(0);
    expect(await prisma.refundOperation.count({ where: { storeOrderId: order.id } })).toBe(0);
    expect(
      await prisma.sellerBalanceTransaction.count({ where: { orderId: order.id, type: "return" } })
    ).toBe(beforeDebits);
    expect(
      await prisma.sellerBalanceTransaction.count({ where: { orderId: order.id, type: "sale" } })
    ).toBe(beforeSales);
    expect(beforeDebits).toBe(1);
    const after = await prisma.storeOrder.findUnique({ where: { id: order.id } });
    expect(after?.inventoryRestoredAt).not.toBeNull();
  });

  it("public restock × settlement concurrency on R3 + SUCCEEDED TO → both REVIEW/blocked", async () => {
    const { seller, order, expected } = await seedStrictR3({
      withTransfer: "SUCCEEDED",
      inventoryRestoredAt: null,
    });
    const storeReturn = await createStoreReturn(prisma, {
      orderId: order.id,
      status: "received",
    });
    await prisma.storeReturn.update({
      where: { id: storeReturn.id },
      data: { refundAmountCents: 1000 },
    });
    const beforeDebits = await prisma.sellerBalanceTransaction.count({
      where: { orderId: order.id, type: "return" },
    });
    let reverseCalls = 0;
    const stripe = {
      refunds: { create: async () => { throw new Error("no buyer refund"); } },
      transfers: {
        createReversal: async () => {
          reverseCalls += 1;
          throw new Error("no reverse");
        },
      },
    };

    const [restocked, settled] = await Promise.all([
      restockAfterExternalRefund(order.id, stripe as never, prisma),
      completeReceivedStoreReturnSettlement({
        stripe: stripe as never,
        storeOrderId: order.id,
        storeReturnId: storeReturn.id,
        memberId: seller.id,
        db: prisma,
      }),
    ]);

    expect(restocked).toBe(true);
    expect(settled.kind).toBe("HISTORICAL_COMPATIBILITY_REVIEW_REQUIRED");
    expect(reverseCalls).toBe(0);
    expect(
      await prisma.sellerBalanceTransaction.count({ where: { orderId: order.id, type: "return" } })
    ).toBe(beforeDebits);
    expect(
      await prisma.sellerReturnEntitlementOperation.count({ where: { storeOrderId: order.id } })
    ).toBe(0);
  });

  it("Foundation-native refunded + TO, no return debit → prepare CONTINUES ordinary path", async () => {
    const seller = await createMember(prisma, "hrc-fn");
    const buyer = await createMember(prisma, "hrc-fn-b");
    const expected = reconstructHistoricalSellerTransferCents({
      totalCents: 1000,
      platformFeeCents: 0,
      salesTaxReserveCents: 10,
    });
    const order = await prisma.storeOrder.create({
      data: {
        buyerId: buyer.id,
        sellerId: seller.id,
        totalCents: 1000,
        subtotalCents: 1000,
        platformFeeCents: 0,
        salesTaxReserveCents: 10,
        status: "refunded",
        stripeSellerTransferId: `tr_${nonce()}`,
        stripeRefundId: `re_${nonce()}`,
        refundCompletedAt: new Date(),
        commerceStatus: "FINALIZED",
      },
    });
    await prisma.sellerBalanceTransaction.create({
      data: { memberId: seller.id, type: "sale", amountCents: expected, orderId: order.id },
    });
    await createTransferOperation(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      amountCents: expected,
      status: "SUCCEEDED",
      stripeTransferId: `tr_to_${nonce()}`,
      providerIdempotencyKey: `nwc_store_transfer_${order.id}`,
    });
    const storeReturn = await createStoreReturn(prisma, { orderId: order.id, status: "received" });
    const prepared = await prepareFoundationReturnSellerSettlement(prisma, {
      storeOrderId: order.id,
      memberId: seller.id,
      storeReturnId: storeReturn.id,
      originalSaleTransferCents: expected,
      entitlementAmountCents: 0,
      currency: "usd",
    });
    expect(prepared.kind).toBe("ORIGINAL_TRANSFER_SUCCEEDED");
  });
});
