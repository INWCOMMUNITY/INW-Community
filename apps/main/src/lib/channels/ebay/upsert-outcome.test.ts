import { describe, expect, it } from "vitest";
import { classifyEbayUpsertResult } from "./upsert-outcome";

describe("classifyEbayUpsertResult", () => {
  it("is ok when nothing failed", () => {
    expect(classifyEbayUpsertResult({}).kind).toBe("ok");
    expect(classifyEbayUpsertResult({ publishError: undefined, quantityError: undefined }).kind).toBe(
      "ok"
    );
  });

  it("reports publish errors first", () => {
    const outcome = classifyEbayUpsertResult({ publishError: "boom", quantityError: "qty" });
    expect(outcome).toEqual({ kind: "publish_error", message: "boom" });
  });

  it("surfaces a quantity write failure as a non-success (not silently swallowed)", () => {
    const outcome = classifyEbayUpsertResult({ quantityError: "#25002 offer qty" });
    expect(outcome).toEqual({ kind: "quantity_error", message: "#25002 offer qty" });
  });
});
