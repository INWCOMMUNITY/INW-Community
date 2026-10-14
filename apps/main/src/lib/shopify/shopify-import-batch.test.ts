import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("database", () => ({
  prisma: {
    shopifyConnection: { findFirst: vi.fn() },
    shopifyImportBatch: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    shopifySyncJob: {
      updateMany: vi.fn(),
    },
  },
  enqueueShopifySyncJob: vi.fn(),
  findActiveShopifyImportBatch: vi.fn(),
  shopifyImportBatchDedupeKey: (connectionId: string, batchId: string) =>
    `IMPORT_BATCH:${connectionId}:${batchId}`,
  shopifyImportBatchProgressView: (batch: { id: string; state: string }) => ({
    id: batch.id,
    state: batch.state,
  }),
  parseShopifyImportBatchQueue: (raw: unknown) =>
    Array.isArray(raw)
      ? raw.filter(
          (x): x is string => typeof x === "string" && x.startsWith("gid://shopify/Product/")
        )
      : [],
  appendShopifyImportBatchFailures: (_existing: unknown, next: unknown[]) => next,
  nextShopifyImportBatchAvgItemMs: () => 10_000,
  resolveShopifyImportStockMode: () => "PHYSICAL" as const,
}));

vi.mock("./import-discovery", () => ({
  discoverShopifyImportCandidates: vi.fn(),
  fetchShopifyImportProductDetail: vi.fn(),
}));

vi.mock("./import-listing", () => ({
  importShopifyListing: vi.fn(),
}));

import {
  enqueueShopifySyncJob,
  findActiveShopifyImportBatch,
  prisma,
} from "database";
import { discoverShopifyImportCandidates } from "./import-discovery";
import { importShopifyListing } from "./import-listing";
import {
  handleShopifyImportBatchJob,
  startShopifyImportBatch,
} from "./import-batch";

describe("startShopifyImportBatch", () => {
  beforeEach(() => {
    vi.mocked(prisma.shopifyConnection.findFirst).mockReset();
    vi.mocked(findActiveShopifyImportBatch).mockReset();
    vi.mocked(prisma.shopifyImportBatch.create).mockReset();
    vi.mocked(enqueueShopifySyncJob).mockReset();
  });

  it("rejects without an active Shopify connection", async () => {
    vi.mocked(prisma.shopifyConnection.findFirst).mockResolvedValue(null);
    const result = await startShopifyImportBatch({ memberId: "m1" });
    expect(result).toMatchObject({
      status: "ERROR",
      code: "CONNECTION_REQUIRED",
      httpStatus: 409,
    });
  });

  it("rejects without a primary location", async () => {
    vi.mocked(prisma.shopifyConnection.findFirst).mockResolvedValue({
      id: "conn-1",
      primaryLocationId: null,
    } as never);
    const result = await startShopifyImportBatch({ memberId: "m1" });
    expect(result).toMatchObject({
      status: "ERROR",
      code: "LOCATION_REQUIRED",
      httpStatus: 409,
    });
  });

  it("returns ALREADY_RUNNING when a batch is active", async () => {
    vi.mocked(prisma.shopifyConnection.findFirst).mockResolvedValue({
      id: "conn-1",
      primaryLocationId: "gid://shopify/Location/1",
    } as never);
    vi.mocked(findActiveShopifyImportBatch).mockResolvedValue({
      id: "batch-live",
      state: "RUNNING",
    } as never);
    const result = await startShopifyImportBatch({ memberId: "m1" });
    expect(result.status).toBe("ALREADY_RUNNING");
    expect(enqueueShopifySyncJob).not.toHaveBeenCalled();
  });

  it("creates a batch and enqueues IMPORT_BATCH", async () => {
    vi.mocked(prisma.shopifyConnection.findFirst).mockResolvedValue({
      id: "conn-1",
      primaryLocationId: "gid://shopify/Location/1",
    } as never);
    vi.mocked(findActiveShopifyImportBatch).mockResolvedValue(null);
    vi.mocked(prisma.shopifyImportBatch.create).mockResolvedValue({
      id: "batch-1",
      state: "PENDING",
      shopifyConnectionId: "conn-1",
    } as never);
    vi.mocked(enqueueShopifySyncJob).mockResolvedValue({ id: "job-1" } as never);

    const result = await startShopifyImportBatch({
      memberId: "m1",
      stockModePolicy: "PHYSICAL",
    });
    expect(result.status).toBe("STARTED");
    expect(prisma.shopifyImportBatch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          shippingPricesJson: {},
        }),
      })
    );
    expect(enqueueShopifySyncJob).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        kind: "IMPORT_BATCH",
        dedupeKey: "IMPORT_BATCH:conn-1:batch-1",
        payload: { batchId: "batch-1" },
      })
    );
  });

  it("stores selected products and their shipping prices", async () => {
    vi.mocked(prisma.shopifyConnection.findFirst).mockResolvedValue({
      id: "conn-1",
      primaryLocationId: "gid://shopify/Location/1",
    } as never);
    vi.mocked(findActiveShopifyImportBatch).mockResolvedValue(null);
    vi.mocked(prisma.shopifyImportBatch.create).mockResolvedValue({
      id: "batch-priced",
      state: "PENDING",
      shopifyConnectionId: "conn-1",
    } as never);
    vi.mocked(enqueueShopifySyncJob).mockResolvedValue({ id: "job-1" } as never);

    const result = await startShopifyImportBatch({
      memberId: "m1",
      stockModePolicy: "PHYSICAL",
      productIds: ["gid://shopify/Product/111"],
      shippingPrices: { "gid://shopify/Product/111": 799 },
    });
    expect(result.status).toBe("STARTED");
    expect(prisma.shopifyImportBatch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          queueJson: ["gid://shopify/Product/111"],
          total: 1,
          discoverComplete: true,
          shippingPricesJson: { "gid://shopify/Product/111": 799 },
        }),
      })
    );
  });
});

describe("handleShopifyImportBatchJob", () => {
  const claim = {
    id: "job-1",
    shopifyConnectionId: "conn-1",
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
    vi.mocked(prisma.shopifyImportBatch.findUnique).mockReset();
    vi.mocked(prisma.shopifyImportBatch.update).mockReset();
    vi.mocked(discoverShopifyImportCandidates).mockReset();
    vi.mocked(importShopifyListing).mockReset();
    vi.mocked(prisma.shopifyImportBatch.update).mockResolvedValue({} as never);
  });

  it("imports queued products and completes when the queue drains", async () => {
    vi.mocked(prisma.shopifyImportBatch.findUnique).mockResolvedValue({
      id: "batch-1",
      shopifyConnectionId: "conn-1",
      memberId: "m1",
      state: "RUNNING",
      stockModePolicy: "PHYSICAL",
      total: 2,
      completed: 0,
      failed: 0,
      skipped: 0,
      discoverCursor: "done",
      discoverComplete: true,
      queueJson: ["gid://shopify/Product/111", "gid://shopify/Product/222"],
      shippingPricesJson: {
        "gid://shopify/Product/111": 799,
        "gid://shopify/Product/222": 0,
      },
      failuresJson: [],
      avgItemMs: null,
      startedAt: new Date(),
      cancelRequested: false,
    } as never);
    vi.mocked(importShopifyListing)
      .mockResolvedValueOnce({
        status: "IMPORTED",
        storeItemId: "item-1",
        listingLinkId: "link-1",
        shopifyProductId: "gid://shopify/Product/111",
      })
      .mockResolvedValueOnce({
        status: "ALREADY_IMPORTED",
        storeItemId: "item-2",
        listingLinkId: "link-2",
        shopifyProductId: "gid://shopify/Product/222",
      });

    const result = await handleShopifyImportBatchJob(claim);
    expect(importShopifyListing).toHaveBeenCalledTimes(2);
    expect(importShopifyListing).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        shopifyProductId: "gid://shopify/Product/111",
        shippingCostCents: 799,
      })
    );
    expect(importShopifyListing).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        shopifyProductId: "gid://shopify/Product/222",
        shippingCostCents: 0,
      })
    );
    expect(result.outcome).toBe("SUCCESS");
  });

  it("retries when discover still has pages after filling the queue", async () => {
    vi.mocked(prisma.shopifyImportBatch.findUnique).mockResolvedValue({
      id: "batch-1",
      shopifyConnectionId: "conn-1",
      memberId: "m1",
      state: "PENDING",
      stockModePolicy: "PHYSICAL",
      total: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      discoverCursor: null,
      discoverComplete: false,
      queueJson: [],
      failuresJson: [],
      avgItemMs: null,
      startedAt: null,
      cancelRequested: false,
    } as never);
    vi.mocked(discoverShopifyImportCandidates).mockResolvedValue({
      status: "OK",
      connectionId: "conn-1",
      shopDomain: "example.myshopify.com",
      candidates: [
        {
          shopifyProductId: "gid://shopify/Product/101",
          supported: true,
          unsupportedReason: null,
          recommendedStockMode: "PHYSICAL",
        },
        {
          shopifyProductId: "gid://shopify/Product/102",
          supported: true,
          unsupportedReason: null,
          recommendedStockMode: "PHYSICAL",
        },
      ],
      pageInfo: { hasNextPage: true, endCursor: "cursor-next" },
      alreadyLinkedCount: 0,
    } as never);
    vi.mocked(importShopifyListing).mockResolvedValue({
      status: "IMPORTED",
      storeItemId: "item-x",
      listingLinkId: "link-x",
      shopifyProductId: "gid://shopify/Product/101",
    });

    const result = await handleShopifyImportBatchJob(claim);
    expect(result.outcome).toBe("RETRY");
    if (result.outcome === "RETRY") {
      expect(result.errorCode).toBe("IMPORT_BATCH_CONTINUE");
    }
  });

  it("counts unsupported discover candidates as failed and continues", async () => {
    vi.mocked(prisma.shopifyImportBatch.findUnique).mockResolvedValue({
      id: "batch-1",
      shopifyConnectionId: "conn-1",
      memberId: "m1",
      state: "PENDING",
      stockModePolicy: "PHYSICAL",
      total: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      discoverCursor: null,
      discoverComplete: false,
      queueJson: [],
      failuresJson: [],
      avgItemMs: null,
      startedAt: null,
      cancelRequested: false,
    } as never);
    vi.mocked(discoverShopifyImportCandidates).mockResolvedValue({
      status: "OK",
      connectionId: "conn-1",
      shopDomain: "example.myshopify.com",
      candidates: [
        {
          shopifyProductId: "gid://shopify/Product/unsupported",
          supported: false,
          unsupportedReason: "Multi-variant products are not supported yet",
          recommendedStockMode: null,
        },
      ],
      pageInfo: { hasNextPage: false, endCursor: null },
      alreadyLinkedCount: 0,
    } as never);

    const result = await handleShopifyImportBatchJob(claim);
    expect(result.outcome).toBe("SUCCESS");
    expect(prisma.shopifyImportBatch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "batch-1" },
        data: expect.objectContaining({ state: "COMPLETED" }),
      })
    );
  });
});
