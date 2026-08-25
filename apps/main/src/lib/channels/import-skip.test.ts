import { describe, expect, it } from "vitest";
import { isPermanentImportSkip, isRetryableImportSkip, withSkipMeta } from "./import-skip";

describe("isRetryableImportSkip", () => {
  it("retries timeouts, 504, and #25001", () => {
    expect(isRetryableImportSkip("timed out after 60s")).toBe(true);
    expect(isRetryableImportSkip("eBay HTTP 504")).toBe(true);
    expect(isRetryableImportSkip("[#25001] A system error has occurred")).toBe(true);
    expect(isRetryableImportSkip("migration_failed")).toBe(true);
  });

  it("does not retry auctions, ended listings, or already linked", () => {
    expect(isRetryableImportSkip("not_fixed_price — eBay can only sync fixed-price")).toBe(false);
    expect(isRetryableImportSkip("This eBay listing has ended and cannot be imported.")).toBe(false);
    expect(isRetryableImportSkip("already_linked")).toBe(false);
    expect(isRetryableImportSkip("invalid_price — listing price must be at least $0.01")).toBe(false);
    expect(isRetryableImportSkip("Add payment, return, and shipping policies plus a merchant location")).toBe(
      false
    );
  });
});

describe("withSkipMeta", () => {
  it("stamps retryable from the reason", () => {
    expect(withSkipMeta({ externalListingId: "1", reason: "timed out after 60s" }).retryable).toBe(true);
    expect(withSkipMeta({ externalListingId: "2", reason: "already_linked" }).retryable).toBe(false);
  });
});

describe("isPermanentImportSkip", () => {
  it("treats policy and auction skips as permanent", () => {
    expect(isPermanentImportSkip("not_fixed_price")).toBe(true);
    expect(isPermanentImportSkip("merchant location required")).toBe(true);
  });
});
