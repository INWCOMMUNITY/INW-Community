import { describe, expect, it } from "vitest";
import { shouldNotifyChannelDisconnect } from "./channel-disconnect-notify";

describe("shouldNotifyChannelDisconnect", () => {
  it("notifies when a live connection first fails", () => {
    expect(shouldNotifyChannelDisconnect("active")).toBe(true);
    expect(shouldNotifyChannelDisconnect(null)).toBe(true);
  });

  it("does not re-notify while the connection is already in error", () => {
    expect(shouldNotifyChannelDisconnect("error")).toBe(false);
  });
});
