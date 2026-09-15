import { describe, expect, it } from "vitest";
import { classifyEbayUpsertResult } from "./upsert-outcome";

describe("classifyEbayUpsertResult", () => {
  it("is ok when nothing failed", () => {
    expect(classifyEbayUpsertResult({}).kind).toBe("ok");
    expect(classifyEbayUpsertResult({ publishError: undefined }).kind).toBe("ok");
  });

  it("reports publish errors", () => {
    const outcome = classifyEbayUpsertResult({ publishError: "boom" });
    expect(outcome).toEqual({ kind: "publish_error", message: "boom" });
  });
});
