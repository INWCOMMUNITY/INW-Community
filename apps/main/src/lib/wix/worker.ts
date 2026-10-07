import {
  claimNextWixSyncJob,
  completeWixSyncJobDead,
  completeWixSyncJobRetry,
  completeWixSyncJobSuccess,
  prisma,
  recordWixDeadJobIssue,
  type WixJobHandlerResult,
  type WixSyncJobClaim,
} from "database";
import { handleWixCreateListingJob } from "./create-listing";
import { handleWixUpdateListingContentJob } from "./update-listing-content";
import { handleWixProjectInventoryJob } from "./project-inventory";
import { handleWixProcessProviderEvidenceJob } from "./process-provider-evidence";
import { handleWixReconcileListingJob } from "./reconcile-listing";
import { handleWixPollListingContentJob } from "./poll-listing-content";

export type WixJobHandler = (claim: WixSyncJobClaim) => Promise<WixJobHandlerResult>;

const DEFAULT_HANDLERS: Record<string, WixJobHandler> = {
  PROCESS_PROVIDER_EVIDENCE: handleWixProcessProviderEvidenceJob,
  UPDATE_LISTING_CONTENT: handleWixUpdateListingContentJob,
  PROJECT_INVENTORY: handleWixProjectInventoryJob,
  CREATE_LISTING: handleWixCreateListingJob,
  RECONCILE_LISTING: handleWixReconcileListingJob,
  POLL_LISTING_CONTENT: handleWixPollListingContentJob,
};

/**
 * Claim one due Wix sync job and run its handler.
 * No network calls in the claim transaction; handlers may call Wix later stages.
 */
export async function runNextWixSyncJob(input?: {
  workerId?: string;
  handlers?: Partial<Record<string, WixJobHandler>>;
  leaseMs?: number;
  now?: Date;
}): Promise<
  | { claimed: false }
  | { claimed: true; jobId: string; finalized: boolean; result: WixJobHandlerResult }
> {
  const workerId = input?.workerId ?? `wix-worker-${Math.random().toString(16).slice(2, 10)}`;
  const claim = await claimNextWixSyncJob(prisma, {
    workerId,
    leaseMs: input?.leaseMs,
    now: input?.now,
  });
  if (!claim) return { claimed: false };

  const handlers = { ...DEFAULT_HANDLERS, ...input?.handlers };
  const handler = handlers[claim.kind];
  let result: WixJobHandlerResult;
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
    finalized = await completeWixSyncJobSuccess(prisma, claim, input?.now);
  } else if (result.outcome === "RETRY") {
    finalized = await completeWixSyncJobRetry(prisma, claim, result, input?.now);
  } else {
    finalized = await completeWixSyncJobDead(prisma, claim, result, input?.now);
    if (
      claim.kind === "UPDATE_LISTING_CONTENT" ||
      claim.kind === "PROJECT_INVENTORY" ||
      claim.kind === "CREATE_LISTING" ||
      claim.kind === "RECONCILE_LISTING"
    ) {
      const payload = claim.payload as { listingLinkId?: string; storeItemId?: string } | null;
      await recordWixDeadJobIssue(prisma, {
        wixConnectionId: claim.wixConnectionId,
        listingLinkId: payload?.listingLinkId,
        storeItemId: payload?.storeItemId,
        errorCode: result.errorCode ?? result.errorClass,
        errorMessage: result.errorMessage,
      });
    }
  }

  return { claimed: true, jobId: claim.id, finalized, result };
}

/**
 * Drain pending Wix sync jobs up to a limit.
 */
export async function drainWixSyncJobs(options?: {
  maxJobs?: number;
  workerId?: string;
}): Promise<{ processed: number; results: Array<{ jobId: string; outcome: string }> }> {
  const maxJobs = options?.maxJobs ?? 100;
  const workerId = options?.workerId ?? `wix-drain-${Date.now()}`;
  const results: Array<{ jobId: string; outcome: string }> = [];

  for (let i = 0; i < maxJobs; i++) {
    const jobResult = await runNextWixSyncJob({ workerId });
    if (!jobResult.claimed) break;
    results.push({
      jobId: jobResult.jobId,
      outcome: jobResult.result.outcome,
    });
  }

  return { processed: results.length, results };
}
