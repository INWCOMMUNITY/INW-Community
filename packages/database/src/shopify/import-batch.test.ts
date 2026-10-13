import { describe, expect, it } from "vitest";
import {
  SHOPIFY_IMPORT_BATCH_DEFAULT_ITEM_MS,
  appendShopifyImportBatchFailures,
  nextShopifyImportBatchAvgItemMs,
  parseShopifyImportBatchQueue,
  resolveShopifyImportStockMode,
  shopifyImportBatchDedupeKey,
  shopifyImportBatchProgressView,
} from "./import-batch";
import type { ShopifyImportBatch } from "@prisma/client";

function baseBatch(over: Partial<ShopifyImportBatch> = {}): ShopifyImportBatch {
  return {
    id: "batch-1",
    shopifyConnectionId: "conn-1",
    memberId: "m1",
    state: "RUNNING",
    stockModePolicy: "RECOMMENDED",
    total: 10,
    completed: 2,
    failed: 1,
    skipped: 1,
    discoverCursor: "cursor-1",
    discoverComplete: false,
    queueJson: ["gid://shopify/Product/111", "gid://shopify/Product/222"],
    failuresJson: [],
    avgItemMs: 10_000,
    startedAt: new Date("2026-10-13T00:00:00.000Z"),
    finishedAt: null,
    lastProgressAt: new Date("2026-10-13T00:01:00.000Z"),
    lastError: null,
    cancelRequested: false,
    createdAt: new Date("2026-10-13T00:00:00.000Z"),
    updatedAt: new Date("2026-10-13T00:01:00.000Z"),
    ...over,
  };
}

describe("shopify import batch helpers", () => {
  it("builds a stable dedupe key", () => {
    expect(shopifyImportBatchDedupeKey("conn-1", "batch-1")).toBe("IMPORT_BATCH:conn-1:batch-1");
  });

  it("resolves stock mode policy", () => {
    expect(resolveShopifyImportStockMode("PHYSICAL", "MADE_TO_ORDER")).toBe("PHYSICAL");
    expect(resolveShopifyImportStockMode("MADE_TO_ORDER", "PHYSICAL")).toBe("MADE_TO_ORDER");
    expect(resolveShopifyImportStockMode("RECOMMENDED", "MADE_TO_ORDER")).toBe("MADE_TO_ORDER");
    expect(resolveShopifyImportStockMode("RECOMMENDED", null)).toBe("PHYSICAL");
  });

  it("parses product GID queue and drops junk", () => {
    expect(
      parseShopifyImportBatchQueue([
        "gid://shopify/Product/1",
        "gid://shopify/Product/1",
        "Product/2",
        2,
        "gid://shopify/Product/99",
      ])
    ).toEqual(["gid://shopify/Product/1", "gid://shopify/Product/99"]);
  });

  it("keeps a bounded failure list", () => {
    const failures = appendShopifyImportBatchFailures(
      [{ shopifyProductId: "gid://shopify/Product/1", message: "old" }],
      [{ shopifyProductId: "gid://shopify/Product/2", message: "new" }]
    );
    expect(failures).toEqual([
      { shopifyProductId: "gid://shopify/Product/1", message: "old" },
      { shopifyProductId: "gid://shopify/Product/2", message: "new" },
    ]);
  });

  it("computes progress percent and ETA", () => {
    const view = shopifyImportBatchProgressView(baseBatch());
    expect(view.processed).toBe(4);
    expect(view.percent).toBe(40);
    expect(view.etaSeconds).toBeGreaterThan(0);
    expect(view.scanning).toBe(false);
  });

  it("marks early discovery as scanning without a fake percent", () => {
    const view = shopifyImportBatchProgressView(
      baseBatch({
        total: 0,
        completed: 0,
        failed: 0,
        skipped: 0,
        discoverComplete: false,
        queueJson: [],
        avgItemMs: null,
      })
    );
    expect(view.scanning).toBe(true);
    expect(view.percent).toBeNull();
    expect(view.avgItemMs).toBeNull();
    expect(view.etaSeconds).toBeNull();
  });

  it("seeds default item timing for ETA before first sample settles", () => {
    expect(SHOPIFY_IMPORT_BATCH_DEFAULT_ITEM_MS).toBeGreaterThan(0);
    const view = shopifyImportBatchProgressView(
      baseBatch({
        completed: 0,
        failed: 0,
        skipped: 0,
        total: 5,
        discoverComplete: true,
        queueJson: [
          "gid://shopify/Product/1",
          "gid://shopify/Product/2",
          "gid://shopify/Product/3",
          "gid://shopify/Product/4",
          "gid://shopify/Product/5",
        ],
        avgItemMs: null,
      })
    );
    expect(view.etaSeconds).toBe(Math.ceil((5 * SHOPIFY_IMPORT_BATCH_DEFAULT_ITEM_MS) / 1000));
  });

  it("updates rolling average item duration", () => {
    expect(nextShopifyImportBatchAvgItemMs(null, 0, 8_000)).toBe(8_000);
    expect(nextShopifyImportBatchAvgItemMs(10_000, 3, 20_000)).toBe(13_000);
  });
});
