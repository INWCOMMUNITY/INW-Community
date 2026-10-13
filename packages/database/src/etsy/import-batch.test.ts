import { describe, expect, it } from "vitest";
import {
  ETSY_IMPORT_BATCH_DEFAULT_ITEM_MS,
  appendEtsyImportBatchFailures,
  etsyImportBatchDedupeKey,
  etsyImportBatchProgressView,
  nextEtsyImportBatchAvgItemMs,
  parseEtsyImportBatchQueue,
  resolveEtsyImportStockMode,
} from "./import-batch";
import type { EtsyImportBatch } from "@prisma/client";

function baseBatch(over: Partial<EtsyImportBatch> = {}): EtsyImportBatch {
  return {
    id: "batch-1",
    etsyConnectionId: "conn-1",
    memberId: "m1",
    state: "RUNNING",
    stockModePolicy: "RECOMMENDED",
    total: 10,
    completed: 2,
    failed: 1,
    skipped: 1,
    discoverOffset: 25,
    discoverComplete: false,
    queueJson: ["111", "222"],
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

describe("etsy import batch helpers", () => {
  it("builds a stable dedupe key", () => {
    expect(etsyImportBatchDedupeKey("conn-1", "batch-1")).toBe("IMPORT_BATCH:conn-1:batch-1");
  });

  it("resolves stock mode policy", () => {
    expect(resolveEtsyImportStockMode("PHYSICAL", "MADE_TO_ORDER")).toBe("PHYSICAL");
    expect(resolveEtsyImportStockMode("MADE_TO_ORDER", "PHYSICAL")).toBe("MADE_TO_ORDER");
    expect(resolveEtsyImportStockMode("RECOMMENDED", "MADE_TO_ORDER")).toBe("MADE_TO_ORDER");
    expect(resolveEtsyImportStockMode("RECOMMENDED", null)).toBe("PHYSICAL");
  });

  it("parses queue ids and drops junk", () => {
    expect(parseEtsyImportBatchQueue(["1", "1", "abc", 2, "99"])).toEqual(["1", "99"]);
  });

  it("keeps a bounded failure list", () => {
    const failures = appendEtsyImportBatchFailures(
      [{ etsyListingId: "1", message: "old" }],
      [{ etsyListingId: "2", message: "new" }]
    );
    expect(failures).toEqual([
      { etsyListingId: "1", message: "old" },
      { etsyListingId: "2", message: "new" },
    ]);
  });

  it("computes progress percent and ETA", () => {
    const view = etsyImportBatchProgressView(baseBatch());
    expect(view.processed).toBe(4);
    expect(view.percent).toBe(40);
    expect(view.etaSeconds).toBeGreaterThan(0);
    expect(view.scanning).toBe(false);
  });

  it("marks early discovery as scanning without a fake percent", () => {
    const view = etsyImportBatchProgressView(
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
    expect(ETSY_IMPORT_BATCH_DEFAULT_ITEM_MS).toBeGreaterThan(0);
    const view = etsyImportBatchProgressView(
      baseBatch({
        completed: 0,
        failed: 0,
        skipped: 0,
        total: 5,
        discoverComplete: true,
        queueJson: ["1", "2", "3", "4", "5"],
        avgItemMs: null,
      })
    );
    expect(view.etaSeconds).toBe(Math.ceil((5 * ETSY_IMPORT_BATCH_DEFAULT_ITEM_MS) / 1000));
  });

  it("updates rolling average item duration", () => {
    expect(nextEtsyImportBatchAvgItemMs(null, 0, 8_000)).toBe(8_000);
    expect(nextEtsyImportBatchAvgItemMs(10_000, 3, 20_000)).toBe(13_000);
  });
});
