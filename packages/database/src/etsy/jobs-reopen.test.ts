import { describe, expect, it } from "vitest";
import { hashEtsyJobPayload, reopenEtsySyncJob, EtsySyncJobConflictError } from "./jobs";

function finishedJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    etsyConnectionId: "conn-1",
    kind: "CREATE_LISTING",
    dedupeKey: "CREATE_LISTING:conn-1:item-1",
    evidenceId: null,
    payload: { storeItemId: "item-1", storeVariantId: "old" },
    payloadHash: "old-hash",
    state: "SUCCEEDED",
    attemptCount: 3,
    maxAttempts: 8,
    nextAttemptAt: new Date("2026-01-01T00:00:00Z"),
    completedAt: new Date("2026-01-01T00:00:00Z"),
    leaseOwner: null,
    leaseToken: null,
    leaseExpiresAt: null,
    lastErrorClass: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    ...overrides,
  };
}

function dbFor(existing: ReturnType<typeof finishedJob> | null) {
  const updates: unknown[] = [];
  const creates: unknown[] = [];
  const db = {
    etsySyncJob: {
      findUnique: async () => existing,
      update: async (args: { data: Record<string, unknown> }) => {
        updates.push(args.data);
        return { ...(existing ?? {}), ...args.data, id: existing?.id ?? "created" };
      },
      create: async (args: { data: Record<string, unknown> }) => {
        creates.push(args.data);
        return { id: "created", ...args.data, state: "PENDING" };
      },
    },
  };
  return { db, updates, creates };
}

const input = {
  etsyConnectionId: "conn-1",
  kind: "CREATE_LISTING" as const,
  dedupeKey: "CREATE_LISTING:conn-1:item-1",
  payload: { storeItemId: "item-1", storeVariantId: "var-new", storeVariantIds: ["var-new"] },
};

describe("reopenEtsySyncJob", () => {
  it("replaces a finished job when the relist payload differs", async () => {
    const { db, updates } = dbFor(finishedJob());
    const job = await reopenEtsySyncJob(db as never, input);
    expect(job.state).toBe("PENDING");
    expect(updates[0]).toMatchObject({
      state: "PENDING",
      attemptCount: 0,
      payloadHash: hashEtsyJobPayload(input.payload),
      completedAt: null,
      lastErrorMessage: null,
    });
  });

  it("replaces an expired running lease", async () => {
    const { db } = dbFor(
      finishedJob({
        state: "RUNNING",
        leaseExpiresAt: new Date(Date.now() - 60_000),
      })
    );
    const job = await reopenEtsySyncJob(db as never, input);
    expect(job.state).toBe("PENDING");
  });

  it("keeps a live running lease in conflict", async () => {
    const { db } = dbFor(
      finishedJob({
        state: "RUNNING",
        leaseExpiresAt: new Date(Date.now() + 60_000),
      })
    );
    await expect(reopenEtsySyncJob(db as never, input)).rejects.toBeInstanceOf(EtsySyncJobConflictError);
  });
});
