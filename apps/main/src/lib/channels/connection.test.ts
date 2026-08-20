import { beforeEach, describe, expect, it, vi } from "vitest";
import { EbayApiError } from "./ebay/errors";

const mockPrisma = {
  channelConnection: {
    findUnique: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
  channelSyncLog: {
    create: vi.fn().mockResolvedValue({}),
  },
};

vi.mock("database", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/encrypt", () => ({
  encrypt: (v: string) => `enc:${v}`,
  decrypt: (v: string) => v.replace(/^enc:/, ""),
}));

const mockAdapter = {
  refreshAccessToken: vi.fn().mockResolvedValue({
    accessToken: "new-token",
    refreshToken: "new-refresh",
    expiresInSec: 7200,
  }),
};

vi.mock("./registry", () => ({
  getAdapter: () => mockAdapter,
}));

const mockNotify = vi.fn().mockResolvedValue(true);

vi.mock("./channel-disconnect-notify", () => ({
  notifyChannelDisconnectIfNew: (...args: unknown[]) => mockNotify(...args),
  readDisconnectNotifiedAt: () => null,
}));

const staleConn = {
  id: "cmsz84nxd0002ddzd68dp1uqj",
  memberId: "cmn6cezvp00015dvu667d7std",
  provider: "ebay",
  externalShopId: "shop",
  accessTokenEncrypted: "enc:expired-iaf",
  refreshTokenEncrypted: "enc:refresh",
  tokenExpiresAt: new Date(Date.now() + 3600_000),
  status: "active",
  etsyShippingProfileId: null,
  config: null,
};

describe("channel auth failure classification", () => {
  it("treats expired access tokens as recoverable", async () => {
    const { isPermanentChannelAuthFailure, connectionNeedsReconnect } = await import("./connection");
    const iaf = new EbayApiError("IAF token supplied is expired.", 401, null, "GetItem");
    expect(isPermanentChannelAuthFailure(iaf)).toBe(false);
    expect(connectionNeedsReconnect(iaf, true)).toBe(false);
    expect(
      connectionNeedsReconnect(
        new Error("[#1001 · OAuth · REQUEST · HTTP 401] Invalid access token."),
        true
      )
    ).toBe(false);
  });

  it("treats a dead refresh token as reconnect-required", async () => {
    const { isPermanentChannelAuthFailure, connectionNeedsReconnect } = await import("./connection");
    expect(isPermanentChannelAuthFailure(new Error("invalid_grant"))).toBe(true);
    expect(isPermanentChannelAuthFailure(new Error("Invalid grant"))).toBe(true);
    expect(connectionNeedsReconnect(new Error("invalid_grant"), true)).toBe(true);
    expect(connectionNeedsReconnect(new Error("IAF token supplied is expired."), false)).toBe(
      true
    );
  });
});

describe("markChannelConnectionFailure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNotify.mockResolvedValue(true);
  });

  it("does not pause or notify on an expired access token when a refresh token exists", async () => {
    const { markChannelConnectionFailure } = await import("./connection");
    const result = await markChannelConnectionFailure({
      connection: staleConn,
      error: new EbayApiError("IAF token supplied is expired.", 401, null, "GetItem"),
      lastError: "IAF token supplied is expired.",
    });
    expect(result.paused).toBe(false);
    expect(mockPrisma.channelConnection.update).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("pauses and notifies when the refresh token is rejected", async () => {
    const { markChannelConnectionFailure } = await import("./connection");
    const result = await markChannelConnectionFailure({
      connection: staleConn,
      error: new Error("invalid_grant"),
      lastError: "Token refresh failed: invalid_grant",
    });
    expect(result.paused).toBe(true);
    expect(mockPrisma.channelConnection.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "error" }),
      })
    );
    expect(mockNotify).toHaveBeenCalledOnce();
  });
});

describe("withConnectionAuthRetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdapter.refreshAccessToken.mockResolvedValue({
      accessToken: "new-token",
      refreshToken: "new-refresh",
      expiresInSec: 7200,
    });
  });

  it("uses the DB token, not a stale in-memory access token", async () => {
    mockPrisma.channelConnection.findUnique.mockResolvedValue({
      ...staleConn,
      accessTokenEncrypted: "enc:fresh-from-db",
    });
    const { withConnectionAuthRetry } = await import("./connection");
    let seen = "";
    await withConnectionAuthRetry(staleConn, async (ctx) => {
      seen = ctx.accessToken;
      return "ok";
    });
    expect(seen).toBe("fresh-from-db");
  });

  it("retries once on IAF token expired and uses the refreshed token", async () => {
    mockPrisma.channelConnection.findUnique.mockResolvedValue(staleConn);
    const { withConnectionAuthRetry } = await import("./connection");
    const tokens: string[] = [];
    let calls = 0;
    const result = await withConnectionAuthRetry(staleConn, async (ctx) => {
      tokens.push(ctx.accessToken);
      calls += 1;
      if (calls === 1) {
        throw new EbayApiError("IAF token supplied is expired.", 401, null, "GetItem");
      }
      return "ok";
    });
    expect(result).toBe("ok");
    expect(tokens).toEqual(["expired-iaf", "new-token"]);
    expect(mockAdapter.refreshAccessToken).toHaveBeenCalledOnce();
  });
});
