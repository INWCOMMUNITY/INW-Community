import { describe, expect, it } from "vitest";
import { isEbayImageRelatedInventoryError } from "./media";

describe("isEbayImageRelatedInventoryError", () => {
  it("detects image-related inventory errors", () => {
    expect(isEbayImageRelatedInventoryError("Invalid image URL supplied.")).toBe(true);
    expect(isEbayImageRelatedInventoryError("Missing required aspect Year")).toBe(false);
  });
});
