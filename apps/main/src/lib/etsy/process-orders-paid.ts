import {
  applyEtsyPaidOrderObservation,
  prisma,
  type EtsyJobHandlerResult,
  type EtsyPaidOrderLineObservation,
  type EtsySyncJobClaim,
} from "database";
import { etsyConnectionRequest } from "./connection-request";
import type { EtsyFetch } from "./client";

type ReceiptTransaction = {
  transaction_id?: number | string;
  listing_id?: number | string;
  product_id?: number | string;
  product_data?: { product_id?: number | string };
  quantity?: number;
  sku?: string | null;
};

type ReceiptPayload = {
  receipt_id?: number | string;
  transactions?: ReceiptTransaction[];
};

export function parseEtsyOrderPaidWebhookBody(rawBody: string): {
  shopId: string | null;
  receiptId: string | null;
  resourceUrl: string | null;
} {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return { shopId: null, receiptId: null, resourceUrl: null };
  }
  const shopRaw = parsed.shop_id;
  const shopId =
    typeof shopRaw === "number"
      ? String(shopRaw)
      : typeof shopRaw === "string"
        ? shopRaw.trim()
        : null;
  const receiptRaw = parsed.receipt_id;
  let receiptId =
    typeof receiptRaw === "number"
      ? String(receiptRaw)
      : typeof receiptRaw === "string"
        ? receiptRaw.trim()
        : null;
  const resourceUrl =
    typeof parsed.resource_url === "string" ? parsed.resource_url.trim() : null;
  if (!receiptId && resourceUrl) {
    const match = /\/receipts\/(\d+)/i.exec(resourceUrl);
    if (match) receiptId = match[1]!;
  }
  return { shopId, receiptId, resourceUrl };
}

function classifyFailure(
  apiClass: string,
  retryAfterMs: number | null
): Extract<EtsyJobHandlerResult, { outcome: "RETRY" | "DEAD" }> {
  if (apiClass === "THROTTLED" || apiClass === "TRANSIENT" || apiClass === "NETWORK") {
    return {
      outcome: "RETRY",
      errorClass: apiClass,
      errorCode: apiClass,
      errorMessage: `Etsy provider ${apiClass}`,
      retryAt: retryAfterMs != null ? new Date(Date.now() + retryAfterMs) : undefined,
    };
  }
  if (apiClass === "AUTH" || apiClass === "CONNECTION_INACTIVE" || apiClass === "NOT_CONFIGURED") {
    return {
      outcome: "DEAD",
      errorClass: apiClass,
      errorCode: apiClass,
      errorMessage: `Etsy authorization unavailable (${apiClass})`,
    };
  }
  return {
    outcome: "DEAD",
    errorClass: apiClass || "PERMANENT",
    errorCode: apiClass || "PROVIDER_ERROR",
    errorMessage: "Etsy receipt read failed permanently",
  };
}

/**
 * order.paid evidence branch: fetch receipt transactions, apply exactly-once Foundation SALE.
 */
export async function handleEtsyOrderPaidEvidence(input: {
  claim: EtsySyncJobClaim;
  evidenceId: string;
  connectionId: string;
  memberId: string;
  shopId: string;
  rawBody: string;
  triggeredAt: Date;
  fetchImpl?: EtsyFetch;
  now?: Date;
}): Promise<EtsyJobHandlerResult> {
  const parsed = parseEtsyOrderPaidWebhookBody(input.rawBody);
  if (!parsed.receiptId || !/^\d+$/.test(parsed.receiptId)) {
    await prisma.etsyProviderEvidence.update({
      where: { id: input.evidenceId },
      data: {
        processState: "ERROR",
        processedAt: new Date(),
        lastErrorCode: "MISSING_RECEIPT_ID",
        lastErrorMessage: "order.paid evidence lacked a durable receipt id",
      },
    });
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "MISSING_RECEIPT_ID",
      errorMessage: "order.paid evidence lacked a durable receipt id",
    };
  }

  const receiptRes = await etsyConnectionRequest<ReceiptPayload>({
    connectionId: input.connectionId,
    memberId: input.memberId,
    method: "GET",
    path: `/shops/${encodeURIComponent(input.shopId)}/receipts/${encodeURIComponent(parsed.receiptId)}`,
    query: { includes: "Transactions" },
    maxAttempts: 3,
    fetchImpl: input.fetchImpl,
    now: input.now,
  });
  if (!receiptRes.ok || !receiptRes.data) {
    return classifyFailure(receiptRes.class, receiptRes.retryAfterMs);
  }

  const receiptId = String(receiptRes.data.receipt_id ?? parsed.receiptId);
  const transactions = Array.isArray(receiptRes.data.transactions)
    ? receiptRes.data.transactions
    : [];
  const lines: EtsyPaidOrderLineObservation[] = [];
  for (const tx of transactions) {
    const transactionId = String(tx.transaction_id ?? "").trim();
    if (!/^\d+$/.test(transactionId)) continue;
    const qty = typeof tx.quantity === "number" ? Math.trunc(tx.quantity) : NaN;
    if (!Number.isFinite(qty) || qty < 1) continue;
    const listingId =
      tx.listing_id != null && /^\d+$/.test(String(tx.listing_id)) ? String(tx.listing_id) : null;
    const productIdRaw = tx.product_id ?? tx.product_data?.product_id;
    const productId =
      productIdRaw != null && /^\d+$/.test(String(productIdRaw)) ? String(productIdRaw) : null;
    lines.push({
      etsyReceiptId: receiptId,
      etsyTransactionId: transactionId,
      etsyListingId: listingId,
      etsyProductId: productId,
      etsyOfferingId: null,
      paidQuantity: qty,
      triggeredAt: input.triggeredAt,
    });
  }

  if (lines.length === 0) {
    await prisma.etsyProviderEvidence.update({
      where: { id: input.evidenceId },
      data: {
        processState: "IGNORED",
        processedAt: new Date(),
        lastErrorCode: "NO_TRANSACTIONS",
        lastErrorMessage: "Receipt contained no durable paid transactions",
      },
    });
    return { outcome: "SUCCESS" };
  }

  await applyEtsyPaidOrderObservation(prisma, {
    connectionId: input.connectionId,
    memberId: input.memberId,
    evidenceId: input.evidenceId,
    lines,
  });

  await prisma.etsyProviderEvidence.update({
    where: { id: input.evidenceId },
    data: {
      processState: "PROCESSED",
      processedAt: new Date(),
      lastErrorCode: null,
      lastErrorMessage: null,
    },
  });
  return { outcome: "SUCCESS" };
}
