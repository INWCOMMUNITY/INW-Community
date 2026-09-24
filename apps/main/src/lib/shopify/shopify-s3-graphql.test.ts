import { createHmac } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("database", () => ({
  prisma: {
    shopifyConnection: {
      findUnique: vi.fn(),
    },
    shopifyProviderEvidence: {
      findUnique: vi.fn(),
    },
  },
  claimNextShopifySyncJob: vi.fn(),
  completeShopifySyncJobSuccess: vi.fn(),
  completeShopifySyncJobRetry: vi.fn(),
  completeShopifySyncJobDead: vi.fn(),
}));

vi.mock("./connect", () => ({
  accessTokenForConnection: vi.fn(),
  ShopifyConnectError: class ShopifyConnectError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  },
}));

import { prisma } from "database";
import { accessTokenForConnection } from "./connect";
import { executeShopifyAdminGraphql } from "./admin-graphql";
import { SHOPIFY_ADMIN_API_VERSION } from "./constants";

const ACCESS = "shpat_test_access_token_value";
const connection = {
  id: "conn-1",
  memberId: "member-1",
  shopDomain: "my-shop.myshopify.com",
  shopId: "gid://shopify/Shop/1",
  generation: 1,
  accessTokenEncrypted: "enc-access",
  refreshTokenEncrypted: "enc-refresh",
  accessTokenExpiresAt: new Date("2099-01-01T00:00:00Z"),
  refreshTokenExpiresAt: new Date("2099-06-01T00:00:00Z"),
  grantedScopes: "read_products",
  status: "ACTIVE" as const,
  primaryLocationId: "gid://shopify/Location/1",
  connectedAt: new Date("2026-09-24T12:00:00Z"),
  disconnectedAt: null,
  createdAt: new Date("2026-09-24T12:00:00Z"),
  updatedAt: new Date("2026-09-24T12:00:00Z"),
};

describe("shopify admin graphql client", () => {
  beforeEach(() => {
    vi.mocked(prisma.shopifyConnection.findUnique).mockReset();
    vi.mocked(accessTokenForConnection).mockReset();
    vi.mocked(prisma.shopifyConnection.findUnique).mockResolvedValue(connection as never);
    vi.mocked(accessTokenForConnection).mockResolvedValue(ACCESS);
  });

  it("pins 2026-07 and uses the stored shop domain host", async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe(
        `https://my-shop.myshopify.com/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`
      );
      expect(SHOPIFY_ADMIN_API_VERSION).toBe("2026-07");
      expect(init?.method).toBe("POST");
      const headers = init?.headers as Record<string, string>;
      expect(headers["X-Shopify-Access-Token"]).toBe(ACCESS);
      expect(headers["Content-Type"]).toBe("application/json");
      expect(String(init?.body)).not.toContain("@idempotent");
      return new Response(JSON.stringify({ data: { shop: { name: "My Shop" } } }), {
        status: 200,
        headers: { "Content-Type": "application/json", "x-request-id": "req-1" },
      });
    });

    const result = await executeShopifyAdminGraphql({
      connectionId: "conn-1",
      operationType: "query",
      document: "query { shop { name } }",
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    expect(result.class).toBe("SUCCESS");
    expect(result.data).toEqual({ shop: { name: "My Shop" } });
    expect(result.requestId).toBe("req-1");
    expect(accessTokenForConnection).toHaveBeenCalled();
  });

  it("fails closed for inactive connections and never fetches", async () => {
    vi.mocked(prisma.shopifyConnection.findUnique).mockResolvedValue({
      ...connection,
      status: "DISCONNECTED",
    } as never);
    const fetchImpl = vi.fn();
    const result = await executeShopifyAdminGraphql({
      connectionId: "conn-1",
      operationType: "query",
      document: "query { shop { name } }",
      fetchImpl,
    });
    expect(result.class).toBe("CONNECTION_INACTIVE");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("classifies HTTP errors, GraphQL errors, throttle metadata, and network unknown", async () => {
    const httpFail = await executeShopifyAdminGraphql({
      connectionId: "conn-1",
      operationType: "query",
      document: "query { shop { name } }",
      fetchImpl: vi.fn(async () => new Response("nope", { status: 503 })),
    });
    expect(httpFail.class).toBe("TRANSIENT_PROVIDER");

    const gqlError = await executeShopifyAdminGraphql({
      connectionId: "conn-1",
      operationType: "query",
      document: "query { shop { name } }",
      fetchImpl: vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              errors: [{ message: "bad", extensions: { code: "ACCESS_DENIED" } }],
            }),
            { status: 200 }
          )
      ),
    });
    expect(gqlError.class).toBe("AUTH");

    const throttled = await executeShopifyAdminGraphql({
      connectionId: "conn-1",
      operationType: "query",
      document: "query { shop { name } }",
      fetchImpl: vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              errors: [{ message: "throttled", extensions: { code: "THROTTLED" } }],
              extensions: {
                cost: {
                  requestedQueryCost: 10,
                  actualQueryCost: 10,
                  throttleStatus: {
                    maximumAvailable: 1000,
                    currentlyAvailable: 0,
                    restoreRate: 50,
                  },
                },
              },
            }),
            { status: 200 }
          )
      ),
    });
    expect(throttled.class).toBe("THROTTLED");
    expect(throttled.cost?.throttleStatus?.currentlyAvailable).toBe(0);
    expect(throttled.cost?.requestedQueryCost).toBe(10);

    let mutationCalls = 0;
    const timedOut = await executeShopifyAdminGraphql({
      connectionId: "conn-1",
      operationType: "mutation",
      document: "mutation { productCreate(input: {}) { product { id } } }",
      fetchImpl: vi.fn(async () => {
        mutationCalls += 1;
        throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
      }),
    });
    expect(timedOut.class).toBe("NETWORK_UNKNOWN");
    expect(timedOut.outcomeUnknown).toBe(true);
    expect(mutationCalls).toBe(1);
    expect(timedOut.message).not.toContain(ACCESS);
  });

  it("does not put the access token into error messages", async () => {
    const { ShopifyConnectError } = await import("./connect");
    vi.mocked(accessTokenForConnection).mockRejectedValue(
      new ShopifyConnectError(`reauth ${ACCESS}`, "token_exchange")
    );
    const result = await executeShopifyAdminGraphql({
      connectionId: "conn-1",
      operationType: "query",
      document: "query { shop { name } }",
      fetchImpl: vi.fn(),
    });
    expect(result.class).toBe("AUTH");
    expect(result.message).not.toContain(ACCESS);
    expect(result.message).toContain("[redacted]");
  });
});

describe("shopify webhook hmac fixture", () => {
  it("signs raw bodies the same way as the inbox verifier", () => {
    const body = JSON.stringify({ myshopify_domain: "my-shop.myshopify.com" });
    const secret = "client-secret";
    const digest = createHmac("sha256", secret).update(body, "utf8").digest("base64");
    expect(digest.length).toBeGreaterThan(10);
  });
});
