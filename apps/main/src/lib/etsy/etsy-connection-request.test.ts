import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("database", () => ({
  prisma: {
    etsyConnection: { findFirst: vi.fn() },
  },
}));

vi.mock("./config", () => ({
  readEtsyAppConfig: vi.fn(() => ({
    apiKey: "key",
    clientSecret: "secret",
    clientId: "key",
    appUrl: "http://localhost:3000",
    redirectUri: "http://localhost:3000/api/etsy/oauth/callback",
  })),
}));

vi.mock("./connect", () => ({
  accessTokenForEtsyConnection: vi.fn(async () => "token"),
  EtsyConnectError: class EtsyConnectError extends Error {},
}));

vi.mock("./client", () => ({
  etsyApplicationRequest: vi.fn(async () => ({
    ok: true,
    class: "SUCCESS",
    httpStatus: 200,
    data: {},
    message: "ok",
    retryAfterMs: null,
    rateLimit: null,
  })),
}));

import { prisma } from "database";
import { etsyApplicationRequest } from "./client";
import { etsyConnectionRequest } from "./connection-request";

describe("etsyConnectionRequest body encoding", () => {
  beforeEach(() => {
    vi.mocked(prisma.etsyConnection.findFirst).mockResolvedValue({
      id: "conn-1",
      memberId: "m1",
      status: "ACTIVE",
    } as never);
    vi.mocked(etsyApplicationRequest).mockClear();
  });

  it("sends form-urlencoded body when bodyEncoding is form", async () => {
    await etsyConnectionRequest({
      connectionId: "conn-1",
      memberId: "m1",
      method: "POST",
      path: "/shops/1/listings",
      bodyEncoding: "form",
      body: { title: "Mug", who_made: "i_did", is_supply: false, taxonomy_id: 12 },
    });

    expect(etsyApplicationRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "title=Mug&who_made=i_did&is_supply=false&taxonomy_id=12",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      })
    );
  });

  it("defaults to JSON body", async () => {
    await etsyConnectionRequest({
      connectionId: "conn-1",
      memberId: "m1",
      method: "POST",
      path: "/shops/1/listings",
      body: { title: "Mug" },
    });

    expect(etsyApplicationRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        body: JSON.stringify({ title: "Mug" }),
        headers: { "Content-Type": "application/json" },
      })
    );
  });
});
