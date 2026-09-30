import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/mobile-auth", () => ({
  getSessionForApi: vi.fn(),
}));
vi.mock("@/lib/storefront-seller-access", () => ({
  memberHasStorefrontListingAccess: vi.fn(),
}));
vi.mock("database", () => ({
  prisma: {
    shopifyConnection: { findFirst: vi.fn() },
    shopifyListingLink: { updateMany: vi.fn(async () => ({ count: 1 })) },
  },
  ensureShopifyReconcileListingJob: vi.fn(),
}));
vi.mock("@/lib/shopify/eligible-listings", () => ({
  listEligibleShopifyExportListings: vi.fn(),
}));
vi.mock("@/lib/shopify/listing-public-view", () => ({
  listShopifySellerListingViews: vi.fn(),
}));
vi.mock("@/lib/shopify/create-listing", () => ({
  enqueueShopifyCreateListing: vi.fn(),
}));

import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";
import { prisma } from "database";
import { listEligibleShopifyExportListings } from "@/lib/shopify/eligible-listings";
import { listShopifySellerListingViews } from "@/lib/shopify/listing-public-view";
import { enqueueShopifyCreateListing } from "@/lib/shopify/create-listing";
import { GET as eligibleGet } from "@/app/api/shopify/listings/eligible/route";
import { GET as listingsGet } from "@/app/api/shopify/listings/route";
import { POST as createListingPost } from "@/app/api/shopify/listings/create/route";

describe("Apps Airport Shopify read APIs", () => {
  beforeEach(() => {
    vi.mocked(getSessionForApi).mockResolvedValue({
      user: { id: "member-a", email: "a@example.com" },
    } as never);
    vi.mocked(memberHasStorefrontListingAccess).mockResolvedValue(true);
    vi.mocked(prisma.shopifyConnection.findFirst).mockReset();
    vi.mocked(prisma.shopifyListingLink.updateMany).mockClear();
    vi.mocked(listEligibleShopifyExportListings).mockReset();
    vi.mocked(listShopifySellerListingViews).mockReset();
    vi.mocked(enqueueShopifyCreateListing).mockReset();
  });

  it("returns CONNECTION_REQUIRED for eligible listings without an active connection", async () => {
    vi.mocked(prisma.shopifyConnection.findFirst).mockResolvedValue(null as never);
    const response = await eligibleGet(
      new NextRequest("https://app.example.com/api/shopify/listings/eligible")
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      connectionStatus: "CONNECTION_REQUIRED",
      inventoryReady: false,
      listings: [],
    });
  });

  it("scopes eligible listings to the seller active connection", async () => {
    vi.mocked(prisma.shopifyConnection.findFirst).mockResolvedValue({
      id: "conn-1",
      shopDomain: "demo.myshopify.com",
      generation: 2,
      primaryLocationId: "gid://shopify/Location/1",
      status: "ACTIVE",
    } as never);
    vi.mocked(listEligibleShopifyExportListings).mockResolvedValue([
      {
        storeItemId: "item-1",
        title: "Mug",
        slug: "mug",
        sku: "SKU1",
        priceCents: 1200,
        quantity: 3,
        status: "active",
        updatedAt: "2026-09-28T00:00:00.000Z",
      },
    ]);

    const response = await eligibleGet(
      new NextRequest("https://app.example.com/api/shopify/listings/eligible")
    );
    expect(response.status).toBe(200);
    expect(listEligibleShopifyExportListings).toHaveBeenCalledWith({
      memberId: "member-a",
      connectionId: "conn-1",
    });
    const body = await response.json();
    expect(body.connectionStatus).toBe("ACTIVE");
    expect(body.listings).toHaveLength(1);
  });

  it("returns only current-connection synced listings for the authenticated seller", async () => {
    vi.mocked(prisma.shopifyConnection.findFirst).mockResolvedValue({
      id: "conn-1",
      status: "ACTIVE",
      shopDomain: "demo.myshopify.com",
      generation: 2,
      primaryLocationId: "gid://shopify/Location/1",
    } as never);
    vi.mocked(listShopifySellerListingViews).mockResolvedValue([
      {
        listingLinkId: "link-1",
        storeItemId: "item-1",
        shopifyProductId: "gid://shopify/Product/1",
        readiness: "READY_TO_PUBLISH",
        contentHealth: "HEALTHY",
        inventoryHealth: "HEALTHY",
        issueCode: null,
        issueSeverity: null,
        issueMessage: null,
        lastReconciledAt: null,
        remoteProductStatus: "DRAFT",
        blockContentOutbound: false,
        blockInventoryOutbound: false,
        title: "Mug",
        slug: "mug",
        sku: "SKU1",
        priceCents: 1200,
        quantity: 3,
        storeItemStatus: "active",
        shopifyVariantId: "gid://shopify/ProductVariant/1",
        storeVariantId: "var-1",
        inventoryDesiredAvailable: 3,
        inventoryAppliedAvailable: 3,
        inventoryInitState: "INITIALIZED",
        inventoryDriftState: "NONE",
        importSource: "NATIVE",
        importedAt: null,
        updatedAt: "2026-09-28T00:00:00.000Z",
      },
    ] as never);

    const response = await listingsGet(
      new NextRequest("https://app.example.com/api/shopify/listings")
    );
    expect(response.status).toBe(200);
    expect(listShopifySellerListingViews).toHaveBeenCalledWith({
      memberId: "member-a",
      connectionId: "conn-1",
    });
    const body = await response.json();
    expect(body.listings[0].title).toBe("Mug");
    expect(body.shopDomain).toBe("demo.myshopify.com");
    expect(body.listings[0].remoteProductStatus).toBe("DRAFT");
    expect(prisma.shopifyListingLink.updateMany).not.toHaveBeenCalled();
  });

  it("does not promote DRAFT listings to ACTIVE on listings GET", async () => {
    vi.mocked(prisma.shopifyConnection.findFirst).mockResolvedValue({
      id: "conn-1",
      status: "ACTIVE",
      shopDomain: "demo.myshopify.com",
      generation: 2,
      primaryLocationId: "gid://shopify/Location/1",
    } as never);
    vi.mocked(listShopifySellerListingViews).mockResolvedValue([
      {
        listingLinkId: "link-1",
        storeItemId: "item-1",
        shopifyProductId: "gid://shopify/Product/1",
        readiness: "SYNCING",
        contentHealth: "HEALTHY",
        inventoryHealth: "DEGRADED",
        issueCode: null,
        issueSeverity: null,
        issueMessage: null,
        lastReconciledAt: null,
        remoteProductStatus: "DRAFT",
        blockContentOutbound: false,
        blockInventoryOutbound: false,
        title: "Draft Mug",
        slug: "draft-mug",
        sku: "SKU1",
        priceCents: 100,
        quantity: 3,
        storeItemStatus: "active",
        shopifyVariantId: "gid://shopify/ProductVariant/1",
        storeVariantId: "var-1",
        inventoryDesiredAvailable: 3,
        inventoryAppliedAvailable: null,
        inventoryInitState: "PENDING",
        inventoryDriftState: "NONE",
        importSource: "NATIVE",
        importedAt: null,
        updatedAt: "2026-09-28T00:00:00.000Z",
      },
    ] as never);

    const response = await listingsGet(
      new NextRequest("https://app.example.com/api/shopify/listings")
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.listings[0].remoteProductStatus).toBe("DRAFT");
    expect(body.listings[0].inventoryAppliedAvailable).toBeNull();
    expect(prisma.shopifyListingLink.updateMany).not.toHaveBeenCalled();
  });

  it("rejects other sellers without storefront access", async () => {
    vi.mocked(memberHasStorefrontListingAccess).mockResolvedValue(false);
    const response = await eligibleGet(
      new NextRequest("https://app.example.com/api/shopify/listings/eligible")
    );
    expect(response.status).toBe(403);
  });

  it("wires Sync to Shopify through the existing V2 create path", async () => {
    vi.mocked(enqueueShopifyCreateListing).mockResolvedValue({
      status: "QUEUED",
      connectionId: "conn-1",
      storeItemId: "item-1",
      jobId: "job-1",
    });
    const response = await createListingPost(
      new NextRequest("https://app.example.com/api/shopify/listings/create", {
        method: "POST",
        body: JSON.stringify({ storeItemId: "item-1" }),
      })
    );
    expect(response.status).toBe(200);
    expect(enqueueShopifyCreateListing).toHaveBeenCalledWith({
      memberId: "member-a",
      storeItemId: "item-1",
    });
  });
});
