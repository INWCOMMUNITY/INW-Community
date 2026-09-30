import { beforeEach, describe, expect, it, vi } from "vitest";

const ACCESS = "shpat_test_access_token_value";
const INBOX = "https://www.inwcommunity.com/api/shopify/webhooks/inbox";
const UNINSTALL = "https://www.inwcommunity.com/api/shopify/webhooks/uninstalled";

vi.mock("database", () => ({
  prisma: {
    shopifyConnection: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("./client", async () => {
  const actual = await vi.importActual<typeof import("./client")>("./client");
  return {
    ...actual,
    registerShopifyUninstallWebhook: vi.fn(async () => undefined),
    ensureShopifyProductsUpdateWebhook: vi.fn(async () => ({
      status: "REUSED",
      subscriptionId: "gid://shopify/WebhookSubscription/products",
    })),
    ensureShopifyOrdersPaidWebhook: vi.fn(async () => ({
      status: "REUSED",
      subscriptionId: "gid://shopify/WebhookSubscription/orders",
    })),
    ensureShopifyInventoryLevelsUpdateWebhook: vi.fn(async () => ({
      status: "CREATED",
      subscriptionId: "gid://shopify/WebhookSubscription/inventory",
    })),
  };
});

vi.mock("./connect", async () => {
  const actual = await vi.importActual<typeof import("./connect")>("./connect");
  return {
    ...actual,
    accessTokenForConnection: vi.fn(async () => ACCESS),
  };
});

vi.mock("./config", () => ({
  readShopifyAppConfig: vi.fn(() => ({
    clientId: "cid",
    clientSecret: "csec",
    appUrl: "https://www.inwcommunity.com",
    redirectUri: "https://www.inwcommunity.com/api/shopify/oauth/callback",
    uninstallWebhookUri: UNINSTALL,
    providerEvidenceWebhookUri: INBOX,
    scopes: ["read_products", "read_inventory"],
    apiVersion: "2026-07",
  })),
}));

import { prisma } from "database";
import {
  ensureShopifyInventoryLevelsUpdateWebhook,
  ensureShopifyOrdersPaidWebhook,
  ensureShopifyProductsUpdateWebhook,
  registerShopifyUninstallWebhook,
  ShopifyRequestError,
} from "./client";
import { accessTokenForConnection } from "./connect";
import {
  ensureRequiredShopifyWebhooks,
  reconcileActiveShopifyConnectionWebhooks,
} from "./ensure-required-webhooks";

const activeConn = {
  id: "conn-active-2",
  memberId: "mem-1",
  shopDomain: "jpuhtv-df.myshopify.com",
  shopId: "gid://shopify/Shop/9",
  generation: 2,
  accessTokenEncrypted: "enc-a",
  refreshTokenEncrypted: "enc-r",
  accessTokenExpiresAt: new Date("2099-01-01T00:00:00Z"),
  refreshTokenExpiresAt: new Date("2099-01-01T00:00:00Z"),
  grantedScopes: "read_products,write_products,read_orders,read_inventory",
  status: "ACTIVE" as const,
  primaryLocationId: "gid://shopify/Location/1",
  connectedAt: new Date("2026-09-01T00:00:00Z"),
  disconnectedAt: null,
  createdAt: new Date("2026-09-01T00:00:00Z"),
  updatedAt: new Date("2026-09-01T00:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(accessTokenForConnection).mockResolvedValue(ACCESS);
  vi.mocked(registerShopifyUninstallWebhook).mockResolvedValue(undefined);
  vi.mocked(ensureShopifyProductsUpdateWebhook).mockResolvedValue({
    status: "REUSED",
    subscriptionId: "gid://shopify/WebhookSubscription/products",
  });
  vi.mocked(ensureShopifyOrdersPaidWebhook).mockResolvedValue({
    status: "REUSED",
    subscriptionId: "gid://shopify/WebhookSubscription/orders",
  });
  vi.mocked(ensureShopifyInventoryLevelsUpdateWebhook).mockResolvedValue({
    status: "CREATED",
    subscriptionId: "gid://shopify/WebhookSubscription/inventory",
  });
});

describe("ensureRequiredShopifyWebhooks", () => {
  it("12: existing pre-inventory connection gains exactly one INVENTORY_LEVELS_UPDATE", async () => {
    const result = await ensureRequiredShopifyWebhooks({
      shopDomain: activeConn.shopDomain,
      accessToken: ACCESS,
      uninstallWebhookUri: UNINSTALL,
      providerEvidenceWebhookUri: INBOX,
      grantedScopes: activeConn.grantedScopes,
    });

    expect(registerShopifyUninstallWebhook).toHaveBeenCalledTimes(1);
    expect(ensureShopifyProductsUpdateWebhook).toHaveBeenCalledTimes(1);
    expect(ensureShopifyOrdersPaidWebhook).toHaveBeenCalledTimes(1);
    expect(ensureShopifyInventoryLevelsUpdateWebhook).toHaveBeenCalledTimes(1);
    expect(ensureShopifyInventoryLevelsUpdateWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        shopDomain: activeConn.shopDomain,
        callbackUrl: INBOX,
      })
    );
    expect(result.ok).toBe(true);
    expect(result.createdTopics).toEqual(["INVENTORY_LEVELS_UPDATE"]);
    expect(result.results.find((r) => r.topic === "INVENTORY_LEVELS_UPDATE")?.status).toBe("CREATED");
  });

  it("13: repeated ensure is idempotent (no second inventory create)", async () => {
    vi.mocked(ensureShopifyInventoryLevelsUpdateWebhook).mockResolvedValue({
      status: "REUSED",
      subscriptionId: "gid://shopify/WebhookSubscription/inventory",
    });

    const first = await ensureRequiredShopifyWebhooks({
      shopDomain: activeConn.shopDomain,
      accessToken: ACCESS,
      uninstallWebhookUri: UNINSTALL,
      providerEvidenceWebhookUri: INBOX,
      grantedScopes: activeConn.grantedScopes,
    });
    const second = await ensureRequiredShopifyWebhooks({
      shopDomain: activeConn.shopDomain,
      accessToken: ACCESS,
      uninstallWebhookUri: UNINSTALL,
      providerEvidenceWebhookUri: INBOX,
      grantedScopes: activeConn.grantedScopes,
    });

    expect(first.createdTopics).toEqual([]);
    expect(second.createdTopics).toEqual([]);
    expect(ensureShopifyInventoryLevelsUpdateWebhook).toHaveBeenCalledTimes(2);
    expect(first.ok && second.ok).toBe(true);
  });

  it("15: temporary provider failure does not invent reconnect / keeps other topics", async () => {
    vi.mocked(ensureShopifyInventoryLevelsUpdateWebhook).mockRejectedValue(
      new ShopifyRequestError("Shopify INVENTORY_LEVELS_UPDATE webhook registration failed: throttled")
    );

    const result = await ensureRequiredShopifyWebhooks({
      shopDomain: activeConn.shopDomain,
      accessToken: ACCESS,
      uninstallWebhookUri: UNINSTALL,
      providerEvidenceWebhookUri: INBOX,
      grantedScopes: activeConn.grantedScopes,
    });

    expect(result.ok).toBe(false);
    expect(result.results.find((r) => r.topic === "PRODUCTS_UPDATE")?.status).toBe("REUSED");
    expect(result.results.find((r) => r.topic === "INVENTORY_LEVELS_UPDATE")).toMatchObject({
      status: "FAILED",
      errorCode: "INVENTORY_LEVELS_UPDATE_ENSURE_FAILED",
    });
  });

  it("16: missing read_inventory fails safely without calling inventory ensure", async () => {
    const result = await ensureRequiredShopifyWebhooks({
      shopDomain: activeConn.shopDomain,
      accessToken: ACCESS,
      uninstallWebhookUri: UNINSTALL,
      providerEvidenceWebhookUri: INBOX,
      grantedScopes: "read_products,write_products,read_orders",
    });

    expect(ensureShopifyInventoryLevelsUpdateWebhook).not.toHaveBeenCalled();
    expect(result.missingScopes).toContain("read_inventory");
    expect(result.results.find((r) => r.topic === "INVENTORY_LEVELS_UPDATE")).toMatchObject({
      status: "SKIPPED_MISSING_SCOPE",
      errorCode: "MISSING_READ_INVENTORY",
    });
  });

  it("16b: provider permission error maps to missing read_inventory", async () => {
    vi.mocked(ensureShopifyInventoryLevelsUpdateWebhook).mockRejectedValue(
      new ShopifyRequestError(
        "Shopify INVENTORY_LEVELS_UPDATE webhook registration failed: Access denied for inventory topic"
      )
    );

    const result = await ensureRequiredShopifyWebhooks({
      shopDomain: activeConn.shopDomain,
      accessToken: ACCESS,
      uninstallWebhookUri: UNINSTALL,
      providerEvidenceWebhookUri: INBOX,
      grantedScopes: activeConn.grantedScopes,
    });

    expect(result.results.find((r) => r.topic === "INVENTORY_LEVELS_UPDATE")).toMatchObject({
      status: "SKIPPED_MISSING_SCOPE",
      errorCode: "MISSING_READ_INVENTORY",
    });
    expect(result.missingScopes).toContain("read_inventory");
  });
});

describe("reconcileActiveShopifyConnectionWebhooks", () => {
  it("12/14: only ACTIVE current generation is ensured; DISCONNECTED ignored", async () => {
    vi.mocked(prisma.shopifyConnection.findMany).mockImplementation(async (args: { where?: { status?: string } }) => {
      expect(args.where?.status).toBe("ACTIVE");
      return [activeConn] as never;
    });

    const result = await reconcileActiveShopifyConnectionWebhooks({
      fetchImpl: vi.fn() as never,
    });

    expect(result.checked).toBe(1);
    expect(result.repaired).toBe(1);
    expect(result.connectionResults[0]).toMatchObject({
      connectionId: "conn-active-2",
      generation: 2,
      ok: true,
      createdTopics: ["INVENTORY_LEVELS_UPDATE"],
    });
    expect(accessTokenForConnection).toHaveBeenCalledWith(
      expect.objectContaining({ id: "conn-active-2", generation: 2, status: "ACTIVE" }),
      expect.anything()
    );
    // Query filter is ACTIVE-only — generation 1 DISCONNECTED never loaded.
    expect(prisma.shopifyConnection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: "ACTIVE" }) })
    );
  });

  it("13: repeated reconciliation does not create duplicates when inventory already present", async () => {
    vi.mocked(prisma.shopifyConnection.findMany).mockResolvedValue([activeConn] as never);
    vi.mocked(ensureShopifyInventoryLevelsUpdateWebhook).mockResolvedValue({
      status: "REUSED",
      subscriptionId: "gid://shopify/WebhookSubscription/inventory",
    });

    const first = await reconcileActiveShopifyConnectionWebhooks();
    const second = await reconcileActiveShopifyConnectionWebhooks();

    expect(first.repaired).toBe(0);
    expect(second.repaired).toBe(0);
    expect(first.ok).toBe(1);
    expect(second.ok).toBe(1);
  });

  it("15: temporary failure leaves connection identity untouched (no OAuth path)", async () => {
    vi.mocked(prisma.shopifyConnection.findMany).mockResolvedValue([activeConn] as never);
    vi.mocked(ensureShopifyInventoryLevelsUpdateWebhook).mockRejectedValue(
      new ShopifyRequestError("Shopify INVENTORY_LEVELS_UPDATE webhook registration failed: 503")
    );

    const result = await reconcileActiveShopifyConnectionWebhooks();
    expect(result.failed).toBe(1);
    expect(result.connectionResults[0]).toMatchObject({
      connectionId: "conn-active-2",
      generation: 2,
      ok: false,
    });
    // No reconnect helpers were invoked — only token+ensure.
    expect(accessTokenForConnection).toHaveBeenCalledTimes(1);
  });
});
