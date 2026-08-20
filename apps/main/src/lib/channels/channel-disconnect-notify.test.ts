import { describe, expect, it } from "vitest";
import {
  DISCONNECT_NOTIFY_COOLDOWN_MS,
  readDisconnectNotifiedAt,
  shouldNotifyChannelDisconnect,
} from "./channel-disconnect-notify";

describe("shouldNotifyChannelDisconnect", () => {
  it("notifies when a live connection first fails", () => {
    expect(shouldNotifyChannelDisconnect("active")).toBe(true);
    expect(shouldNotifyChannelDisconnect(null)).toBe(true);
  });

  it("does not re-notify while the connection is already in error", () => {
    expect(shouldNotifyChannelDisconnect("error")).toBe(false);
  });

  it("does not re-notify within the cooldown after a recent push", () => {
    const now = new Date("2026-08-20T08:00:00.000Z");
    const lastNotifiedAt = new Date("2026-08-20T07:01:00.000Z");
    expect(shouldNotifyChannelDisconnect("active", lastNotifiedAt, now)).toBe(false);
  });

  it("notifies again after the cooldown", () => {
    const now = new Date("2026-08-20T20:00:00.000Z");
    const lastNotifiedAt = new Date(
      now.getTime() - DISCONNECT_NOTIFY_COOLDOWN_MS - 60_000
    );
    expect(shouldNotifyChannelDisconnect("active", lastNotifiedAt, now)).toBe(true);
  });
});

describe("readDisconnectNotifiedAt", () => {
  it("reads an ISO timestamp from connection config", () => {
    expect(
      readDisconnectNotifiedAt({ disconnectNotifiedAt: "2026-08-20T07:01:00.000Z" })?.toISOString()
    ).toBe("2026-08-20T07:01:00.000Z");
  });

  it("returns null when missing or invalid", () => {
    expect(readDisconnectNotifiedAt(null)).toBeNull();
    expect(readDisconnectNotifiedAt({ disconnectNotifiedAt: "nope" })).toBeNull();
  });
});
