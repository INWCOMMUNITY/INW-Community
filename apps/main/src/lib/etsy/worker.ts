import {
  claimNextEtsySyncJob,
  completeEtsySyncJobDead,
  completeEtsySyncJobRetry,
  completeEtsySyncJobSuccess,
  prisma,
  type EtsyJobHandlerResult,
  type EtsySyncJobClaim,
} from "database";
import { handleEtsyCreateListingJob } from "./create-listing";
import { handleEtsyProcessProviderEvidenceJob } from "./process-provider-evidence";
import { handleEtsyPollListingContentJob } from "./poll-listing-content";
import { handleEtsyProjectInventoryJob } from "./project-inventory";
import { handleEtsyReconcileListingJob } from "./reconcile-listing";
import { handleEtsyUpdateListingContentJob } from "./update-listing-content";
import { notifyEtsySyncJobDeadOnce } from "./listing-issue-notify";

export type EtsyJobHandler = (claim: EtsySyncJobClaim) => Promise<EtsyJobHandlerResult>;

const DEFAULT_HANDLERS: Record<string, EtsyJobHandler> = {
  PROCESS_PROVIDER_EVIDENCE: handleEtsyProcessProviderEvidenceJob,
  UPDATE_LISTING_CONTENT: handleEtsyUpdateListingContentJob,
  POLL_LISTING_CONTENT: handleEtsyPollListingContentJob,
  PROJECT_INVENTORY: handleEtsyProjectInventoryJob,
  RECONCILE_LISTING: handleEtsyReconcileListingJob,
  CREATE_LISTING: handleEtsyCreateListingJob,
};

/**
 * Claim one due Etsy sync job and run its handler.
 * No network calls in the claim transaction; handlers may call Etsy later stages.
 */
export async function runNextEtsySyncJob(input?: {
  workerId?: string;
  handlers?: Partial<Record<string, EtsyJobHandler>>;
  leaseMs?: number;
  now?: Date;
}): Promise<
  | { claimed: false }
  | { claimed: true; jobId: string; finalized: boolean; result: EtsyJobHandlerResult }
> {
  const workerId = input?.workerId ?? `etsy-worker-${Math.random().toString(16).slice(2, 10)}`;
  const claim = await claimNextEtsySyncJob(prisma, {
    workerId,
    leaseMs: input?.leaseMs,
    now: input?.now,
  });
  if (!claim) return { claimed: false };

  const handlers = { ...DEFAULT_HANDLERS, ...input?.handlers };
  const handler = handlers[claim.kind];
  let result: EtsyJobHandlerResult;
  try {
    if (!handler) {
      result = {
        outcome: "DEAD",
        errorClass: "PERMANENT",
        errorCode: "UNKNOWN_KIND",
        errorMessage: `No handler for ${claim.kind}`,
      };
    } else {
      result = await handler(claim);
    }
  } catch (error) {
    result = {
      outcome: "RETRY",
      errorClass: "TRANSIENT",
      errorCode: "HANDLER_THROW",
      errorMessage: error instanceof Error ? error.message.slice(0, 500) : "handler failed",
    };
  }

  let finalized = false;
  if (result.outcome === "SUCCESS") {
    finalized = await completeEtsySyncJobSuccess(prisma, claim, input?.now);
  } else if (result.outcome === "RETRY") {
    finalized = await completeEtsySyncJobRetry(prisma, claim, result, input?.now);
    // Max-attempts exhaustion finalizes as DEAD inside completeEtsySyncJobRetry.
    if (finalized) {
      const refreshed = await prisma.etsySyncJob.findUnique({
        where: { id: claim.id },
        select: { state: true, lastErrorClass: true, lastErrorCode: true, lastErrorMessage: true },
      });
      if (refreshed?.state === "DEAD") {
        await notifyEtsySyncJobDeadOnce({
          claim,
          result: {
            errorClass: refreshed.lastErrorClass ?? result.errorClass,
            errorCode: refreshed.lastErrorCode ?? result.errorCode ?? undefined,
            errorMessage: refreshed.lastErrorMessage ?? result.errorMessage,
          },
        }).catch(() => undefined);
      }
    }
  } else {
    finalized = await completeEtsySyncJobDead(prisma, claim, result, input?.now);
    if (finalized) {
      await notifyEtsySyncJobDeadOnce({ claim, result }).catch(() => undefined);
    }
  }

  return { claimed: true, jobId: claim.id, finalized, result };
}
