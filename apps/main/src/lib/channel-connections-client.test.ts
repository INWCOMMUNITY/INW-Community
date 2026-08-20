import { describe, expect, it } from "vitest";
import { activeListOnConnections, listOnConnections } from "./channel-connections-client";
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
