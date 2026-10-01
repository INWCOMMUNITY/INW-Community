import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("database", async () => {
  const actual = await vi.importActual<typeof import("database")>("database");
  return {
    ...actual,
    prisma: {
      etsyConnection: { findUnique: vi.fn() },
      etsyListingLink: { findUnique: vi.fn() },
      etsyVariantMap: { findFirst: vi.fn() },
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
    vi.mocked(prisma.etsyVariantMap.findFirst).mockReset();
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
    expect((put?.[0]?.body as { products: unknown[] }).products).toHaveLength(2);
    expect(put?.[0]?.body).toMatchObject({
      products: expect.arrayContaining([
        expect.objectContaining({
          product_id: 10,
          offerings: [expect.objectContaining({ offering_id: 20, quantity: 0 })],
        }),
        expect.objectContaining({ product_id: 11 }),
      ]),
    });
    expect(markEtsyInventoryProjectionApplied).toHaveBeenCalled();
  });
});
