import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/mobile-auth", () => ({
  getSessionForApi: vi.fn(),
}));
vi.mock("@/lib/storefront-seller-access", () => ({
  memberHasStorefrontListingAccess: vi.fn(),
}));
vi.mock("@/lib/shopify/import-discovery", () => ({
  discoverShopifyImportCandidates: vi.fn(),
}));
vi.mock("@/lib/shopify/import-listing", () => ({
  importShopifyListing: vi.fn(),
}));

import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";
import { discoverShopifyImportCandidates } from "@/lib/shopify/import-discovery";
import { importShopifyListing } from "@/lib/shopify/import-listing";
import { GET as candidatesGet } from "@/app/api/shopify/import/candidates/route";
import { POST as importPost } from "@/app/api/shopify/import/route";

describe("Shopify import APIs", () => {
  beforeEach(() => {
    vi.mocked(getSessionForApi).mockResolvedValue({
      user: { id: "member-a", email: "a@example.com" },
    } as never);
    vi.mocked(memberHasStorefrontListingAccess).mockResolvedValue(true);
    vi.mocked(discoverShopifyImportCandidates).mockReset();
    vi.mocked(importShopifyListing).mockReset();
  });

  it("scopes discovery to the authenticated seller", async () => {
    vi.mocked(discoverShopifyImportCandidates).mockResolvedValue({
      status: "OK",
      connectionId: "conn-1",
      shopDomain: "demo.myshopify.com",
      generation: 2,
      primaryLocationId: "gid://shopify/Location/1",
      candidates: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    });
    const response = await candidatesGet(
      new NextRequest("https://app.example.com/api/shopify/import/candidates")
    );
    expect(response.status).toBe(200);
    expect(discoverShopifyImportCandidates).toHaveBeenCalledWith({
      memberId: "member-a",
      cursor: null,
    });
  });

  it("imports one product with seller stock mode", async () => {
    vi.mocked(importShopifyListing).mockResolvedValue({
      status: "IMPORTED",
      storeItemId: "item-1",
      listingLinkId: "link-1",
      shopifyProductId: "gid://shopify/Product/300",
      bootstrap: { preBootstrapAcked: 0, postBootstrapApplied: 0 },
    });
    const response = await importPost(
      new NextRequest("https://app.example.com/api/shopify/import", {
        method: "POST",
        body: JSON.stringify({
          shopifyProductId: "gid://shopify/Product/300",
          stockMode: "PHYSICAL",
        }),
      })
    );
    expect(response.status).toBe(200);
    expect(importShopifyListing).toHaveBeenCalledWith({
      memberId: "member-a",
      shopifyProductId: "gid://shopify/Product/300",
      stockMode: "PHYSICAL",
    });
    expect(await response.json()).toMatchObject({ status: "imported", storeItemId: "item-1" });
  });

  it("rejects other sellers without storefront access", async () => {
    vi.mocked(memberHasStorefrontListingAccess).mockResolvedValue(false);
    const response = await importPost(
      new NextRequest("https://app.example.com/api/shopify/import", {
        method: "POST",
        body: JSON.stringify({
          shopifyProductId: "gid://shopify/Product/300",
          stockMode: "PHYSICAL",
        }),
      })
    );
    expect(response.status).toBe(403);
  });
});
