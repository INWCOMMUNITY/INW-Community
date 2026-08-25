import { describe, expect, it } from "vitest";
import { easedImportPercent, importJobDisplayPercent } from "./import-job-progress";

describe("importJobDisplayPercent", () => {
  it("is 100 only when the job completed", () => {
    expect(
      importJobDisplayPercent({ status: "processing", total: 10, completed: 10, failed: 0 })
    ).toBe(99);
    expect(
      importJobDisplayPercent({ status: "completed", total: 10, completed: 10, failed: 0 })
    ).toBe(100);
  });

  it("tracks completed plus failed against total", () => {
    expect(
      importJobDisplayPercent({ status: "processing", total: 10, completed: 2, failed: 1 })
    ).toBe(30);
  });
});

describe("easedImportPercent", () => {
  it("avoids sitting at 0% during the first listing", () => {
    expect(easedImportPercent(0, true, 0)).toBe(4);
    expect(easedImportPercent(30, true, 3)).toBe(30);
    expect(easedImportPercent(100, false, 10)).toBe(100);
  });
});
