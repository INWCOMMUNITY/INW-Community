import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/mobile-auth", () => ({
  getSessionForApi: vi.fn(),
}));
vi.mock("@/lib/storefront-seller-access", () => ({
  memberHasStorefrontListingAccess: vi.fn(),
}));
vi.mock("@/lib/shopify/create-listing", () => ({
  enqueueShopifyCreateListing: vi.fn(),
}));

import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";
import { enqueueShopifyCreateListing } from "@/lib/shopify/create-listing";
import { POST as createListingPost } from "@/app/api/shopify/listings/create/route";

describe("POST /api/shopify/listings/create", () => {
  beforeEach(() => {
    vi.mocked(getSessionForApi).mockResolvedValue({
      user: { id: "member-a", email: "a@example.com" },
    } as never);
    vi.mocked(memberHasStorefrontListingAccess).mockResolvedValue(true);
    vi.mocked(enqueueShopifyCreateListing).mockReset();
  });

  it("queues a create job for the authenticated seller", async () => {
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
    expect(await response.json()).toEqual({
      status: "queued",
      connectionId: "conn-1",
      storeItemId: "item-1",
      jobId: "job-1",
    });
    expect(enqueueShopifyCreateListing).toHaveBeenCalledWith({
      memberId: "member-a",
      storeItemId: "item-1",
    });
  });

  it("returns already_mapped without inventing a browser connection id", async () => {
    vi.mocked(enqueueShopifyCreateListing).mockResolvedValue({
      status: "ALREADY_MAPPED",
      connectionId: "conn-1",
      storeItemId: "item-1",
      shopifyProductId: "gid://shopify/Product/1",
    });
    const response = await createListingPost(
      new NextRequest("https://app.example.com/api/shopify/listings/create", {
        method: "POST",
        body: JSON.stringify({ storeItemId: "item-1", connectionId: "evil" }),
      })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "already_mapped" });
  });

  it("maps LOCATION_REQUIRED to 409", async () => {
    vi.mocked(enqueueShopifyCreateListing).mockResolvedValue({
      status: "ERROR",
      code: "LOCATION_REQUIRED",
      message: "Select a primary Shopify location before listing",
    });
    const response = await createListingPost(
      new NextRequest("https://app.example.com/api/shopify/listings/create", {
        method: "POST",
        body: JSON.stringify({ storeItemId: "item-1" }),
      })
    );
    expect(response.status).toBe(409);
  });
});
