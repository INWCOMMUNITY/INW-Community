import { beforeEach, describe, expect, it, vi } from "vitest";

const ACCESS = "shpat_test_access_token_value";

vi.mock("database", async () => {
  const actual = await vi.importActual<typeof import("database")>("database");
  return {
    ...actual,
    prisma: {
      shopifyConnection: { findUnique: vi.fn() },
      shopifyListingLink: { findFirst: vi.fn(), findUnique: vi.fn() },
      shopifyVariantMap: { findMany: vi.fn() },
      shopifyOrderLineSaleFact: { findFirst: vi.fn() },
      storeItem: { findUnique: vi.fn() },
    },
    persistShopifyListingHealth: vi.fn(async () => ({
      previous: { readiness: "SYNCING", issueCode: null, issueFingerprint: null },
      next: { readiness: "READY_TO_PUBLISH", issueCode: null },
      issueChanged: false,
      issueCleared: false,
      issueOpened: false,
    })),
    ensureShopifyUpdateListingContentJob: vi.fn(),
    ensureShopifyProjectInventoryJob: vi.fn(),
  };
});

vi.mock("./connect", () => ({
  accessTokenForConnection: vi.fn(async () => ACCESS),
  ShopifyConnectError: class ShopifyConnectError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  },
}));

vi.mock("./listing-issue-notify", () => ({
  notifyShopifyListingIssueOnce: vi.fn(async () => ({ created: false })),
}));

import { persistShopifyListingHealth, prisma } from "database";
import { handleShopifyReconcileListingJob } from "./reconcile-listing";
import { notifyShopifyListingIssueOnce } from "./listing-issue-notify";

const connection = {
  id: "conn-s9",
  memberId: "member-a",
  status: "ACTIVE",
  primaryLocationId: "gid://shopify/Location/1",
};

const listing = {
  id: "link-1",
  shopifyConnectionId: "conn-s9",
  memberId: "member-a",
  storeItemId: "item-1",
  shopifyProductId: "gid://shopify/Product/9",
  desiredProductContentVersion: 1,
  appliedProductContentVersion: 1,
  desiredProductFingerprint: "p",
  appliedProductFingerprint: "p",
  productContentConflict: false,
  readiness: "SYNCING",
  contentHealth: "HEALTHY",
  inventoryHealth: "HEALTHY",
  issueCode: null,
  issueFingerprint: null,
  issueFirstSeenAt: null,
  remoteProductStatus: null,
};

const variantMap = {
  id: "vmap-1",
  shopifyConnectionId: "conn-s9",
  shopifyListingLinkId: "link-1",
  memberId: "member-a",
  storeItemId: "item-1",
  storeVariantId: "var-1",
  shopifyVariantId: "gid://shopify/ProductVariant/8",
  shopifyInventoryItemId: "gid://shopify/InventoryItem/7",
  desiredVariantContentVersion: 1,
  appliedVariantContentVersion: 1,
  desiredVariantFingerprint: "v",
  appliedVariantFingerprint: "v",
  variantContentConflict: false,
  inventoryInitState: "INITIALIZED",
  inventoryDesiredVersion: 1,
  inventoryAppliedVersion: 1,
  inventoryDesiredAvailable: 10,
  inventoryAppliedAvailable: 10,
  inventoryDriftState: "NONE",
};

function claim() {
  return {
    id: "job-r1",
    shopifyConnectionId: "conn-s9",
    kind: "RECONCILE_LISTING" as const,
    dedupeKey: "RECONCILE_LISTING:conn-s9:link-1:b1",
    evidenceId: null,
    payload: { listingLinkId: "link-1", storeItemId: "item-1" },
    payloadHash: null,
    state: "RUNNING" as const,
    attemptCount: 1,
    maxAttempts: 8,
    leaseOwner: "w1",
    leaseToken: "tok",
    leaseExpiresAt: new Date("2099-01-01T00:00:00Z"),
  };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.shopifyConnection.findUnique).mockResolvedValue(connection as never);
  vi.mocked(prisma.shopifyListingLink.findFirst).mockResolvedValue(listing as never);
  vi.mocked(prisma.shopifyVariantMap.findMany).mockResolvedValue([variantMap] as never);
  vi.mocked(prisma.shopifyOrderLineSaleFact.findFirst).mockResolvedValue(null);
});

describe("handleShopifyReconcileListingJob", () => {
  it("healthy physical listing persists READY_TO_PUBLISH with zero mutations", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        data: {
          product: {
            id: "gid://shopify/Product/9",
            status: "DRAFT",
            title: "T",
            descriptionHtml: "",
            variants: {
              nodes: [
                {
                  id: "gid://shopify/ProductVariant/8",
                  price: "12.00",
                  sku: "SKU",
                  inventoryItem: { id: "gid://shopify/InventoryItem/7", tracked: true },
                },
              ],
            },
          },
          inventoryItem: {
            id: "gid://shopify/InventoryItem/7",
            tracked: true,
            inventoryLevel: {
              id: "lvl",
              quantities: [{ name: "available", quantity: 10 }],
            },
          },
        },
      })
    );
    const result = await handleShopifyReconcileListingJob(claim(), { fetchImpl, notify: true });
    expect(result).toEqual({ outcome: "SUCCESS" });
    expect(String((fetchImpl.mock.calls[0][1] as RequestInit).body)).toContain(
      "ShopifyListingReconcileRead"
    );
    expect(String((fetchImpl.mock.calls[0][1] as RequestInit).body)).not.toContain("mutation");
    expect(persistShopifyListingHealth).toHaveBeenCalled();
    expect(notifyShopifyListingIssueOnce).not.toHaveBeenCalled();
  });

  it("inventory drift notifies once and does not mutate quantity", async () => {
    vi.mocked(prisma.shopifyVariantMap.findMany).mockResolvedValue([
      { ...variantMap, inventoryDriftState: "REMOTE_DRIFT" },
    ] as never);
    vi.mocked(persistShopifyListingHealth).mockResolvedValue({
      previous: { readiness: "READY_TO_PUBLISH", issueCode: null, issueFingerprint: null },
      next: {
        readiness: "ACTION_REQUIRED",
        contentHealth: "HEALTHY",
        inventoryHealth: "PAUSED",
        issueCode: "INVENTORY_REMOTE_DRIFT",
        issueFingerprint: "fp",
        issueSeverity: "ACTION_REQUIRED",
        issueMessage: "drift",
        blockContentOutbound: false,
        blockInventoryOutbound: true,
        remoteProductStatus: "DRAFT",
      },
      issueChanged: true,
      issueCleared: false,
      issueOpened: true,
    } as never);
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        data: {
          product: {
            id: "gid://shopify/Product/9",
            status: "DRAFT",
            title: "T",
            descriptionHtml: "",
            variants: {
              nodes: [
                {
                  id: "gid://shopify/ProductVariant/8",
                  price: "12.00",
                  sku: "SKU",
                  inventoryItem: { id: "gid://shopify/InventoryItem/7", tracked: true },
                },
              ],
            },
          },
          inventoryItem: {
            id: "gid://shopify/InventoryItem/7",
            tracked: true,
            inventoryLevel: {
              id: "lvl",
              quantities: [{ name: "available", quantity: 8 }],
            },
          },
        },
      })
    );
    const result = await handleShopifyReconcileListingJob(claim(), { fetchImpl });
    expect(result).toEqual({ outcome: "SUCCESS" });
    expect(String((fetchImpl.mock.calls[0][1] as RequestInit).body)).not.toContain(
      "inventorySetQuantities"
    );
    expect(notifyShopifyListingIssueOnce).toHaveBeenCalledWith(
      expect.objectContaining({ issueCode: "INVENTORY_REMOTE_DRIFT" })
    );
  });

  it("provider transient → RETRY without listing pause notification", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 503 }));
    const result = await handleShopifyReconcileListingJob(claim(), { fetchImpl });
    expect(result.outcome).toBe("RETRY");
    expect(persistShopifyListingHealth).not.toHaveBeenCalled();
    expect(notifyShopifyListingIssueOnce).not.toHaveBeenCalled();
  });
});
