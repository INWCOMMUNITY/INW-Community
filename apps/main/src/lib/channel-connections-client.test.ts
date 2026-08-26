import { describe, expect, it } from "vitest";
import { activeListOnConnections, listOnConnectionHealth, listOnConnections } from "./channel-connections-client";
import type { ChannelConnectionSummary } from "./channel-connections-client";

function conn(
  provider: ChannelConnectionSummary["provider"],
  status: string
): ChannelConnectionSummary {
  return {
    id: provider,
    provider,
    shopName: null,
    status,
    readyToPublish: status === "active",
  };
}

describe("listOnConnections", () => {
  it("includes active and error stores so List on rows still appear after a pause", () => {
    const rows = listOnConnections([
      conn("etsy", "error"),
      conn("ebay", "active"),
      conn("wix", "disconnected"),
    ]);
    expect(rows.map((c) => c.provider)).toEqual(["ebay", "etsy"]);
  });

  it("keeps active-only helper for callers that must skip paused stores", () => {
    expect(
      activeListOnConnections([conn("ebay", "active"), conn("etsy", "error")]).map((c) => c.provider)
    ).toEqual(["ebay"]);
  });
});

describe("listOnConnectionHealth", () => {
  it("shows reconnect only for reconnect health, not delayed or platform_key", () => {
    expect(
      listOnConnectionHealth({
        status: "error",
        readyToPublish: false,
        healthKind: "reconnect",
        healthMessage: "Reconnect this store",
      })
    ).toEqual({ blocked: true, showReconnect: true, hint: "Reconnect this store" });
    expect(
      listOnConnectionHealth({
        status: "error",
        readyToPublish: false,
        healthKind: "delayed",
        healthMessage: "Sync is delayed",
      }).showReconnect
    ).toBe(false);
    expect(
      listOnConnectionHealth({
        status: "error",
        readyToPublish: false,
        healthKind: "platform_key",
        healthMessage: "Do not reconnect",
      }).showReconnect
    ).toBe(false);
  });
});
