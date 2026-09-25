import { beforeEach, describe, expect, it, vi } from "vitest";

const ACCESS = "shpat_test_access_token_value";

vi.mock("database", async () => {
  const actual = await vi.importActual<typeof import("database")>("database");
  return {
    ...actual,
    prisma: {
      shopifyConnection: { findUnique: vi.fn() },
      shopifyVariantMap: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
      shopifyListingLink: { findUnique: vi.fn() },
    },
    markShopifyInventoryProjectionApplied: vi.fn(async () => true),
    markShopifyInventoryProjectionRemoteDrift: vi.fn(async () => undefined),
    setShopifyInventoryProjectionPendingMutation: vi.fn(async () => undefined),
    clearShopifyInventoryProjectionPendingMutation: vi.fn(async () => undefined),
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

import {
  clearShopifyInventoryProjectionPendingMutation,
  markShopifyInventoryProjectionApplied,
  markShopifyInventoryProjectionRemoteDrift,
  prisma,
  setShopifyInventoryProjectionPendingMutation,
} from "database";
import { handleShopifyProjectInventoryJob } from "./project-inventory";
import { SHOPIFY_ADMIN_API_VERSION } from "./constants";

const connection = {
  id: "conn-s8",
  memberId: "member-a",
  status: "ACTIVE",
  primaryLocationId: "gid://shopify/Location/1",
};

function baseMap(over: Record<string, unknown> = {}) {
  return {
    id: "vmap-s8",
    shopifyConnectionId: "conn-s8",
    shopifyListingLinkId: "link-1",
    memberId: "member-a",
    storeItemId: "item-1",
    storeVariantId: "var-1",
    shopifyVariantId: "gid://shopify/ProductVariant/8",
    shopifyInventoryItemId: "gid://shopify/InventoryItem/7",
    inventoryDesiredVersion: 2,
    inventoryDesiredAvailable: 10,
    inventoryAppliedVersion: 1,
    inventoryAppliedAvailable: 10,
    inventoryLastObservedAvailable: 10,
    inventoryInitState: "INITIALIZED",
    inventoryDriftState: "NONE",
    inventoryDriftCode: null,
    inventoryDriftMessage: null,
    inventoryDriftDetectedAt: null,
    inventoryPendingMutationKind: null,
    inventoryPendingIdempotencyKey: null,
    inventoryPendingChangeFrom: null,
    inventoryPendingTargetQty: null,
    inventoryPendingFingerprint: null,
    ...over,
  };
}

function claim(over: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    shopifyConnectionId: "conn-s8",
    kind: "PROJECT_INVENTORY" as const,
    dedupeKey: "PROJECT_INVENTORY:conn-s8:var-1:v2",
    evidenceId: null,
    payload: {
      storeItemId: "item-1",
      storeVariantId: "var-1",
      inventoryDesiredVersion: 2,
    },
    payloadHash: null,
    state: "RUNNING" as const,
    attemptCount: 1,
    maxAttempts: 8,
    leaseOwner: "w1",
    leaseToken: "tok",
    leaseExpiresAt: new Date("2099-01-01T00:00:00Z"),
    ...over,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "X-Request-Id": "req-s8" },
  });
}

function inventoryRead(available: number | null, tracked = true, level = true) {
  return {
    data: {
      inventoryItem: {
        id: "gid://shopify/InventoryItem/7",
        tracked,
        inventoryLevel: level
          ? {
              id: "gid://shopify/InventoryLevel/1",
              quantities:
                available == null ? [] : [{ name: "available", quantity: available }],
            }
          : null,
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.shopifyConnection.findUnique).mockResolvedValue(connection as never);
  vi.mocked(prisma.shopifyVariantMap.findUnique).mockResolvedValue(baseMap() as never);
  vi.mocked(prisma.shopifyListingLink.findUnique).mockResolvedValue({
    inventoryHealth: "HEALTHY",
  } as never);
});

describe("handleShopifyProjectInventoryJob", () => {
  it("sale-before-S7: remote 8 with desired/applied 10 → zero inventorySetQuantities, records drift", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(inventoryRead(8)));
    const result = await handleShopifyProjectInventoryJob(claim(), { fetchImpl });
    expect(result).toEqual({ outcome: "SUCCESS" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetchImpl.mock.calls[0][1] as RequestInit).body));
    expect(body.query).toContain("ShopifyInventoryProjectionRead");
    expect(body.query).not.toContain("inventorySetQuantities");
    expect(markShopifyInventoryProjectionRemoteDrift).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        variantMapId: "vmap-s8",
        remoteAvailable: 8,
        code: "REMOTE_DRIFT",
      })
    );
    expect(markShopifyInventoryProjectionApplied).not.toHaveBeenCalled();
  });

  it("S7 catch-up: remote already desired → no set mutation, mark applied and clear drift", async () => {
    vi.mocked(prisma.shopifyVariantMap.findUnique).mockResolvedValue(
      baseMap({
        inventoryDesiredAvailable: 8,
        inventoryAppliedAvailable: 10,
        inventoryDriftState: "NONE",
      }) as never
    );
    const fetchImpl = vi.fn(async () => jsonResponse(inventoryRead(8)));
    const result = await handleShopifyProjectInventoryJob(claim(), { fetchImpl });
    expect(result).toEqual({ outcome: "SUCCESS" });
    expect(JSON.parse(String((fetchImpl.mock.calls[0][1] as RequestInit).body)).query).not.toContain(
      "inventorySetQuantities"
    );
    expect(markShopifyInventoryProjectionApplied).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        variantMapId: "vmap-s8",
        desiredVersion: 2,
        available: 8,
      })
    );
  });

  it("local sale SAFE_CAS: remote==applied base → inventorySetQuantities with changeFromQuantity", async () => {
    vi.mocked(prisma.shopifyVariantMap.findUnique).mockResolvedValue(
      baseMap({ inventoryDesiredAvailable: 9, inventoryAppliedAvailable: 10 }) as never
    );
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (String(body.query).includes("ShopifyInventoryProjectionRead")) {
        return jsonResponse(inventoryRead(10));
      }
      if (String(body.query).includes("inventorySetQuantities")) {
        expect(body.variables.input.quantities[0]).toMatchObject({
          quantity: 9,
          changeFromQuantity: 10,
        });
        expect(body.variables.input.reason).toBe("correction");
        expect(body.query).toContain("@idempotent");
        return jsonResponse({
          data: {
            inventorySetQuantities: {
              inventoryAdjustmentGroup: { reason: "correction" },
              userErrors: [],
            },
          },
        });
      }
      throw new Error(`unexpected op ${(input as string) ?? ""}`);
    });
    const result = await handleShopifyProjectInventoryJob(claim(), { fetchImpl });
    expect(result).toEqual({ outcome: "SUCCESS" });
    expect(setShopifyInventoryProjectionPendingMutation).toHaveBeenCalled();
    expect(markShopifyInventoryProjectionApplied).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ available: 9, desiredVersion: 2 })
    );
  });

  it("CAS stale: CHANGE_FROM_QUANTITY_STALE clears pending and retries without forcing overwrite", async () => {
    vi.mocked(prisma.shopifyVariantMap.findUnique).mockResolvedValue(
      baseMap({ inventoryDesiredAvailable: 8, inventoryAppliedAvailable: 10 }) as never
    );
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (String(body.query).includes("ShopifyInventoryProjectionRead")) {
        return jsonResponse(inventoryRead(10));
      }
      return jsonResponse({
        data: {
          inventorySetQuantities: {
            inventoryAdjustmentGroup: null,
            userErrors: [
              {
                code: "CHANGE_FROM_QUANTITY_STALE",
                message: "The compared quantity does not match",
              },
            ],
          },
        },
      });
    });
    const result = await handleShopifyProjectInventoryJob(claim(), { fetchImpl });
    expect(result).toMatchObject({
      outcome: "RETRY",
      errorCode: "CHANGE_FROM_QUANTITY_STALE",
    });
    expect(clearShopifyInventoryProjectionPendingMutation).toHaveBeenCalled();
    expect(markShopifyInventoryProjectionApplied).not.toHaveBeenCalled();
  });

  it("NETWORK_UNKNOWN then remote already desired → mark applied without re-mutating", async () => {
    vi.mocked(prisma.shopifyVariantMap.findUnique).mockResolvedValue(
      baseMap({
        inventoryDesiredAvailable: 9,
        inventoryAppliedAvailable: 10,
        inventoryPendingMutationKind: "SET",
        inventoryPendingIdempotencyKey: "pending-key",
        inventoryPendingChangeFrom: 10,
        inventoryPendingTargetQty: 9,
      }) as never
    );
    const fetchImpl = vi.fn(async () => jsonResponse(inventoryRead(9)));
    const result = await handleShopifyProjectInventoryJob(claim(), { fetchImpl });
    expect(result).toEqual({ outcome: "SUCCESS" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(markShopifyInventoryProjectionApplied).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ available: 9 })
    );
  });

  it("stale job version performs zero provider mutation", async () => {
    vi.mocked(prisma.shopifyVariantMap.findUnique).mockResolvedValue(
      baseMap({ inventoryDesiredVersion: 5 }) as never
    );
    const fetchImpl = vi.fn();
    const result = await handleShopifyProjectInventoryJob(
      claim({
        payload: { storeItemId: "item-1", storeVariantId: "var-1", inventoryDesiredVersion: 2 },
      }),
      { fetchImpl }
    );
    expect(result).toEqual({ outcome: "SUCCESS" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("disconnected generation is DEAD without mutation", async () => {
    vi.mocked(prisma.shopifyConnection.findUnique).mockResolvedValue({
      ...connection,
      status: "DISCONNECTED",
    } as never);
    const fetchImpl = vi.fn();
    const result = await handleShopifyProjectInventoryJob(claim(), { fetchImpl });
    expect(result).toMatchObject({ outcome: "DEAD", errorCode: "CONNECTION_INACTIVE" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("initial activate uses @idempotent and marks applied", async () => {
    vi.mocked(prisma.shopifyVariantMap.findUnique).mockResolvedValue(
      baseMap({
        inventoryInitState: "PENDING",
        inventoryDesiredVersion: 1,
        inventoryDesiredAvailable: 10,
        inventoryAppliedVersion: 0,
        inventoryAppliedAvailable: null,
      }) as never
    );
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (String(body.query).includes("ShopifyInventoryProjectionRead")) {
        return jsonResponse(inventoryRead(null, true, false));
      }
      expect(body.query).toContain("inventoryActivate");
      expect(body.query).toContain("@idempotent");
      expect(body.variables.available).toBe(10);
      return jsonResponse({
        data: {
          inventoryActivate: {
            inventoryLevel: {
              id: "gid://shopify/InventoryLevel/1",
              quantities: [{ name: "available", quantity: 10 }],
            },
            userErrors: [],
          },
        },
      });
    });
    const result = await handleShopifyProjectInventoryJob(
      claim({
        payload: { storeItemId: "item-1", storeVariantId: "var-1", inventoryDesiredVersion: 1 },
        dedupeKey: "PROJECT_INVENTORY:conn-s8:var-1:v1",
      }),
      { fetchImpl }
    );
    expect(result).toEqual({ outcome: "SUCCESS" });
    expect(markShopifyInventoryProjectionApplied).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ available: 10, desiredVersion: 1 })
    );
  });

  it("MTO NOT_APPLICABLE skips network", async () => {
    vi.mocked(prisma.shopifyVariantMap.findUnique).mockResolvedValue(
      baseMap({
        inventoryInitState: "NOT_APPLICABLE",
        inventoryDesiredAvailable: null,
        inventoryDesiredVersion: 0,
      }) as never
    );
    const fetchImpl = vi.fn();
    // payload version < 1 is invalid; use matching version 0 path via early NOT_APPLICABLE after version check
    // Force version match by setting desiredVersion 1 on map but NOT_APPLICABLE
    vi.mocked(prisma.shopifyVariantMap.findUnique).mockResolvedValue(
      baseMap({
        inventoryInitState: "NOT_APPLICABLE",
        inventoryDesiredVersion: 2,
        inventoryDesiredAvailable: null,
      }) as never
    );
    const result = await handleShopifyProjectInventoryJob(claim(), { fetchImpl });
    expect(result).toEqual({ outcome: "SUCCESS" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses Admin API 2026-07 endpoint", async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url)).toContain(`/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`);
      return jsonResponse(inventoryRead(10));
    });
    vi.mocked(prisma.shopifyVariantMap.findUnique).mockResolvedValue(
      baseMap({ inventoryDesiredAvailable: 10 }) as never
    );
    await handleShopifyProjectInventoryJob(claim(), { fetchImpl });
  });
});
