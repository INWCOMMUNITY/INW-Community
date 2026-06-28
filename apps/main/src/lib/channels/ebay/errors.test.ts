import { describe, expect, it } from "vitest";
import {
  EbayApiError,
  describeEbayThrownError,
  formatEbayApiBody,
  formatMigrateListingError,
} from "./errors";

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
