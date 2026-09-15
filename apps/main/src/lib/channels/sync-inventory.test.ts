import { describe, expect, it } from "vitest";
import { channelSyncSucceeded } from "./sync-inventory";

describe("channelSyncSucceeded", () => {
  it("treats a completed write as success", () => {
    expect(channelSyncSucceeded([{ provider: "etsy", ok: true }], "etsy")).toBe(true);
  });

  it("does not treat a remote_newer skip as a successful write", () => {
    expect(
      channelSyncSucceeded([{ provider: "etsy", ok: true, skipped: "remote_newer" }], "etsy")
    ).toBe(false);
  });

  it("treats a hard failure as unsuccessful", () => {
    expect(
      channelSyncSucceeded([{ provider: "etsy", ok: false, error: "nope" }], "etsy")
    ).toBe(false);
  });
});
