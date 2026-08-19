import { describe, expect, it, vi } from "vitest";
import { applyExpiredCategoryMap, resolveRemappedEbayCategoryId } from "./expired-categories";

describe("applyExpiredCategoryMap", () => {
  it("returns the original id when there is no mapping", () => {
    expect(applyExpiredCategoryMap("41087", {})).toBe("41087");
  });

  it("follows from → to remaps", () => {
    expect(applyExpiredCategoryMap("111", { "111": "222" })).toBe("222");
  });

  it("follows a chain and does not loop forever", () => {
    expect(applyExpiredCategoryMap("a", { a: "b", b: "c", c: "a" })).toBe("a");
    expect(applyExpiredCategoryMap("a", { a: "b", b: "c" })).toBe("c");
  });
});

describe("resolveRemappedEbayCategoryId", () => {
  it("persists when a remap occurs", async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const result = await resolveRemappedEbayCategoryId("111", {
      storeItemId: "item-1",
      persist: true,
      currentStoredId: 111,
      persistCategoryId: persist,
      categoryMap: { "111": "222" },
    });
    expect(result).toBe("222");
    expect(persist).toHaveBeenCalledWith("item-1", 222);
  });
});
