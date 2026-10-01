import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("database", async () => {
  const actual = await vi.importActual<typeof import("database")>("database");
  return {
    ...actual,
    prisma: {
      etsyConnection: { findUnique: vi.fn() },
      etsyListingLink: { findUnique: vi.fn() },
      etsyVariantMap: { findMany: vi.fn() },
      storeItem: { findFirst: vi.fn() },
      storeVariant: { findFirst: vi.fn() },
    },
    markEtsyProductContentApplied: vi.fn(),
    markEtsyVariantContentApplied: vi.fn(),
    setEtsyProductContentConflict: vi.fn(),
    setEtsyVariantContentConflict: vi.fn(),
  };
});

vi.mock("./connection-request", () => ({
  etsyConnectionRequest: vi.fn(),
}));

import {
  etsyProductContentFingerprint,
  etsyVariantContentFingerprint,
  markEtsyProductContentApplied,
  markEtsyVariantContentApplied,
  prisma,
} from "database";
import { etsyConnectionRequest } from "./connection-request";
import { handleEtsyUpdateListingContentJob } from "./update-listing-content";

const claimBase = {
  id: "job-1",
  etsyConnectionId: "conn-1",
  kind: "UPDATE_LISTING_CONTENT" as const,
  dedupeKey: "UPDATE_LISTING_CONTENT:conn-1:item-1:v1:p1:v0",
  evidenceId: null,
  payload: {
    storeItemId: "item-1",
    storeVariantId: "var-1",
    productDesiredVersion: 1,
    variantDesiredVersion: 0,
  },
  payloadHash: null,
  state: "RUNNING" as const,
  attemptCount: 1,
  maxAttempts: 8,
  leaseOwner: "w1",
  leaseToken: "tok",
  leaseExpiresAt: new Date("2099-01-01T00:00:00Z"),
};

describe("etsy UPDATE_LISTING_CONTENT handler", () => {
  beforeEach(() => {
    vi.mocked(prisma.etsyConnection.findUnique).mockReset();
    vi.mocked(prisma.etsyListingLink.findUnique).mockReset();
    vi.mocked(prisma.etsyVariantMap.findMany).mockReset();
    vi.mocked(prisma.storeItem.findFirst).mockReset();
    vi.mocked(prisma.storeVariant.findFirst).mockReset();
    vi.mocked(etsyConnectionRequest).mockReset();
    vi.mocked(markEtsyProductContentApplied).mockReset();
    vi.mocked(markEtsyVariantContentApplied).mockReset();
  });

  it("succeeds without network when desire is already superseded", async () => {
    vi.mocked(prisma.etsyConnection.findUnique).mockResolvedValue({
      id: "conn-1",
      memberId: "m1",
      shopId: "99",
      status: "ACTIVE",
    } as never);
    vi.mocked(prisma.etsyListingLink.findUnique).mockResolvedValue({
      id: "link-1",
      etsyListingId: "555",
      contentHealth: "HEALTHY",
      desiredProductContentVersion: 2,
      appliedProductContentVersion: 2,
      desiredProductFingerprint: "x",
    } as never);
    vi.mocked(prisma.etsyVariantMap.findMany).mockResolvedValue([
      {
        id: "map-1",
        storeVariantId: "var-1",
        etsyProductId: "1",
        etsyOfferingId: "2",
        desiredVariantContentVersion: 0,
        appliedVariantContentVersion: 0,
        desiredVariantFingerprint: null,
        appliedVariantFingerprint: null,
      },
    ] as never);

    const result = await handleEtsyUpdateListingContentJob(claimBase);
    expect(result).toEqual({ outcome: "SUCCESS" });
    expect(etsyConnectionRequest).not.toHaveBeenCalled();
  });

  it("patches title and marks product content applied", async () => {
    const title = "New Title";
    const description = "Body";
    const photos: string[] = [];
    const desiredFp = etsyProductContentFingerprint({ title, description, photos });

    vi.mocked(prisma.etsyConnection.findUnique).mockResolvedValue({
      id: "conn-1",
      memberId: "m1",
      shopId: "99",
      status: "ACTIVE",
    } as never);
    vi.mocked(prisma.etsyListingLink.findUnique).mockResolvedValue({
      id: "link-1",
      etsyListingId: "555",
      contentHealth: "HEALTHY",
      desiredProductContentVersion: 1,
      appliedProductContentVersion: 0,
      desiredProductFingerprint: desiredFp,
      appliedProductFingerprint: null,
    } as never);
    vi.mocked(prisma.etsyVariantMap.findMany).mockResolvedValue([
      {
        id: "map-1",
        storeVariantId: "var-1",
        etsyProductId: "1",
        etsyOfferingId: "2",
        desiredVariantContentVersion: 0,
        appliedVariantContentVersion: 0,
        desiredVariantFingerprint: null,
        appliedVariantFingerprint: null,
      },
    ] as never);
    vi.mocked(prisma.storeItem.findFirst).mockResolvedValue({
      id: "item-1",
      title,
      description,
      photos,
      priceCents: 1000,
      sku: "SKU",
    } as never);
    vi.mocked(prisma.storeVariant.findFirst).mockResolvedValue({
      id: "var-1",
      priceCents: 1000,
      sku: "SKU",
    } as never);

    vi.mocked(etsyConnectionRequest)
      .mockResolvedValueOnce({
        ok: true,
        class: "SUCCESS",
        httpStatus: 200,
        data: { title: "Old", description: "Body", images: [] },
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

    const result = await handleEtsyUpdateListingContentJob(claimBase);
    expect(result).toEqual({ outcome: "SUCCESS" });
    expect(etsyConnectionRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PATCH",
        bodyEncoding: "form",
        body: expect.objectContaining({ title: "New Title" }),
      })
    );
    expect(markEtsyProductContentApplied).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        listingLinkId: "link-1",
        desiredVersion: 1,
        fingerprint: desiredFp,
      })
    );
  });

  it("full-replaces inventory when applying variant price", async () => {
    const desiredVariantFp = etsyVariantContentFingerprint({ priceCents: 1500, sku: "SKU" });
    const claim = {
      ...claimBase,
      payload: {
        storeItemId: "item-1",
        storeVariantId: "var-1",
        productDesiredVersion: 0,
        variantDesiredVersion: 1,
      },
    };

    vi.mocked(prisma.etsyConnection.findUnique).mockResolvedValue({
      id: "conn-1",
      memberId: "m1",
      shopId: "99",
      status: "ACTIVE",
    } as never);
    vi.mocked(prisma.etsyListingLink.findUnique).mockResolvedValue({
      id: "link-1",
      etsyListingId: "555",
      contentHealth: "HEALTHY",
      desiredProductContentVersion: 0,
      appliedProductContentVersion: 0,
      desiredProductFingerprint: null,
      appliedProductFingerprint: null,
    } as never);
    vi.mocked(prisma.etsyVariantMap.findMany).mockResolvedValue([
      {
        id: "map-1",
        storeVariantId: "var-1",
        etsyProductId: "10",
        etsyOfferingId: "20",
        desiredVariantContentVersion: 1,
        appliedVariantContentVersion: 0,
        desiredVariantFingerprint: desiredVariantFp,
        appliedVariantFingerprint: null,
      },
    ] as never);
    vi.mocked(prisma.storeItem.findFirst).mockResolvedValue({
      id: "item-1",
      title: "T",
      description: "D",
      photos: [],
      priceCents: 1500,
      sku: "SKU",
    } as never);
    vi.mocked(prisma.storeVariant.findFirst).mockResolvedValue({
      id: "var-1",
      priceCents: 1500,
      sku: "SKU",
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
              sku: "SKU",
              offerings: [
                {
                  offering_id: 20,
                  quantity: 2,
                  is_enabled: true,
                  price: { amount: 1000, divisor: 100 },
                },
              ],
            },
            {
              product_id: 11,
              sku: "OTHER",
              offerings: [
                {
                  offering_id: 21,
                  quantity: 1,
                  is_enabled: true,
                  price: { amount: 2000, divisor: 100 },
                },
              ],
            },
          ],
          price_on_property: [1],
          quantity_on_property: [1],
          sku_on_property: [1],
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

    const result = await handleEtsyUpdateListingContentJob(claim);
    expect(result).toEqual({ outcome: "SUCCESS" });
    const putCall = vi.mocked(etsyConnectionRequest).mock.calls.find((c) => c[0]?.method === "PUT");
    expect(putCall?.[0]?.body).toMatchObject({
      products: expect.arrayContaining([
        expect.objectContaining({ product_id: 10 }),
        expect.objectContaining({ product_id: 11 }),
      ]),
      price_on_property: [1],
    });
    expect((putCall?.[0]?.body as { products: unknown[] }).products).toHaveLength(2);
    expect(markEtsyVariantContentApplied).toHaveBeenCalled();
  });
});
