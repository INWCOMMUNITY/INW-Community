import { describe, expect, it } from "vitest";
import { classifyError, shouldCountTowardCircuit } from "./error-classifier";

describe("shouldCountTowardCircuit", () => {
  it("counts connection outages", () => {
    expect(shouldCountTowardCircuit("503 Service Unavailable")).toBe(true);
    expect(shouldCountTowardCircuit({ status: 429, message: "Too many requests" })).toBe(true);
    expect(shouldCountTowardCircuit(new Error("ETIMEDOUT"))).toBe(true);
  });

  it("does not pause the shop for listing-level errors after an Etsy edit", () => {
    expect(
      shouldCountTowardCircuit("Etsy inventory verify failed for listing 1: expected 3, got 2")
    ).toBe(false);
    expect(shouldCountTowardCircuit({ status: 409, message: "conflict" })).toBe(false);
    expect(shouldCountTowardCircuit({ status: 400, message: "who_made is required" })).toBe(false);
    expect(
      shouldCountTowardCircuit(
        "Cannot update 'when_made' without 'who_made' and  without 'is_supply' and vice versa"
      )
    ).toBe(false);
    expect(
      shouldCountTowardCircuit({
        status: 400,
        message: "marketplace: Oh dear, you cannot sell this item on Etsy.",
      })
    ).toBe(false);
    expect(shouldCountTowardCircuit(new Error("invalid_grant"))).toBe(false);
  });
});

describe("classifyError", () => {
  it("treats eBay #25014 mixed-photo HTTP 400 as transient", () => {
    const err = new Error(
      "Inventory push failed: [#25014 · API_INVENTORY · Request · HTTP 400] A mixture of Self Hosted and EPS pictures are not allowed."
    ) as Error & { status: number };
    err.status = 400;
    expect(classifyError(err)).toBe("transient");
    expect(shouldCountTowardCircuit(err)).toBe(false);
    expect(
      classifyError(
        "Permanent error (won't retry): [#25014 · API_INVENTORY · Request · HTTP 400] A mixture of Self Hosted and EPS pictures are not allowed."
      )
    ).toBe("transient");
  });

  it("treats Shopify 422 currently being modified as transient", () => {
    const err = new Error(
      "This product is currently being modified. Please try again later."
    ) as Error & { status: number };
    err.status = 422;
    expect(classifyError(err)).toBe("transient");
    expect(
      classifyError({
        status: 422,
        message: "Product is currently being modified — please try again later",
      })
    ).toBe("transient");
  });
});
