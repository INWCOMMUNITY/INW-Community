import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("database", () => ({
  prisma: {
    etsyConnection: { findFirst: vi.fn() },
    etsyImportBatch: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
  enqueueEtsySyncJob: vi.fn(),
  findActiveEtsyImportBatch: vi.fn(),
  etsyImportBatchDedupeKey: (connectionId: string, batchId: string) =>
    `IMPORT_BATCH:${connectionId}:${batchId}`,
  etsyImportBatchProgressView: (batch: { id: string; state: string }) => ({
    id: batch.id,
    state: batch.state,
  }),
  parseEtsyImportBatchQueue: (raw: unknown) =>
    Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [],
  appendEtsyImportBatchFailures: (_existing: unknown, next: unknown[]) => next,
  nextEtsyImportBatchAvgItemMs: () => 10_000,
  resolveEtsyImportStockMode: () => "PHYSICAL" as const,
}));

vi.mock("./import-discovery", () => ({
  discoverEtsyImportCandidates: vi.fn(),
}));

vi.mock("./import-listing", () => ({
  importEtsyListing: vi.fn(),
}));

import {
  enqueueEtsySyncJob,
  findActiveEtsyImportBatch,
  prisma,
} from "database";
import { discoverEtsyImportCandidates } from "./import-discovery";
import { importEtsyListing } from "./import-listing";
import {
  handleEtsyImportBatchJob,
  startEtsyImportBatch,
} from "./import-batch";

describe("startEtsyImportBatch", () => {
  beforeEach(() => {
    vi.mocked(prisma.etsyConnection.findFirst).mockReset();
    vi.mocked(findActiveEtsyImportBatch).mockReset();
    vi.mocked(prisma.etsyImportBatch.create).mockReset();
    vi.mocked(enqueueEtsySyncJob).mockReset();
  });

  it("rejects without an active Etsy connection", async () => {
    vi.mocked(prisma.etsyConnection.findFirst).mockResolvedValue(null);
    const result = await startEtsyImportBatch({ memberId: "m1" });
    expect(result).toMatchObject({
      status: "ERROR",
      code: "CONNECTION_REQUIRED",
      httpStatus: 409,
    });
  });

  it("returns ALREADY_RUNNING when a batch is active", async () => {
    vi.mocked(prisma.etsyConnection.findFirst).mockResolvedValue({ id: "conn-1" } as never);
    vi.mocked(findActiveEtsyImportBatch).mockResolvedValue({
      id: "batch-live",
      state: "RUNNING",
    } as never);
    const result = await startEtsyImportBatch({ memberId: "m1" });
    expect(result.status).toBe("ALREADY_RUNNING");
    expect(enqueueEtsySyncJob).not.toHaveBeenCalled();
  });

  it("creates a batch and enqueues IMPORT_BATCH", async () => {
    vi.mocked(prisma.etsyConnection.findFirst).mockResolvedValue({ id: "conn-1" } as never);
    vi.mocked(findActiveEtsyImportBatch).mockResolvedValue(null);
    vi.mocked(prisma.etsyImportBatch.create).mockResolvedValue({
      id: "batch-1",
      state: "PENDING",
      etsyConnectionId: "conn-1",
    } as never);
    vi.mocked(enqueueEtsySyncJob).mockResolvedValue({ id: "job-1" } as never);

    const result = await startEtsyImportBatch({
      memberId: "m1",
      stockModePolicy: "PHYSICAL",
    });
    expect(result.status).toBe("STARTED");
    expect(enqueueEtsySyncJob).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        kind: "IMPORT_BATCH",
        dedupeKey: "IMPORT_BATCH:conn-1:batch-1",
        payload: { batchId: "batch-1" },
      })
    );
  });
});

describe("handleEtsyImportBatchJob", () => {
  const claim = {
    id: "job-1",
    etsyConnectionId: "conn-1",
    kind: "IMPORT_BATCH" as const,
    dedupeKey: "IMPORT_BATCH:conn-1:batch-1",
    evidenceId: null,
    payload: { batchId: "batch-1" },
    payloadHash: null,
    state: "RUNNING" as const,
    attemptCount: 1,
    maxAttempts: 10_000,
    leaseOwner: "w1",
    leaseToken: "t1",
    leaseExpiresAt: new Date(),
  };

  beforeEach(() => {
    vi.mocked(prisma.etsyImportBatch.findUnique).mockReset();
    vi.mocked(prisma.etsyImportBatch.update).mockReset();
    vi.mocked(discoverEtsyImportCandidates).mockReset();
    vi.mocked(importEtsyListing).mockReset();
    vi.mocked(prisma.etsyImportBatch.update).mockResolvedValue({} as never);
  });

  it("imports queued listings and completes when the queue drains", async () => {
    vi.mocked(prisma.etsyImportBatch.findUnique).mockResolvedValue({
      id: "batch-1",
      etsyConnectionId: "conn-1",
      memberId: "m1",
      state: "RUNNING",
      stockModePolicy: "PHYSICAL",
      total: 2,
      completed: 0,
      failed: 0,
      skipped: 0,
      discoverOffset: 25,
      discoverComplete: true,
      queueJson: ["111", "222"],
      failuresJson: [],
      avgItemMs: null,
      startedAt: new Date(),
      cancelRequested: false,
    } as never);
    vi.mocked(importEtsyListing)
      .mockResolvedValueOnce({
        status: "IMPORTED",
        storeItemId: "item-1",
        listingLinkId: "link-1",
        etsyListingId: "111",
      })
      .mockResolvedValueOnce({
        status: "ALREADY_IMPORTED",
        storeItemId: "item-2",
        listingLinkId: "link-2",
        etsyListingId: "222",
      });

    const result = await handleEtsyImportBatchJob(claim);
    // Two items max per claim — both processed; discover complete + empty queue → SUCCESS
    expect(importEtsyListing).toHaveBeenCalledTimes(2);
    expect(result.outcome).toBe("SUCCESS");
  });

  it("skips already-imported as skipped and finishes when queue drains", async () => {
    vi.mocked(prisma.etsyImportBatch.findUnique).mockResolvedValue({
      id: "batch-1",
      etsyConnectionId: "conn-1",
      memberId: "m1",
      state: "RUNNING",
      stockModePolicy: "RECOMMENDED",
      total: 1,
      completed: 0,
      failed: 0,
      skipped: 0,
      discoverOffset: 25,
      discoverComplete: true,
      queueJson: ["999"],
      failuresJson: [],
      avgItemMs: 8_000,
      startedAt: new Date(),
      cancelRequested: false,
    } as never);
    vi.mocked(importEtsyListing).mockResolvedValue({
      status: "ALREADY_IMPORTED",
      storeItemId: "item-9",
      listingLinkId: "link-9",
      etsyListingId: "999",
    });

    const result = await handleEtsyImportBatchJob(claim);
    expect(result.outcome).toBe("SUCCESS");
    expect(prisma.etsyImportBatch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "batch-1" },
        data: expect.objectContaining({ state: "COMPLETED" }),
      })
    );
  });

  it("retries when discover still has pages after filling the queue", async () => {
    vi.mocked(prisma.etsyImportBatch.findUnique).mockResolvedValue({
      id: "batch-1",
      etsyConnectionId: "conn-1",
      memberId: "m1",
      state: "PENDING",
      stockModePolicy: "PHYSICAL",
      total: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      discoverOffset: 0,
      discoverComplete: false,
      queueJson: [],
      failuresJson: [],
      avgItemMs: null,
      startedAt: null,
      cancelRequested: false,
    } as never);
    vi.mocked(discoverEtsyImportCandidates).mockResolvedValue({
      status: "OK",
      connectionId: "conn-1",
      shopId: "shop-1",
      shopName: "Shop",
      candidates: [
        { etsyListingId: "101" },
        { etsyListingId: "102" },
        { etsyListingId: "103" },
      ],
      pageInfo: { hasNextPage: true, offset: 25 },
      etsyReportedCount: 100,
      alreadyLinkedCount: 0,
    } as never);
    vi.mocked(importEtsyListing).mockResolvedValue({
      status: "IMPORTED",
      storeItemId: "item-x",
      listingLinkId: "link-x",
      etsyListingId: "101",
    });

    const result = await handleEtsyImportBatchJob(claim);
    expect(result.outcome).toBe("RETRY");
    if (result.outcome === "RETRY") {
      expect(result.errorCode).toBe("IMPORT_BATCH_CONTINUE");
    }
  });
});
