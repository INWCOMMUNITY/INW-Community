import { beforeEach, describe, expect, it, vi } from "vitest";

const { ebayGet, fetchLiveInventoryItem } = vi.hoisted(() => ({
  ebayGet: vi.fn(),
  fetchLiveInventoryItem: vi.fn(),
}));

vi.mock("./client", () => ({ ebayGet }));
vi.mock("./passthrough-push", () => ({
  fetchLiveInventoryItem,
  readLiveInventoryAvailableQuantity: () => null,
}));

import { resolveLiveEbayInventorySku, resolveEbayLivePushSku } from "./inventory-sku";

describe("resolveLiveEbayInventorySku", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchLiveInventoryItem.mockResolvedValue(null);
  });

  it("selects the SKU whose offer listing id matches the live Item ID", async () => {
    ebayGet.mockImplementation(async (_token: string, path: string) => {
      if (path.includes("nwcAbCdEfGh12")) return { offers: [{ offerId: "ghost", status: "UNPUBLISHED" }] };
      if (path.includes("cmsz85hpj0001ahwfa2pmvtun")) {
        return {
          offers: [
            {
              offerId: "live",
              status: "PUBLISHED",
              listing: { listingId: "403004607151" },
            },
          ],
        };
      }
      return { offers: [] };
    });

    await expect(
      resolveLiveEbayInventorySku(
        "t",
        ["nwcAbCdEfGh12", "cmsz85hpj0001ahwfa2pmvtun"],
        { preferListingId: "403004607151" }
      )
    ).resolves.toBe("cmsz85hpj0001ahwfa2pmvtun");
  });

  it("skips a hub mint with no offer and uses the published StoreItem.id pin", async () => {
    ebayGet.mockImplementation(async (_token: string, path: string) => {
      if (path.includes("cmsz85hpj0001ahwfa2pmvtun")) {
        return { offers: [{ offerId: "live", status: "PUBLISHED" }] };
      }
      return { offers: [] };
    });

    await expect(
      resolveLiveEbayInventorySku("t", ["nwcAbCdEfGh12", "cmsz85hpj0001ahwfa2pmvtun"])
    ).resolves.toBe("cmsz85hpj0001ahwfa2pmvtun");
  });

  it("returns null when none of the pins exist yet (first publish)", async () => {
    ebayGet.mockResolvedValue({ offers: [] });
    await expect(resolveLiveEbayInventorySku("t", ["nwcAbCdEfGh12"])).resolves.toBeNull();
  });
});

describe("resolveEbayLivePushSku", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchLiveInventoryItem.mockResolvedValue(null);
  });

  it("uses StoreItem.id when a live INW-created listing still has that Inventory pin", async () => {
    ebayGet.mockImplementation(async (_token: string, path: string) => {
      if (path.includes("cmsz85hpj0001ahwfa2pmvtun")) {
        return {
          offers: [
            {
              offerId: "live",
              status: "PUBLISHED",
              listing: { listingId: "403004607151" },
            },
          ],
        };
      }
      return { offers: [] };
    });

    await expect(
      resolveEbayLivePushSku("t", {
        itemId: "cmsz85hpj0001ahwfa2pmvtun",
        itemSku: "nwcAbCdEfGh12",
        externalListingId: "403004607151",
        linkOrigin: "inw_create",
      })
    ).resolves.toBe("cmsz85hpj0001ahwfa2pmvtun");
  });
});
