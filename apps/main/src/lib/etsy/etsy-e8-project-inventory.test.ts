import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("database", async () => {
  const actual = await vi.importActual<typeof import("database")>("database");
  return {
    ...actual,
    prisma: {
      etsyConnection: { findUnique: vi.fn() },
      etsyListingLink: { findUnique: vi.fn(), update: vi.fn() },
      etsyVariantMap: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    },
    markEtsyInventoryProjectionApplied: vi.fn(),
  };
});

vi.mock("./connection-request", () => ({
  etsyConnectionRequest: vi.fn(),
}));

import { markEtsyInventoryProjectionApplied, prisma } from "database";
import { etsyConnectionRequest } from "./connection-request";
import { handleEtsyProjectInventoryJob } from "./project-inventory";

const claim = {
  id: "job-inv",
  etsyConnectionId: "conn-1",
  kind: "PROJECT_INVENTORY" as const,
  dedupeKey: "PROJECT_INVENTORY:conn-1:var-1:v1",
  evidenceId: null,
  payload: {
    storeItemId: "item-1",
    storeVariantId: "var-1",
    inventoryDesiredVersion: 1,
  },
  payloadHash: null,
  state: "RUNNING" as const,
  attemptCount: 1,
  maxAttempts: 8,
  leaseOwner: "w1",
  leaseToken: "tok",
  leaseExpiresAt: new Date("2099-01-01T00:00:00Z"),
};

describe("etsy PROJECT_INVENTORY handler", () => {
  beforeEach(() => {
    vi.mocked(prisma.etsyConnection.findUnique).mockReset();
    vi.mocked(prisma.etsyListingLink.findUnique).mockReset();
    vi.mocked(prisma.etsyListingLink.update).mockReset();
    vi.mocked(prisma.etsyVariantMap.findFirst).mockReset();
    vi.mocked(prisma.etsyVariantMap.findMany).mockReset();
    vi.mocked(prisma.etsyVariantMap.updateMany).mockReset();
    vi.mocked(prisma.etsyListingLink.update).mockResolvedValue({} as never);
    vi.mocked(prisma.etsyVariantMap.updateMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.etsyVariantMap.findMany).mockResolvedValue([]);
    vi.mocked(etsyConnectionRequest).mockReset();
    vi.mocked(markEtsyInventoryProjectionApplied).mockReset();
  });

  it("full-replaces inventory products when projecting qty including zero", async () => {
    vi.mocked(prisma.etsyConnection.findUnique).mockResolvedValue({
      id: "conn-1",
      memberId: "m1",
      shopId: "99",
      status: "ACTIVE",
    } as never);
    vi.mocked(prisma.etsyListingLink.findUnique).mockResolvedValue({
      id: "link-1",
      etsyListingId: "555",
      inventoryHealth: "HEALTHY",
    } as never);
    vi.mocked(prisma.etsyVariantMap.findFirst).mockResolvedValue({
      id: "map-1",
      etsyProductId: "10",
      etsyOfferingId: "20",
      inventoryDesiredVersion: 1,
      inventoryAppliedVersion: 0,
      inventoryDesiredAvailable: 0,
    } as never);

    vi.mocked(etsyConnectionRequest)
      .mockResolvedValueOnce({
        ok: true,
        class: "SUCCESS",
        httpStatus: 200,
        data: {
          products: [
            {
              product_id: 10,
              offerings: [{ offering_id: 20, quantity: 3, is_enabled: true, price: { amount: 100, divisor: 100 } }],
            },
            {
              product_id: 11,
              offerings: [{ offering_id: 21, quantity: 1, is_enabled: true, price: { amount: 200, divisor: 100 } }],
            },
          ],
          price_on_property: [],
          quantity_on_property: [1],
          sku_on_property: [],
        },
        message: "ok",
        retryAfterMs: null,
        rateLimit: null,
      })
      .mockResolvedValueOnce({
        ok: true,
        class: "SUCCESS",
        httpStatus: 200,
        data: {},
        message: "ok",
        retryAfterMs: null,
        rateLimit: null,
      });

    const result = await handleEtsyProjectInventoryJob(claim);
    expect(result).toEqual({ outcome: "SUCCESS" });
    const put = vi.mocked(etsyConnectionRequest).mock.calls.find((c) => c[0]?.method === "PUT");
    const body = put?.[0]?.body as {
      products: Array<{
        product_id?: number;
        offerings: Array<{ quantity: number; price: number; offering_id?: number }>;
      }>;
      quantity_on_property: number[];
    };
    expect(body.products).toHaveLength(2);
    expect(body.quantity_on_property).toEqual([1]);
    expect(body.products.map((product) => product.offerings[0]?.quantity).sort()).toEqual([0, 1]);
    expect(body.products.map((product) => product.offerings[0]?.price).sort()).toEqual([1, 2]);
    expect(body.products.every((product) => product.product_id == null)).toBe(true);
    expect(body.products.every((product) => product.offerings[0]?.offering_id == null)).toBe(true);
    expect(put?.[0]?.query).toEqual({ max_variations_supported: 3 });
    expect(vi.mocked(etsyConnectionRequest).mock.calls.some((c) => c[0]?.method === "PATCH")).toBe(
      false
    );
    expect(markEtsyInventoryProjectionApplied).toHaveBeenCalled();
  });

  it("deactivates the Etsy listing when every offering quantity is zero", async () => {
    vi.mocked(prisma.etsyConnection.findUnique).mockResolvedValue({
      id: "conn-1",
      memberId: "m1",
      shopId: "99",
      status: "ACTIVE",
    } as never);
    vi.mocked(prisma.etsyListingLink.findUnique).mockResolvedValue({
      id: "link-1",
      etsyListingId: "555",
      inventoryHealth: "HEALTHY",
      remoteListingState: "active",
    } as never);
    vi.mocked(prisma.etsyVariantMap.findFirst).mockResolvedValue({
      id: "map-1",
      etsyProductId: "10",
      etsyOfferingId: "20",
      inventoryDesiredVersion: 1,
      inventoryAppliedVersion: 0,
      inventoryDesiredAvailable: 0,
      inventoryAppliedAvailable: 2,
    } as never);
    vi.mocked(etsyConnectionRequest)
      .mockResolvedValueOnce({
        ok: true,
        class: "SUCCESS",
        httpStatus: 200,
        data: {
          products: [
            {
              product_id: 10,
              offerings: [{ offering_id: 20, quantity: 2, is_enabled: true, price: { amount: 100, divisor: 100 } }],
            },
          ],
          price_on_property: [],
          quantity_on_property: [],
          sku_on_property: [],
        },
        message: "ok",
        retryAfterMs: null,
        rateLimit: null,
      })
      .mockResolvedValueOnce({
        ok: true,
        class: "SUCCESS",
        httpStatus: 200,
        data: {},
        message: "ok",
        retryAfterMs: null,
        rateLimit: null,
      });

    const result = await handleEtsyProjectInventoryJob(claim);
    expect(result).toEqual({ outcome: "SUCCESS" });
    expect(vi.mocked(etsyConnectionRequest).mock.calls.some((c) => c[0]?.method === "PUT")).toBe(false);
    const patch = vi.mocked(etsyConnectionRequest).mock.calls.find((c) => c[0]?.method === "PATCH");
    expect(patch?.[0]).toMatchObject({
      path: "/shops/99/listings/555",
      bodyEncoding: "form",
      body: { state: "inactive" },
    });
    expect(prisma.etsyListingLink.update).toHaveBeenCalledWith({
      where: { id: "link-1" },
      data: { remoteListingState: "inactive" },
    });
    expect(markEtsyInventoryProjectionApplied).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ variantMapId: "map-1", available: 0 })
    );
  });

  it("does not deactivate a shared-quantity listing when another variation still has stock", async () => {
    vi.mocked(prisma.etsyConnection.findUnique).mockResolvedValue({
      id: "conn-1",
      memberId: "m1",
      shopId: "99",
      status: "ACTIVE",
    } as never);
    vi.mocked(prisma.etsyListingLink.findUnique).mockResolvedValue({
      id: "link-1",
      etsyListingId: "555",
      inventoryHealth: "HEALTHY",
      remoteListingState: "active",
    } as never);
    vi.mocked(prisma.etsyVariantMap.findFirst).mockResolvedValue({
      id: "map-1",
      etsyProductId: "10",
      etsyOfferingId: "20",
      inventoryDesiredVersion: 1,
      inventoryAppliedVersion: 0,
      inventoryDesiredAvailable: 0,
      inventoryAppliedAvailable: 4,
    } as never);
    vi.mocked(prisma.etsyVariantMap.findMany).mockResolvedValue([
      { inventoryDesiredAvailable: 4 },
    ] as never);
    vi.mocked(etsyConnectionRequest).mockResolvedValueOnce({
      ok: true,
      class: "SUCCESS",
      httpStatus: 200,
      data: {
        products: [
          {
            product_id: 10,
            offerings: [{ offering_id: 20, quantity: 4, is_enabled: true, price: { amount: 100, divisor: 100 } }],
          },
          {
            product_id: 11,
            offerings: [{ offering_id: 21, quantity: 4, is_enabled: true, price: { amount: 100, divisor: 100 } }],
          },
        ],
        price_on_property: [],
        quantity_on_property: [],
        sku_on_property: [],
      },
      message: "ok",
      retryAfterMs: null,
      rateLimit: null,
    });

    const result = await handleEtsyProjectInventoryJob(claim);
    expect(result).toEqual({ outcome: "SUCCESS" });
    expect(vi.mocked(etsyConnectionRequest).mock.calls.some((c) => c[0]?.method === "PATCH")).toBe(false);
    expect(vi.mocked(etsyConnectionRequest).mock.calls.some((c) => c[0]?.method === "PUT")).toBe(false);
    expect(prisma.etsyVariantMap.updateMany).not.toHaveBeenCalled();
    expect(markEtsyInventoryProjectionApplied).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ variantMapId: "map-1", available: 0 })
    );
  });

  it("publishes the listing again when stock returns after a sell-out", async () => {
    vi.mocked(prisma.etsyConnection.findUnique).mockResolvedValue({
      id: "conn-1",
      memberId: "m1",
      shopId: "99",
      status: "ACTIVE",
    } as never);
    vi.mocked(prisma.etsyListingLink.findUnique).mockResolvedValue({
      id: "link-1",
      etsyListingId: "555",
      inventoryHealth: "HEALTHY",
      remoteListingState: "inactive",
    } as never);
    vi.mocked(prisma.etsyVariantMap.findFirst).mockResolvedValue({
      id: "map-1",
      etsyProductId: "10",
      etsyOfferingId: "20",
      inventoryDesiredVersion: 2,
      inventoryAppliedVersion: 1,
      inventoryDesiredAvailable: 4,
      inventoryAppliedAvailable: 0,
    } as never);
    vi.mocked(prisma.etsyVariantMap.findMany).mockResolvedValue([
      { id: "map-1", inventoryAppliedAvailable: 0 },
    ] as never);
    vi.mocked(etsyConnectionRequest)
      .mockResolvedValueOnce({
        ok: true,
        class: "SUCCESS",
        httpStatus: 200,
        data: {
          products: [
            {
              product_id: 10,
              offerings: [{ offering_id: 20, quantity: 1, is_enabled: true, price: { amount: 100, divisor: 100 } }],
            },
          ],
          price_on_property: [],
          quantity_on_property: [],
          sku_on_property: [],
        },
        message: "ok",
        retryAfterMs: null,
        rateLimit: null,
      })
      .mockResolvedValueOnce({
        ok: true,
        class: "SUCCESS",
        httpStatus: 200,
        data: {},
        message: "ok",
        retryAfterMs: null,
        rateLimit: null,
      })
      .mockResolvedValueOnce({
        ok: true,
        class: "SUCCESS",
        httpStatus: 200,
        data: {},
        message: "ok",
        retryAfterMs: null,
        rateLimit: null,
      });

    const result = await handleEtsyProjectInventoryJob({
      ...claim,
      payload: { ...claim.payload, inventoryDesiredVersion: 2 },
    });
    expect(result).toEqual({ outcome: "SUCCESS" });
    const methods = vi.mocked(etsyConnectionRequest).mock.calls.map((c) => c[0]?.method);
    expect(methods).toEqual(["GET", "PUT", "PATCH"]);
    const patch = vi.mocked(etsyConnectionRequest).mock.calls.find((c) => c[0]?.method === "PATCH");
    expect(patch?.[0]).toMatchObject({
      bodyEncoding: "form",
      body: { state: "active" },
    });
    expect(prisma.etsyListingLink.update).toHaveBeenCalledWith({
      where: { id: "link-1" },
      data: { remoteListingState: "active" },
    });
  });

  it("leaves a seller-ended listing inactive when stock was never sold out by this sync", async () => {
    vi.mocked(prisma.etsyConnection.findUnique).mockResolvedValue({
      id: "conn-1",
      memberId: "m1",
      shopId: "99",
      status: "ACTIVE",
    } as never);
    vi.mocked(prisma.etsyListingLink.findUnique).mockResolvedValue({
      id: "link-1",
      etsyListingId: "555",
      inventoryHealth: "HEALTHY",
      remoteListingState: "inactive",
    } as never);
    vi.mocked(prisma.etsyVariantMap.findFirst).mockResolvedValue({
      id: "map-1",
      etsyProductId: "10",
      etsyOfferingId: "20",
      inventoryDesiredVersion: 1,
      inventoryAppliedVersion: 0,
      inventoryDesiredAvailable: 4,
      inventoryAppliedAvailable: 4,
    } as never);
    vi.mocked(etsyConnectionRequest).mockResolvedValueOnce({
      ok: true,
      class: "SUCCESS",
      httpStatus: 200,
      data: {
        products: [
          {
            product_id: 10,
            offerings: [{ offering_id: 20, quantity: 4, is_enabled: true, price: { amount: 100, divisor: 100 } }],
          },
        ],
        price_on_property: [],
        quantity_on_property: [],
        sku_on_property: [],
      },
      message: "ok",
      retryAfterMs: null,
      rateLimit: null,
    });

    const result = await handleEtsyProjectInventoryJob(claim);
    expect(result).toEqual({ outcome: "SUCCESS" });
    expect(vi.mocked(etsyConnectionRequest).mock.calls.map((c) => c[0]?.method)).toEqual(["GET"]);
    expect(prisma.etsyListingLink.update).not.toHaveBeenCalled();
  });
});
