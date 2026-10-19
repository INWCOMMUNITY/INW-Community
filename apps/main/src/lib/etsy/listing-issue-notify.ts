import { etsyListingIssueDedupeKey, prisma } from "database";
import { logSellerActivityOnce } from "@/lib/seller-activity-log";
import { sendPushNotification } from "@/lib/send-push-notification";
import { isEtsyListingBusyConflict } from "./errors";

/**
 * Persist one seller-visible Etsy listing issue + optional push.
 * Works for mapped links and unmapped CREATE_LISTING failures (subjectId = create-job:…).
 */
export async function notifyEtsyListingIssueOnce(input: {
  memberId: string;
  storeItemId: string;
  connectionId: string;
  /** listingLinkId, or create-job:<jobId> when not yet mapped. */
  subjectId: string;
  issueCode: string;
  issueFingerprint: string;
  severity: string;
  message: string;
}): Promise<{ created: boolean }> {
  if (input.severity !== "ACTION_REQUIRED" && input.severity !== "WARNING") {
    return { created: false };
  }

  const dedupeKey = etsyListingIssueDedupeKey({
    connectionId: input.connectionId,
    subjectId: input.subjectId,
    issueCode: input.issueCode,
    issueFingerprint: input.issueFingerprint,
  });

  const item = await prisma.storeItem.findUnique({
    where: { id: input.storeItemId },
    select: { title: true },
  });
  const title = item?.title?.trim() || "your listing";

  const created = await logSellerActivityOnce({
    memberId: input.memberId,
    action: "sync_error",
    entityType: "store_item",
    entityId: input.storeItemId,
    dedupeKey,
    detail: {
      provider: "etsy",
      severity: input.severity,
      issueCode: input.issueCode,
      issueFingerprint: input.issueFingerprint,
      subjectId: input.subjectId,
      errorMessage: input.message,
      itemTitles: [title],
    },
    metadata: { source: "cron" },
  });

  if (created) {
    await sendPushNotification(input.memberId, {
      category: "seller_ops",
      title: "Etsy listing needs attention",
      body: input.message.includes(title) ? input.message : `${title}: ${input.message}`,
      data: {
        screen: "seller-hub-etsy",
        storeItemId: input.storeItemId,
        subjectId: input.subjectId,
        issueCode: input.issueCode,
      },
    });
  }

  return { created };
}

const ETSY_REAUTH_MESSAGE = "Etsy needs to be reconnected before listing sync can continue.";

/** One seller alert when Etsy refresh can no longer keep the shop connected. */
export async function notifyEtsyReauthorizationRequired(input: {
  connectionId: string;
  memberId: string;
  message?: string;
}): Promise<{ created: boolean }> {
  const message = (input.message || ETSY_REAUTH_MESSAGE).slice(0, 2000);
  const link = await prisma.etsyListingLink.findFirst({
    where: { etsyConnectionId: input.connectionId, memberId: input.memberId },
    select: { storeItemId: true },
    orderBy: { updatedAt: "desc" },
  });
  if (link) {
    return notifyEtsyListingIssueOnce({
      memberId: input.memberId,
      storeItemId: link.storeItemId,
      connectionId: input.connectionId,
      subjectId: `connection:${input.connectionId}`,
      issueCode: "ETSY_REAUTHORIZATION_REQUIRED",
      issueFingerprint: "reauthorization",
      severity: "ACTION_REQUIRED",
      message,
    });
  }
  return notifyEtsyConnectionSyncFailure({
    memberId: input.memberId,
    connectionId: input.connectionId,
    subjectId: `connection:${input.connectionId}`,
    issueCode: "ETSY_REAUTHORIZATION_REQUIRED",
    issueFingerprint: "reauthorization",
    message,
    title: "Etsy needs to be reconnected",
  });
}

async function notifyEtsyConnectionSyncFailure(input: {
  memberId: string;
  connectionId: string;
  subjectId: string;
  issueCode: string;
  issueFingerprint: string;
  message: string;
  title: string;
}): Promise<{ created: boolean }> {
  const dedupeKey = etsyListingIssueDedupeKey({
    connectionId: input.connectionId,
    subjectId: input.subjectId,
    issueCode: input.issueCode,
    issueFingerprint: input.issueFingerprint,
  });
  const created = await logSellerActivityOnce({
    memberId: input.memberId,
    action: "sync_error",
    entityType: "channel_link",
    entityId: input.connectionId,
    dedupeKey,
    detail: {
      provider: "etsy",
      severity: "ACTION_REQUIRED",
      issueCode: input.issueCode,
      subjectId: input.subjectId,
      errorMessage: input.message,
    },
    metadata: { source: "cron" },
  });
  if (created) {
    await sendPushNotification(input.memberId, {
      category: "seller_ops",
      title: input.title,
      body: input.message,
      data: {
        screen: "seller-hub-etsy",
        subjectId: input.subjectId,
        issueCode: input.issueCode,
      },
    });
  }
  return { created };
}

function storeItemIdFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const id = (payload as { storeItemId?: unknown }).storeItemId;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

/** After a sync job is finalized DEAD — notify even when no Etsy listing link exists yet. */
export async function notifyEtsySyncJobDeadOnce(input: {
  claim: {
    id: string;
    etsyConnectionId: string;
    kind: string;
    payload: unknown;
  };
  result: {
    errorClass: string;
    errorCode?: string;
    errorMessage?: string;
  };
}): Promise<{ created: boolean }> {
  const storeItemId = storeItemIdFromPayload(input.claim.payload);
  const connectionLevelKind =
    input.claim.kind === "POLL_LISTING_CONTENT" ||
    input.claim.kind === "PROCESS_PROVIDER_EVIDENCE" ||
    input.claim.kind === "IMPORT_BATCH";
  if (!storeItemId && !connectionLevelKind) return { created: false };

  const connection = await prisma.etsyConnection.findUnique({
    where: { id: input.claim.etsyConnectionId },
    select: { id: true, memberId: true },
  });
  if (!connection) return { created: false };

  const issueCode = (input.result.errorCode || input.result.errorClass || "ETSY_SYNC_FAILED").slice(
    0,
    64
  );
  const message = (
    input.result.errorMessage ||
    `Etsy ${input.claim.kind.replace(/_/g, " ").toLowerCase()} failed`
  ).slice(0, 2000);

  // Internal Etsy write lock / batch continue — jobs retry; never surface to sellers.
  if (
    isEtsyListingBusyConflict(message) ||
    input.result.errorCode === "IMPORT_BATCH_CONTINUE" ||
    input.result.errorClass === "TRANSIENT" ||
    input.result.errorClass === "THROTTLED" ||
    input.result.errorClass === "NETWORK"
  ) {
    return { created: false };
  }

  if (input.claim.kind === "POLL_LISTING_CONTENT") {
    const authFailure =
      input.result.errorClass === "AUTH" ||
      input.result.errorClass === "CONNECTION_INACTIVE" ||
      input.result.errorClass === "NOT_CONFIGURED";
    if (!authFailure) return { created: false };
  }

  if (!storeItemId) {
    const title =
      input.claim.kind === "IMPORT_BATCH"
        ? "Etsy import stopped"
        : input.claim.kind === "PROCESS_PROVIDER_EVIDENCE"
          ? "Etsy order sync stopped"
          : "Etsy listing sync stopped";
    return notifyEtsyConnectionSyncFailure({
      memberId: connection.memberId,
      connectionId: connection.id,
      subjectId: `job:${input.claim.id}`,
      issueCode,
      issueFingerprint: `${input.claim.kind}:${issueCode}:${message}`.slice(0, 200),
      message,
      title,
    });
  }

  const link = await prisma.etsyListingLink.findUnique({
    where: {
      etsyConnectionId_storeItemId: {
        etsyConnectionId: connection.id,
        storeItemId,
      },
    },
    select: { id: true },
  });

  if (link) {
    const isContent = input.claim.kind === "UPDATE_LISTING_CONTENT";
    const isInventory = input.claim.kind === "PROJECT_INVENTORY";
    if (isContent || isInventory) {
      await prisma.etsyListingLink.update({
        where: { id: link.id },
        data: {
          readiness: "ACTION_REQUIRED",
          ...(isContent ? { contentHealth: "DEGRADED" as const } : {}),
          ...(isInventory ? { inventoryHealth: "DEGRADED" as const } : {}),
          issueCode: isContent ? "CONTENT_UPDATE_FAILED" : "INVENTORY_UPDATE_FAILED",
          issueMessage: message,
        },
      });
    }
  }

  const subjectId = link?.id ?? `create-job:${input.claim.id}`;
  const fingerprint = `${input.claim.kind}:${issueCode}:${message}`.slice(0, 200);

  return notifyEtsyListingIssueOnce({
    memberId: connection.memberId,
    storeItemId,
    connectionId: connection.id,
    subjectId,
    issueCode,
    issueFingerprint: fingerprint,
    severity: "ACTION_REQUIRED",
    message,
  });
}
