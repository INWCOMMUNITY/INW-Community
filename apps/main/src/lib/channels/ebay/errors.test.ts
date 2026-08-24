import { describe, expect, it } from "vitest";
import {
  EbayApiError,
  describeChannelSyncError,
  describeEbayThrownError,
  ebayErrorActionHint,
  extractEbayWarnings,
  formatEbayApiBody,
  formatEbayErrorDiagnostics,
  formatMigrateListingError,
} from "./errors";

describe("extractEbayWarnings", () => {
  it("returns empty when the envelope has no warnings", () => {
    expect(extractEbayWarnings({ errors: [{ errorId: 1 }] })).toEqual([]);
    expect(extractEbayWarnings(null)).toEqual([]);
  });

  it("reads warnings from a successful envelope", () => {
    const rows = extractEbayWarnings({
      warnings: [
        {
          errorId: 25007,
          longMessage: "The listing was updated but a warning occurred.",
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.errorId).toBe(25007);
  });
});

describe("formatEbayApiBody", () => {
  it("includes error id and long message instead of a bare HTTP code", () => {
    const msg = formatEbayApiBody(
      {
        errors: [
          {
            errorId: 25001,
            domain: "API_INVENTORY",
            category: "SYSTEM",
            message: "A system error has occurred.",
          },
        ],
      },
      500
    );
    expect(msg).toContain("#25001");
    expect(msg).toContain("system error");
    expect(msg).toContain("HTTP 500");
    expect(msg).not.toBe("eBay API error (500)");
  });

  it("reads errors nested under bulk migrate responses", () => {
    const msg = formatEbayApiBody(
      {
        responses: [
          {
            listingId: "1234567890",
            statusCode: 400,
            errors: [{ errorId: 25718, longMessage: "Cannot migrate listing. No SKU." }],
          },
        ],
      },
      400,
      "/sell/inventory/v1/bulk_migrate_listing"
    );
    expect(msg).toContain("#25718");
    expect(msg).toContain("Cannot migrate listing");
    expect(msg).toContain("1234567890");
  });

  it("explains empty HTTP 400 with endpoint context", () => {
    const msg = formatEbayApiBody(null, 400, "/sell/inventory/v1/bulk_migrate_listing");
    expect(msg).toContain("HTTP 400");
    expect(msg).toContain("bulk_migrate_listing");
    expect(msg).toContain("SKU");
  });
});

describe("describeEbayThrownError", () => {
  it("re-parses EbayApiError bodies for full detail", () => {
    const err = new EbayApiError("eBay API error (500)", 500, {
      errors: [{ errorId: 25718, longMessage: "Cannot migrate listing. Missing SKU." }],
    });
    expect(describeEbayThrownError(err)).toContain("#25718");
    expect(describeEbayThrownError(err)).toContain("Missing SKU");
  });
});

describe("formatEbayErrorDiagnostics", () => {
  it("returns structured error rows with parameters", () => {
    const err = new EbayApiError("eBay API error (400)", 400, {
      errors: [
        {
          errorId: 25064,
          domain: "API_INVENTORY",
          category: "REQUEST",
          message: "Letter grade (3) is a required field.",
          parameters: [{ name: "0", value: "Letter grade" }],
        },
      ],
    }, "/sell/inventory/v1/inventory_item/SKU");
    const diag = formatEbayErrorDiagnostics(err);
    expect(diag.status).toBe(400);
    expect(diag.path).toContain("inventory_item");
    expect(Array.isArray(diag.errors)).toBe(true);
    expect((diag.errors as { errorId: number }[])[0]?.errorId).toBe(25064);
  });
});

describe("formatMigrateListingError", () => {
  it("formats per-listing migration failures", () => {
    expect(
      formatMigrateListingError({
        statusCode: 400,
        errors: [{ errorId: 25718, longMessage: "Cannot migrate listing." }],
      })
    ).toContain("#25718");
  });
});

describe("ebay picture errors", () => {
  it("hints about mixed eBay-hosted and INW URLs for #25014 instead of asking to re-upload", () => {
    const mix =
      "title: failed ([#25014 · API_INVENTORY · Request · HTTP 400] The eBay listing associated with the inventory item, or the unpublished offer has invalid pictures. A mixture of Self Hosted and EPS pictures are not allowed.)";
    expect(ebayErrorActionHint(mix)).toMatch(/eBay-hosted/i);
    expect(ebayErrorActionHint(mix)).toMatch(/do not need to re-upload/i);
    expect(ebayErrorActionHint(mix)).not.toMatch(/Re-upload at least one/i);
    expect(describeChannelSyncError("ebay", new Error(mix))).toMatch(/do not need to re-upload/i);
  });

  it("hints to fix photos for generic #25014 instead of a migrate-listing message", () => {
    const msg =
      "title: failed ([#25014 · API_INVENTORY · Request · HTTP 400] The eBay listing associated with the inventory item, or the unpublished offer has invalid pictures.)";
    expect(ebayErrorActionHint(msg)).toMatch(/rejected the listing photos/i);
    expect(ebayErrorActionHint(msg)).not.toMatch(/migrate this listing/i);
    expect(describeChannelSyncError("ebay", new Error(msg))).toMatch(/mixed eBay-hosted/i);
  });
});
