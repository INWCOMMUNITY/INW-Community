import { createHash } from "crypto";
import { SignJWT } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ACCESS = "12345678.etsy_access_token_value";
const REFRESH = "12345678.etsy_refresh_token_value";

vi.mock("database", () => ({
  prisma: {
    etsyConnection: {
      findFirst: vi.fn(),
    },
  },
  createEtsyOAuthState: vi.fn(),
  consumeEtsyOAuthState: vi.fn(),
  readEtsyOAuthBrowserBindingHash: vi.fn(),
  persistEtsyInstall: vi.fn(),
  rotateEtsyTokenMaterial: vi.fn(),
}));

vi.mock("@/lib/encrypt", () => ({
  encrypt: (value: string) => `enc:${value}`,
  decrypt: (value: string) => value.replace(/^enc:/, ""),
}));

import {
  consumeEtsyOAuthState,
  createEtsyOAuthState,
  persistEtsyInstall,
  readEtsyOAuthBrowserBindingHash,
} from "database";
import { completeEtsyOAuth, beginEtsyConnect, toPublicEtsyConnection } from "./connect";
import { createEtsyCodeChallenge, createEtsyCodeVerifier } from "./pkce";
import { signEtsyOAuthState, verifyEtsyOAuthState } from "./oauth-state";
import { missingEtsyScopes } from "./scopes";
import { readEtsyAppConfig } from "./config";

const BROWSER_SECRET = "ab".repeat(32);
const BROWSER_HASH = createHash("sha256").update(BROWSER_SECRET, "utf8").digest("hex");
const CODE_VERIFIER = "v".repeat(43);

const config = {
  apiKey: "etsy-keystring",
  clientSecret: "etsy-shared-secret",
  clientId: "etsy-keystring",
  appUrl: "https://app.example.com",
  redirectUri: "https://app.example.com/api/etsy/oauth/callback",
  providerEvidenceWebhookUri: "https://app.example.com/api/etsy/webhooks/inbox",
  scopes: ["listings_r", "listings_w", "shops_r", "transactions_r"],
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("etsy config", () => {
  it("requires api key, secret, and app url", () => {
    expect(
      readEtsyAppConfig({
        ETSY_API_KEY: "key",
        ETSY_CLIENT_SECRET: "secret",
        ETSY_APP_URL: "https://www.inwcommunity.com",
      })
    ).toMatchObject({
      apiKey: "key",
      redirectUri: "https://www.inwcommunity.com/api/etsy/oauth/callback",
    });
    expect(readEtsyAppConfig({ ETSY_API_KEY: "key" })).toBeNull();
  });

  it("allows ETSY_REDIRECT_URI override", () => {
    const cfg = readEtsyAppConfig({
      ETSY_API_KEY: "key",
      ETSY_CLIENT_SECRET: "secret",
      ETSY_APP_URL: "https://www.inwcommunity.com",
      ETSY_REDIRECT_URI: "https://www.inwcommunity.com/api/etsy/oauth/callback",
    });
    expect(cfg?.redirectUri).toBe("https://www.inwcommunity.com/api/etsy/oauth/callback");
  });
});

describe("pkce", () => {
  it("creates a verifier and matching S256 challenge", () => {
    const verifier = createEtsyCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(createEtsyCodeChallenge(verifier)).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("oauth state", () => {
  beforeEach(() => {
    process.env.NEXTAUTH_SECRET = "test-nextauth-secret-value";
  });

  it("accepts a signed state for the same member", async () => {
    const state = await signEtsyOAuthState({
      memberId: "member-a",
      nonce: "a".repeat(64),
    });
    await expect(verifyEtsyOAuthState(state)).resolves.toEqual({
      memberId: "member-a",
      nonce: "a".repeat(64),
    });
  });

  it("rejects an expired state", async () => {
    const state = await new SignJWT({ nonce: "b".repeat(64) })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("member-a")
      .setIssuer("nwc-etsy-oauth")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 120)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(process.env.NEXTAUTH_SECRET));
    await expect(verifyEtsyOAuthState(state)).resolves.toBeNull();
  });
});

describe("scopes", () => {
  it("requires every requested scope to be granted", () => {
    expect(missingEtsyScopes("listings_r listings_w shops_r transactions_r")).toEqual([]);
    expect(missingEtsyScopes("listings_r shops_r")).toEqual(["listings_w", "transactions_r"]);
  });
});

describe("oauth connect + callback", () => {
  beforeEach(() => {
    process.env.NEXTAUTH_SECRET = "test-nextauth-secret-value";
    process.env.ENCRYPTION_KEY = "test-encryption-key-value";
    vi.mocked(createEtsyOAuthState).mockReset();
    vi.mocked(consumeEtsyOAuthState).mockReset();
    vi.mocked(persistEtsyInstall).mockReset();
    vi.mocked(readEtsyOAuthBrowserBindingHash).mockReset();
    vi.mocked(readEtsyOAuthBrowserBindingHash).mockResolvedValue(BROWSER_HASH);
    vi.mocked(consumeEtsyOAuthState).mockResolvedValue({
      status: "ok",
      codeVerifierEncrypted: `enc:${CODE_VERIFIER}`,
    });
    vi.mocked(persistEtsyInstall).mockImplementation(async (_db, input) => ({
      id: "conn-1",
      memberId: input.memberId,
      etsyUserId: input.etsyUserId,
      shopId: input.shopId,
      shopName: input.shopName ?? null,
      generation: 1,
      grantedScopes: input.grantedScopes,
      status: "ACTIVE",
      connectedAt: new Date("2026-09-30T00:00:00Z"),
      disconnectedAt: null,
      accessTokenExpiresAt: input.accessTokenExpiresAt,
      refreshTokenExpiresAt: input.refreshTokenExpiresAt,
      createdAt: new Date("2026-09-30T00:00:00Z"),
      updatedAt: new Date("2026-09-30T00:00:00Z"),
    }));
  });

  it("beginEtsyConnect issues authorize URL with PKCE", async () => {
    const result = await beginEtsyConnect("member-a", { config });
    const url = new URL(result.authorizeUrl);
    expect(url.origin + url.pathname).toBe("https://www.etsy.com/oauth/connect");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe(config.clientId);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("scope")).toContain("listings_w");
    expect(result.browserBindingSecret).toHaveLength(64);
    expect(createEtsyOAuthState).toHaveBeenCalledOnce();
  });

  it("completeEtsyOAuth exchanges code, verifies shop, and persists install", async () => {
    const state = await signEtsyOAuthState({
      memberId: "member-a",
      nonce: "c".repeat(64),
    });
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      const href = String(url);
      if (href.includes("/oauth/token")) {
        return jsonResponse({
          access_token: ACCESS,
          refresh_token: REFRESH,
          expires_in: 3600,
          token_type: "Bearer",
          scope: "listings_r listings_w shops_r transactions_r",
        });
      }
      if (href.includes("/users/12345678/shops")) {
        return jsonResponse({ shop_id: 999, shop_name: "Demo Shop" });
      }
      return jsonResponse({ error: "unexpected" }, 500);
    });

    const connection = await completeEtsyOAuth(
      new URLSearchParams({ code: "auth-code", state }),
      { config, fetchImpl, browserBindingSecret: BROWSER_SECRET }
    );

    expect(connection.shopId).toBe("999");
    expect(connection.etsyUserId).toBe("12345678");
    expect(persistEtsyInstall).toHaveBeenCalledOnce();
    expect(toPublicEtsyConnection(connection)).toMatchObject({
      shopId: "999",
      shopName: "Demo Shop",
      status: "ACTIVE",
    });
  });

  it("rejects callback when browser binding cookie is missing", async () => {
    const state = await signEtsyOAuthState({
      memberId: "member-a",
      nonce: "d".repeat(64),
    });
    await expect(
      completeEtsyOAuth(new URLSearchParams({ code: "auth-code", state }), {
        config,
        browserBindingSecret: null,
      })
    ).rejects.toMatchObject({ code: "invalid_state", reason: "BROWSER_BINDING_COOKIE_MISSING" });
  });
});
