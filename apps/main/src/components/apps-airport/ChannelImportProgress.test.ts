import { describe, expect, it } from "vitest";
import { importProgressLabel, importProgressPercent } from "./import-progress";

const running = {
  state: "RUNNING",
  processed: 6,
  total: 10,
  scanning: false,
  cancelRequested: false,
};

describe("import progress bar", () => {
  it("counts finished listings against the batch total", () => {
    expect(importProgressLabel(running)).toBe("6/10 listings imported");
    expect(importProgressPercent(running)).toBe(60);
  });

  it("stays quiet when no import is running", () => {
    expect(importProgressLabel({ ...running, state: "COMPLETED" })).toBeNull();
  });

  it("shows a short bar while the shop is still being scanned", () => {
    const scanning = { ...running, scanning: true, processed: 0, total: 0 };
    expect(importProgressLabel(scanning)).toBe("Finding listings…");
    expect(importProgressPercent(scanning)).toBe(12);
  });
});
