import {
  ETSY_ORDER_WEBHOOK_TOPICS,
  normalizeEtsyWebhookTopic,
  prisma,
  type EtsyJobHandlerResult,
  type EtsySyncJobClaim,
} from "database";
import { handleEtsyOrderPaidEvidence } from "./process-orders-paid";
import type { EtsyFetch } from "./client";

/**
 * Evidence processor: validate stored webhook evidence and apply order.paid sales (E7).
 * Other order topics are acknowledged without inventory mutation until later stages.
 */
export async function handleEtsyProcessProviderEvidenceJob(
  claim: EtsySyncJobClaim,
  deps: { fetchImpl?: EtsyFetch; now?: Date } = {}
): Promise<EtsyJobHandlerResult> {
  if (!claim.evidenceId) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "MISSING_EVIDENCE",
      errorMessage: "PROCESS_PROVIDER_EVIDENCE job has no evidence id",
    };
  }

  const evidence = await prisma.etsyProviderEvidence.findUnique({
    where: { id: claim.evidenceId },
  });
  if (!evidence) {
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "EVIDENCE_NOT_FOUND",
      errorMessage: "Provider evidence row was not found",
    };
  }

  if (evidence.processState === "PROCESSED" || evidence.processState === "IGNORED") {
    return { outcome: "SUCCESS" };
  }

  const topic = normalizeEtsyWebhookTopic(evidence.topic);
  if (!ETSY_ORDER_WEBHOOK_TOPICS.has(topic)) {
    await prisma.etsyProviderEvidence.update({
      where: { id: evidence.id },
      data: {
        processState: "ERROR",
        processedAt: new Date(),
        lastErrorCode: "UNSUPPORTED_TOPIC",
        lastErrorMessage: `Unsupported topic ${topic}`,
      },
    });
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "UNSUPPORTED_TOPIC",
      errorMessage: `Unsupported topic ${topic}`,
    };
  }

  let parsed: { shop_id?: unknown };
  try {
    parsed = JSON.parse(evidence.rawBody) as typeof parsed;
  } catch {
    await prisma.etsyProviderEvidence.update({
      where: { id: evidence.id },
      data: {
        processState: "ERROR",
        processedAt: new Date(),
        lastErrorCode: "MALFORMED_JSON",
        lastErrorMessage: "Webhook body was not valid JSON",
      },
    });
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "MALFORMED_JSON",
      errorMessage: "Webhook body was not valid JSON",
    };
  }

  const shopIdRaw = parsed.shop_id;
  const shopId =
    typeof shopIdRaw === "number"
      ? String(shopIdRaw)
      : typeof shopIdRaw === "string"
        ? shopIdRaw.trim()
        : "";
  if (shopId && shopId !== evidence.shopId) {
    await prisma.etsyProviderEvidence.update({
      where: { id: evidence.id },
      data: {
        processState: "ERROR",
        processedAt: new Date(),
        lastErrorCode: "SHOP_MISMATCH",
        lastErrorMessage: "Payload shop_id did not match evidence shop id",
      },
    });
    return {
      outcome: "DEAD",
      errorClass: "PERMANENT",
      errorCode: "SHOP_MISMATCH",
      errorMessage: "Payload shop_id did not match evidence shop id",
    };
  }

  if (topic === "order.paid") {
    if (!evidence.etsyConnectionId) {
      await prisma.etsyProviderEvidence.update({
        where: { id: evidence.id },
        data: {
          processState: "IGNORED",
          processedAt: new Date(),
          lastErrorCode: "NO_CONNECTION",
          lastErrorMessage: "No Etsy connection generation bound for this evidence",
        },
      });
      return { outcome: "SUCCESS" };
    }
    const connection = await prisma.etsyConnection.findUnique({
      where: { id: evidence.etsyConnectionId },
    });
    if (!connection) {
      await prisma.etsyProviderEvidence.update({
        where: { id: evidence.id },
        data: {
          processState: "ERROR",
          processedAt: new Date(),
          lastErrorCode: "CONNECTION_MISSING",
          lastErrorMessage: "Bound Etsy connection generation was not found",
        },
      });
      return {
        outcome: "DEAD",
        errorClass: "PERMANENT",
        errorCode: "CONNECTION_MISSING",
        errorMessage: "Bound Etsy connection generation was not found",
      };
    }

    return handleEtsyOrderPaidEvidence({
      claim,
      evidenceId: evidence.id,
      connectionId: connection.id,
      memberId: connection.memberId,
      shopId: connection.shopId,
      rawBody: evidence.rawBody,
      triggeredAt: evidence.triggeredAt,
      fetchImpl: deps.fetchImpl,
      now: deps.now,
    });
  }

  // order.canceled / shipped / delivered — acknowledge only until later stages.
  await prisma.etsyProviderEvidence.update({
    where: { id: evidence.id },
    data: {
      processState: "PROCESSED",
      processedAt: new Date(),
      lastErrorCode: null,
      lastErrorMessage: null,
    },
  });

  return { outcome: "SUCCESS" };
}
