import { describe, expect, it, vi } from "vitest";
import type { WixAppConfig } from "./config";
import {
  matchWixInventoryQuantity,
  readWixV1Inventory,
  shouldApplyWixQuantityToInw,
  wixMissingQuantityIsUnread,
} from "./project-inventory";
import { classifyWixListingHealth, stickyWixDivergenceIssue } from "database";
import { wixMapsCoverActiveCombinations } from "./project-inventory";
import {
  expandRemoteVariantsFromProductOptions,
  inwOptionsAheadOfWix,
  onHandForPulledCombo,
  pullWouldDropLocalStock,
  sellerFieldsForPulledCombo,
} from "./sync-listing-variants";

const config: WixAppConfig = {
  appId: "app-id",
  appSecret: "app-secret",
  redirectUri: "https://www.inwcommunity.com/api/wix/oauth/callback",
  webhookPublicKey: null,
  defaultLocationId: null,
};

const productId = "c43d36c5-c35a-91ec-1c33-d28efc70d5a6";
const inventoryItemId = "3bc2c93a-3ca5-6e13-e3cc-2d71038f2a59";
const nilVariantId = "00000000-0000-0000-0000-000000000000";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("readWixV1Inventory", () => {
  it("reads the documented query payload when the stored id is the product id", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(JSON.parse(body.query.filter)).toEqual({ productId: { $eq: [productId] } });
      expect((init?.headers as Record<string, string>).Authorization).toBe("token");
      return jsonResponse({
        inventoryItems: [
          {
            externalId: productId,
            productId,
            trackQuantity: true,
            variants: [{ variantId: nilVariantId, inStock: true, quantity: 10, availableForPreorder: false }],
            numericId: "1766909903931000",
            preorderInfo: { enabled: false },
            _id: inventoryItemId,
          },
        ],
        metadata: { items: 1, offset: 0 },
        totalResults: 1,
      });
    });

    const result = await readWixV1Inventory({
      config,
      accessToken: "token",
      productId,
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.inventoryItemId).toBe(inventoryItemId);
    expect(result.snapshot.trackQuantity).toBe(true);
    const matched = matchWixInventoryQuantity({
      snapshot: result.snapshot,
      wixVariantId: productId,
      options: {},
    });
    expect(matched.qty).toBe(10);
    expect(wixMissingQuantityIsUnread(result.snapshot.trackQuantity, matched.qty)).toBe(false);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      "https://www.wixapis.com/stores/v2/inventoryItems/query"
    );
  });

  it("does not treat a documented untracked item as an unreadable quantity", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        inventoryItems: [
          {
            productId,
            trackQuantity: false,
            variants: [{ variantId: nilVariantId, inStock: true, availableForPreorder: false }],
            _id: inventoryItemId,
          },
        ],
      })
    );

    const result = await readWixV1Inventory({ config, accessToken: "token", productId, fetchImpl });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const matched = matchWixInventoryQuantity({
      snapshot: result.snapshot,
      wixVariantId: productId,
      options: {},
    });
    expect(matched.qty).toBeNull();
    expect(wixMissingQuantityIsUnread(result.snapshot.trackQuantity, matched.qty)).toBe(false);
  });

  it("retries a plain product filter when the operator filter matches nothing", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const filter = JSON.parse(body.query.filter) as { productId: unknown };
      if (typeof filter.productId === "object") return jsonResponse({ inventoryItems: [] });
      return jsonResponse({
        inventoryItems: [
          {
            id: inventoryItemId,
            productId,
            trackQuantity: true,
            variants: [{ variantId: nilVariantId, inStock: false, quantity: 0 }],
          },
        ],
      });
    });

    const result = await readWixV1Inventory({ config, accessToken: "token", productId, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      matchWixInventoryQuantity({ snapshot: result.snapshot, wixVariantId: productId, options: {} }).qty
    ).toBe(0);
  });

  it("falls through to getVariants when the query is missing", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/query")) return jsonResponse({ message: "missing" }, 404);
      if (url.endsWith("/getVariants")) {
        return jsonResponse({
          inventoryItem: {
            id: inventoryItemId,
            productId,
            trackQuantity: true,
            variants: [{ variantId: nilVariantId, inStock: true, quantity: 4 }],
          },
        });
      }
      return jsonResponse({ message: "unexpected" }, 500);
    });

    const result = await readWixV1Inventory({ config, accessToken: "token", productId, fetchImpl });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      matchWixInventoryQuantity({ snapshot: result.snapshot, wixVariantId: productId, options: {} }).qty
    ).toBe(4);
  });
});

describe("matchWixInventoryQuantity", () => {
  it("matches a renamed option axis by its values", () => {
    const redId = "00000000-0000-0020-0005-9ec14dfb2270";
    const blueId = "00000000-0000-0021-0005-9ec14dfb2270";
    const matched = matchWixInventoryQuantity({
      snapshot: {
        inventoryItemId,
        trackQuantity: true,
        variants: [
          { variantId: redId, inStock: true, quantity: 7 },
          { variantId: blueId, inStock: true, quantity: 2 },
        ],
      },
      wixVariantId: "stale-catalog-id",
      options: { "Primary color": "Red" },
      catalogVariants: [
        { id: redId, choices: { Color: "Red" } },
        { id: blueId, choices: { Color: "Blue" } },
      ],
    });
    expect(matched).toEqual({ qty: 7, catalogVariantId: redId });
    expect(wixMissingQuantityIsUnread(true, matched.qty)).toBe(false);
  });

  it("stays unreadable when tracked variant ids cannot be matched", () => {
    const matched = matchWixInventoryQuantity({
      snapshot: {
        trackQuantity: true,
        variants: [
          { variantId: "00000000-0000-0020-0005-9ec14dfb2270", inStock: true, quantity: 7 },
          { variantId: "00000000-0000-0021-0005-9ec14dfb2270", inStock: true, quantity: 2 },
        ],
      },
      wixVariantId: "stale-catalog-id",
      options: { Size: "Large" },
      catalogVariants: [],
    });
    expect(matched.qty).toBeNull();
    expect(wixMissingQuantityIsUnread(true, matched.qty)).toBe(true);
  });
});

describe("shouldApplyWixQuantityToInw", () => {
  it("does not copy an unverified Wix 0 over INW stock", () => {
    expect(
      shouldApplyWixQuantityToInw({
        sellable: 5,
        remoteQty: 0,
        pendingOutbound: false,
        appliedAvailable: null,
      })
    ).toBe(false);
  });

  it("accepts a Wix 0 after that INW quantity was already verified on Wix", () => {
    expect(
      shouldApplyWixQuantityToInw({
        sellable: 5,
        remoteQty: 0,
        pendingOutbound: false,
        appliedAvailable: 5,
      })
    ).toBe(true);
  });

  it("still copies a higher Wix quantity onto an empty INW row", () => {
    expect(
      shouldApplyWixQuantityToInw({
        sellable: 0,
        remoteQty: 4,
        pendingOutbound: false,
        appliedAvailable: 0,
      })
    ).toBe(true);
  });

  it("leaves a pending INW edit alone", () => {
    expect(
      shouldApplyWixQuantityToInw({
        sellable: 5,
        remoteQty: 9,
        pendingOutbound: true,
        appliedAvailable: 5,
      })
    ).toBe(false);
  });
});

describe("pullWouldDropLocalStock", () => {
  it("refuses a Wix matrix that drops a stocked choice", () => {
    expect(
      pullWouldDropLocalStock(
        [
          {
            options: { Color: "Red" },
            inventoryState: { mode: "TRACKED_FINITE", onHand: 5, reserved: 0 },
          },
        ],
        [{ options: { Color: "Blue" } }]
      )
    ).toBe(true);
  });

  it("allows a third option axis that still contains the stocked values", () => {
    expect(
      pullWouldDropLocalStock(
        [
          {
            options: { "Primary color": "Red", Size: "Small" },
            inventoryState: { mode: "TRACKED_FINITE", onHand: 7, reserved: 0 },
          },
        ],
        [
          { options: { "Primary color": "Red", Size: "Small", Material: "Cotton" } },
          { options: { "Primary color": "Red", Size: "Small", Material: "Wool" } },
        ]
      )
    ).toBe(false);
    expect(
      onHandForPulledCombo(
        [
          {
            options: { "Primary color": "Red", Size: "Small" },
            inventoryState: { mode: "TRACKED_FINITE", onHand: 7, reserved: 0 },
          },
        ],
        { "Primary color": "Red", Size: "Small", Material: "Cotton" }
      )
    ).toBe(7);
  });

  it("allows Wix to remove an option axis and keep the stocked quantity", () => {
    expect(
      pullWouldDropLocalStock(
        [
          {
            options: { "Primary color": "Red", Size: "Small", Material: "Cotton" },
            inventoryState: { mode: "TRACKED_FINITE", onHand: 7, reserved: 0 },
          },
        ],
        [{ options: { "Primary color": "Red", Size: "Small" } }]
      )
    ).toBe(false);
    expect(
      onHandForPulledCombo(
        [
          {
            options: { "Primary color": "Red", Size: "Small", Material: "Cotton" },
            inventoryState: { mode: "TRACKED_FINITE", onHand: 7, reserved: 0 },
          },
        ],
        { "Primary color": "Red", Size: "Small" }
      )
    ).toBe(7);
  });
});

describe("inwOptionsAheadOfWix", () => {
  it("does not pull when INW added an option axis Wix does not have", () => {
    expect(
      inwOptionsAheadOfWix({
        localAxes: ["primary color", "size", "material"],
        remoteAxes: ["primary color", "size"],
        localComboCount: 12,
        remoteComboCount: 6,
      })
    ).toBe(true);
  });

  it("still allows a pull when Wix added the extra axis", () => {
    expect(
      inwOptionsAheadOfWix({
        localAxes: ["primary color", "size"],
        remoteAxes: ["primary color", "size", "material"],
        localComboCount: 6,
        remoteComboCount: 12,
      })
    ).toBe(false);
  });
});

describe("sellerFieldsForPulledCombo", () => {
  it("keeps the INW price and SKU when Wix extends an existing combination", () => {
    expect(
      sellerFieldsForPulledCombo(
        [
          {
            options: { "Primary color": "Red", Size: "Small" },
            priceCents: 2500,
            sku: "RED-SM",
          },
        ],
        { "Primary color": "Red", Size: "Small", Material: "Cotton" }
      )
    ).toEqual({ priceCents: 2500, sku: "RED-SM" });
  });

  it("uses the Wix price only for a combination INW has never had", () => {
    expect(
      sellerFieldsForPulledCombo(
        [
          {
            options: { "Primary color": "Red", Size: "Small" },
            priceCents: 2500,
            sku: "RED-SM",
          },
        ],
        { "Primary color": "Green", Size: "Large" }
      )
    ).toBeNull();
  });
});

describe("wixMapsCoverActiveCombinations", () => {
  it("refuses a quantity write when a new option combination is unmapped", () => {
    expect(
      wixMapsCoverActiveCombinations(
        [
          { id: "cotton", options: { Color: "Red", Material: "Cotton" } },
          { id: "wool", options: { Color: "Red", Material: "Wool" } },
        ],
        [{ storeVariantId: "cotton" }]
      )
    ).toBe(false);
  });

  it("allows a quantity write when every active combination is mapped", () => {
    expect(
      wixMapsCoverActiveCombinations(
        [
          { id: "cotton", options: { Color: "Red", Material: "Cotton" } },
          { id: "wool", options: { Color: "Red", Material: "Wool" } },
        ],
        [{ storeVariantId: "cotton" }, { storeVariantId: "wool" }]
      )
    ).toBe(true);
  });
});

describe("wix topology health", () => {
  const ready = {
    connectionStatus: "ACTIVE" as const,
    remoteProductVisible: true,
    hasPhotos: true,
    priceCents: 200,
    contentDesiredVersion: 1,
    contentAppliedVersion: 1,
    inventoryDesiredVersion: 1,
    inventoryAppliedVersion: 1,
    lastErrorCode: null,
    lastErrorMessage: null,
  };

  it("stays Syncing while the new option axis has not landed on Wix", () => {
    expect(classifyWixListingHealth({ ...ready, topologyPending: true }).readiness).toBe("SYNCING");
  });

  it("keeps a failed option push on Needs attention", () => {
    expect(
      stickyWixDivergenceIssue({
        issueCode: "TOPOLOGY_PUSH_FAILED",
        issueMessage: "Wix did not accept the new option. The listing on Wix still has the old options.",
        productContentConflict: false,
        contentPending: false,
        inventoryPending: false,
      })?.code
    ).toBe("TOPOLOGY_PUSH_FAILED");
    expect(
      classifyWixListingHealth({
        ...ready,
        lastErrorCode: "TOPOLOGY_PUSH_FAILED",
        lastErrorMessage: null,
      }).readiness
    ).toBe("ACTION_REQUIRED");
  });
});

describe("expandRemoteVariantsFromProductOptions", () => {
  it("builds the third axis from product options and keeps the variant id", () => {
    const expanded = expandRemoteVariantsFromProductOptions(
      [
        { name: "Primary color", choices: [{ value: "Red" }] },
        { name: "Size", choices: [{ value: "Small" }] },
        { name: "Material", choices: [{ value: "Cotton" }, { value: "Wool" }] },
      ],
      [
        {
          id: "variant-cotton",
          choices: { "Primary color": "Red", Size: "Small", Material: "Cotton" },
        },
      ]
    );
    expect(expanded).toEqual([
      {
        id: "variant-cotton",
        sku: undefined,
        choices: { "Primary color": "Red", Size: "Small", Material: "Cotton" },
        visible: true,
        priceData: undefined,
        variant: undefined,
      },
      {
        id: undefined,
        sku: undefined,
        choices: { "Primary color": "Red", Size: "Small", Material: "Wool" },
        visible: true,
        priceData: undefined,
        variant: undefined,
      },
    ]);
  });
});
