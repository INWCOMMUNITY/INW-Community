import { beforeEach, describe, expect, it, vi } from "vitest";

const executeShopifyAdminGraphql = vi.fn();

vi.mock("./admin-graphql", () => ({
  executeShopifyAdminGraphql: (...args: unknown[]) => executeShopifyAdminGraphql(...args),
}));

vi.mock("database", async () => {
  const actual = await vi.importActual<typeof import("database")>("database");
  return {
    ...actual,
    prisma: {
      storeItem: {
        findFirst: vi.fn(async () => ({ inventoryTracking: "tracked" })),
        update: vi.fn(async () => ({})),
      },
      shopifyVariantMap: {
        findMany: vi.fn(async () => []),
        findFirst: vi.fn(async () => null),
        deleteMany: vi.fn(async () => ({ count: 0 })),
        update: vi.fn(async () => ({})),
      },
      shopifyListingLink: {
        update: vi.fn(async () => ({})),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      storeVariant: {
        create: vi.fn(async () => ({ id: "sv-new" })),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      inventoryState: {
        create: vi.fn(async () => ({})),
        findUnique: vi.fn(async () => ({ mode: "TRACKED_FINITE", reserved: 0 })),
        update: vi.fn(async () => ({})),
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
        fn({
          storeItem: {
            update: vi.fn(async () => ({})),
            findUnique: vi.fn(async () => ({
              inventoryTracking: "tracked",
              variants: null,
            })),
          },
          inventoryState: { findMany: vi.fn(async () => []) },
          storeVariant: { findMany: vi.fn(async () => []) },
        })
      ),
    },
    projectStoreItemQuantity: vi.fn(async () => 0),
    appendShopifyVariantMaps: vi.fn(async () => ({})),
  };
});

import { planShopifyTopologyDiff } from "database";
import {
  readShopifyProductTopology,
  syncShopifyListingTopology,
} from "./sync-listing-topology";

describe("ShopifyProductTopologyRead 2026-07 selection set", () => {
  beforeEach(() => {
    executeShopifyAdminGraphql.mockReset();
  });

  it("requests ProductOption.position and never ProductOptionValue.position", async () => {
    executeShopifyAdminGraphql.mockResolvedValue({
      ok: true,
      data: {
        product: {
          options: [
            {
              id: "gid://shopify/ProductOption/1",
              name: "Title",
              position: 1,
              optionValues: [
                { id: "gid://shopify/ProductOptionValue/1", name: "Default Title", hasVariants: true },
              ],
            },
          ],
          variants: {
            nodes: [
              {
                id: "gid://shopify/ProductVariant/1",
                price: "2.99",
                sku: "SKU-1",
                selectedOptions: [{ name: "Title", value: "Default Title" }],
                inventoryItem: { id: "gid://shopify/InventoryItem/1" },
                inventoryQuantity: 3,
              },
            ],
          },
        },
      },
    });

    const result = await readShopifyProductTopology({
      connectionId: "conn-1",
      productId: "gid://shopify/Product/1",
    });
    expect(result.ok).toBe(true);

    expect(executeShopifyAdminGraphql).toHaveBeenCalledTimes(1);
    const call = executeShopifyAdminGraphql.mock.calls[0][0] as {
      document: string;
      operationName: string;
    };
    expect(call.operationName).toBe("ShopifyProductTopologyRead");
    expect(call.document).toMatch(/options\s*\{[\s\S]*position[\s\S]*optionValues/);
    expect(call.document).toMatch(/optionValues\s*\{\s*id\s+name\s+hasVariants\s*\}/);
    // Must keep ProductOption.position, must not request ProductOptionValue.position.
    expect(call.document).toContain("position");
    expect(call.document).not.toMatch(/optionValues\s*\{[^}]*\bposition\b/);
  });

  it("A: simple Default Title product reads and plans NOOP when already mapped", async () => {
    executeShopifyAdminGraphql.mockResolvedValue({
      ok: true,
      data: {
        product: {
          options: [
            {
              id: "gid://shopify/ProductOption/title",
              name: "Title",
              position: 1,
              optionValues: [
                {
                  id: "gid://shopify/ProductOptionValue/default",
                  name: "Default Title",
                  hasVariants: true,
                },
              ],
            },
          ],
          variants: {
            nodes: [
              {
                id: "gid://shopify/ProductVariant/8",
                price: "2.99",
                sku: "INW-QA-CERT-20260930-01",
                selectedOptions: [{ name: "Title", value: "Default Title" }],
                inventoryItem: { id: "gid://shopify/InventoryItem/7" },
                inventoryQuantity: 3,
              },
            ],
          },
        },
      },
    });

    const read = await readShopifyProductTopology({
      connectionId: "conn-1",
      productId: "gid://shopify/Product/9",
    });
    expect(read.ok).toBe(true);
    if (!read.ok) return;

    const plan = planShopifyTopologyDiff({
      localVariants: [
        {
          storeVariantId: "sv-1",
          selectedOptions: [{ name: "Title", value: "Default Title" }],
          priceCents: 299,
          sku: "INW-QA-CERT-20260930-01",
          shopifyVariantId: "gid://shopify/ProductVariant/8",
        },
      ],
      remoteVariants: read.topology.variants
        .filter((v) => v.inventoryItem?.id)
        .map((v) => ({
          shopifyVariantId: v.id,
          shopifyInventoryItemId: v.inventoryItem!.id,
          selectedOptions: v.selectedOptions,
          priceCents: 299,
          sku: v.sku,
          available: v.inventoryQuantity ?? null,
          tracked: true,
        })),
      remoteOptions: read.topology.options.map((o) => ({
        id: o.id,
        name: o.name,
        position: o.position,
        values: o.optionValues.map((v, index) => ({
          id: v.id,
          name: v.name,
          position: index + 1,
        })),
      })),
      desiredOptionOrder: ["Title"],
    });
    expect(plan.kind).toBe("NOOP");
  });

  it("B: multi-option product preserves option and value order without value.position", async () => {
    executeShopifyAdminGraphql.mockResolvedValue({
      ok: true,
      data: {
        product: {
          options: [
            {
              id: "gid://shopify/ProductOption/color",
              name: "Color",
              position: 1,
              optionValues: [
                { id: "ov-blue", name: "Blue", hasVariants: true },
                { id: "ov-red", name: "Red", hasVariants: true },
              ],
            },
            {
              id: "gid://shopify/ProductOption/size",
              name: "Size",
              position: 2,
              optionValues: [
                { id: "ov-s", name: "Small", hasVariants: true },
                { id: "ov-l", name: "Large", hasVariants: true },
              ],
            },
          ],
          variants: {
            nodes: [
              {
                id: "gid://shopify/ProductVariant/b-s",
                price: "1.00",
                sku: "B-S",
                selectedOptions: [
                  { name: "Color", value: "Blue" },
                  { name: "Size", value: "Small" },
                ],
                inventoryItem: { id: "gid://shopify/InventoryItem/b-s" },
                inventoryQuantity: 1,
              },
              {
                id: "gid://shopify/ProductVariant/b-l",
                price: "1.00",
                sku: "B-L",
                selectedOptions: [
                  { name: "Color", value: "Blue" },
                  { name: "Size", value: "Large" },
                ],
                inventoryItem: { id: "gid://shopify/InventoryItem/b-l" },
                inventoryQuantity: 1,
              },
              {
                id: "gid://shopify/ProductVariant/r-s",
                price: "1.00",
                sku: "R-S",
                selectedOptions: [
                  { name: "Color", value: "Red" },
                  { name: "Size", value: "Small" },
                ],
                inventoryItem: { id: "gid://shopify/InventoryItem/r-s" },
                inventoryQuantity: 1,
              },
              {
                id: "gid://shopify/ProductVariant/r-l",
                price: "1.00",
                sku: "R-L",
                selectedOptions: [
                  { name: "Color", value: "Red" },
                  { name: "Size", value: "Large" },
                ],
                inventoryItem: { id: "gid://shopify/InventoryItem/r-l" },
                inventoryQuantity: 1,
              },
            ],
          },
        },
      },
    });

    const read = await readShopifyProductTopology({
      connectionId: "conn-1",
      productId: "gid://shopify/Product/mv",
    });
    expect(read.ok).toBe(true);
    if (!read.ok) return;

    expect(read.topology.options.map((o) => o.name)).toEqual(["Color", "Size"]);
    expect(read.topology.options[0].optionValues.map((v) => v.name)).toEqual(["Blue", "Red"]);
    expect(read.topology.options[1].optionValues.map((v) => v.name)).toEqual(["Small", "Large"]);
    expect(read.topology.options[0].optionValues[0]).not.toHaveProperty("position");

    const remoteOptions = read.topology.options.map((o) => ({
      id: o.id,
      name: o.name,
      position: o.position,
      values: o.optionValues.map((v, index) => ({
        id: v.id,
        name: v.name,
        position: index + 1,
      })),
    }));
    expect(remoteOptions[0].values.map((v) => v.name)).toEqual(["Blue", "Red"]);
    expect(remoteOptions[1].values.map((v) => v.name)).toEqual(["Small", "Large"]);

    const plan = planShopifyTopologyDiff({
      localVariants: read.topology.variants.map((v, i) => ({
        storeVariantId: `sv-${i}`,
        selectedOptions: v.selectedOptions,
        priceCents: 100,
        sku: v.sku,
        shopifyVariantId: v.id,
      })),
      remoteVariants: read.topology.variants.map((v) => ({
        shopifyVariantId: v.id,
        shopifyInventoryItemId: v.inventoryItem!.id,
        selectedOptions: v.selectedOptions,
        priceCents: 100,
        sku: v.sku,
        available: 1,
        tracked: true,
      })),
      remoteOptions,
      desiredOptionOrder: ["Color", "Size"],
    });
    expect(plan.kind).toBe("NOOP");

    const reorderPlan = planShopifyTopologyDiff({
      localVariants: read.topology.variants.map((v, i) => ({
        storeVariantId: `sv-${i}`,
        selectedOptions: v.selectedOptions,
        priceCents: 100,
        sku: v.sku,
        shopifyVariantId: v.id,
      })),
      remoteVariants: read.topology.variants.map((v) => ({
        shopifyVariantId: v.id,
        shopifyInventoryItemId: v.inventoryItem!.id,
        selectedOptions: v.selectedOptions,
        priceCents: 100,
        sku: v.sku,
        available: 1,
        tracked: true,
      })),
      remoteOptions,
      desiredOptionOrder: ["Size", "Color"],
    });
    expect(reorderPlan.kind).toBe("MUTATE");
    if (reorderPlan.kind !== "MUTATE") return;
    expect(reorderPlan.reorderOptionNames).toEqual(["Size", "Color"]);
  });

  it("does not call topology mutations for simple already-mapped product", async () => {
    executeShopifyAdminGraphql.mockResolvedValue({
      ok: true,
      data: {
        product: {
          options: [
            {
              id: "gid://shopify/ProductOption/title",
              name: "Title",
              position: 1,
              optionValues: [
                {
                  id: "gid://shopify/ProductOptionValue/default",
                  name: "Default Title",
                  hasVariants: true,
                },
              ],
            },
          ],
          variants: {
            nodes: [
              {
                id: "gid://shopify/ProductVariant/8",
                price: "2.99",
                sku: "SKU",
                selectedOptions: [{ name: "Title", value: "Default Title" }],
                inventoryItem: { id: "gid://shopify/InventoryItem/7" },
                inventoryQuantity: 3,
              },
            ],
          },
        },
      },
    });

    const result = await syncShopifyListingTopology({
      connectionId: "conn-1",
      memberId: "mem-1",
      listingLinkId: "link-1",
      productId: "gid://shopify/Product/9",
      storeItemId: "item-1",
      localVariants: [
        {
          storeVariantId: "sv-1",
          selectedOptions: [],
          priceCents: 299,
          sku: "SKU",
          shopifyVariantId: "gid://shopify/ProductVariant/8",
        },
      ],
      desiredOptionOrder: ["Title"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.kind).toBe("NOOP");
    // Only the topology read query — no create/reorder/bulk mutations.
    expect(executeShopifyAdminGraphql).toHaveBeenCalledTimes(1);
    expect(executeShopifyAdminGraphql.mock.calls[0][0].operationName).toBe(
      "ShopifyProductTopologyRead"
    );
  });

  it("adds a Shopify Material variant and leaves the preexisting quantity alone", async () => {
    const { prisma, appendShopifyVariantMaps } = await import("database");
    executeShopifyAdminGraphql.mockResolvedValue({
      ok: true,
      data: {
        product: {
          options: [
            {
              id: "gid://shopify/ProductOption/color",
              name: "Color",
              position: 1,
              optionValues: [{ id: "ov-red", name: "Red", hasVariants: true }],
            },
            {
              id: "gid://shopify/ProductOption/size",
              name: "Size",
              position: 2,
              optionValues: [{ id: "ov-m", name: "M", hasVariants: true }],
            },
            {
              id: "gid://shopify/ProductOption/material",
              name: "Material",
              position: 3,
              optionValues: [
                { id: "ov-cotton", name: "Cotton", hasVariants: true },
                { id: "ov-wool", name: "Wool", hasVariants: true },
              ],
            },
          ],
          variants: {
            nodes: [
              {
                id: "gid://shopify/ProductVariant/1",
                price: "10.00",
                sku: null,
                selectedOptions: [
                  { name: "Color", value: "Red" },
                  { name: "Size", value: "M" },
                  { name: "Material", value: "Cotton" },
                ],
                inventoryItem: { id: "gid://shopify/InventoryItem/1" },
                inventoryQuantity: 4,
              },
              {
                id: "gid://shopify/ProductVariant/2",
                price: "12.00",
                sku: null,
                selectedOptions: [
                  { name: "Color", value: "Red" },
                  { name: "Size", value: "M" },
                  { name: "Material", value: "Wool" },
                ],
                inventoryItem: { id: "gid://shopify/InventoryItem/2" },
                inventoryQuantity: 2,
              },
            ],
          },
        },
      },
    });

    const result = await syncShopifyListingTopology({
      connectionId: "conn-1",
      memberId: "mem-1",
      listingLinkId: "link-1",
      productId: "gid://shopify/Product/1",
      storeItemId: "item-1",
      localVariants: [
        {
          storeVariantId: "sv-red",
          selectedOptions: [
            { name: "Color", value: "Red" },
            { name: "Size", value: "M" },
          ],
          priceCents: 1000,
          sku: null,
          shopifyVariantId: "gid://shopify/ProductVariant/1",
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.kind).toBe("MUTATE");
    expect(result.importedStoreVariantIds).toEqual(["sv-new"]);
    expect(prisma.storeVariant.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "sv-red" }),
        data: {
          options: { Color: "Red", Size: "M", Material: "Cotton" },
        },
      })
    );
    expect(prisma.storeVariant.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          options: { Color: "Red", Size: "M", Material: "Wool" },
          priceCents: 1200,
        }),
      })
    );
    expect(prisma.inventoryState.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ variantId: "sv-new", onHand: 2 }),
      })
    );
    const adoptedExisting = vi
      .mocked(prisma.inventoryState.update)
      .mock.calls.some((call) => {
        const arg = call[0] as { where?: { variantId?: string } };
        return arg.where?.variantId === "sv-red";
      });
    expect(adoptedExisting).toBe(false);
    const adoptedWool = vi
      .mocked(prisma.inventoryState.update)
      .mock.calls.some((call) => {
        const arg = call[0] as {
          where?: { variantId?: string };
          data?: { onHand?: number };
        };
        return arg.where?.variantId === "sv-new" && arg.data?.onHand === 2;
      });
    expect(adoptedWool).toBe(true);
    expect(appendShopifyVariantMaps).toHaveBeenCalled();
    const operationNames = executeShopifyAdminGraphql.mock.calls.map(
      (call) => (call[0] as { operationName?: string }).operationName
    );
    expect(operationNames).toEqual(["ShopifyProductTopologyRead"]);
  });

  it("rebinds an unmapped local Wool placeholder to Shopify price and quantity", async () => {
    const { prisma, appendShopifyVariantMaps } = await import("database");
    vi.mocked(prisma.storeVariant.create).mockClear();
    vi.mocked(prisma.storeVariant.updateMany).mockClear();
    vi.mocked(prisma.inventoryState.create).mockClear();
    vi.mocked(prisma.inventoryState.update).mockClear();
    vi.mocked(prisma.inventoryState.findUnique).mockClear();
    vi.mocked(appendShopifyVariantMaps).mockClear();
    executeShopifyAdminGraphql.mockResolvedValue({
      ok: true,
      data: {
        product: {
          options: [
            {
              id: "gid://shopify/ProductOption/color",
              name: "Color",
              position: 1,
              optionValues: [{ id: "ov-red", name: "Red", hasVariants: true }],
            },
            {
              id: "gid://shopify/ProductOption/size",
              name: "Size",
              position: 2,
              optionValues: [{ id: "ov-m", name: "M", hasVariants: true }],
            },
            {
              id: "gid://shopify/ProductOption/material",
              name: "Material",
              position: 3,
              optionValues: [
                { id: "ov-cotton", name: "Cotton", hasVariants: true },
                { id: "ov-wool", name: "Wool", hasVariants: true },
              ],
            },
          ],
          variants: {
            nodes: [
              {
                id: "gid://shopify/ProductVariant/1",
                price: "12.00",
                sku: null,
                selectedOptions: [
                  { name: "Color", value: "Red" },
                  { name: "Size", value: "M" },
                  { name: "Material", value: "Cotton" },
                ],
                inventoryItem: { id: "gid://shopify/InventoryItem/1" },
                inventoryQuantity: 5,
              },
              {
                id: "gid://shopify/ProductVariant/2",
                price: "15.00",
                sku: null,
                selectedOptions: [
                  { name: "Color", value: "Red" },
                  { name: "Size", value: "M" },
                  { name: "Material", value: "Wool" },
                ],
                inventoryItem: { id: "gid://shopify/InventoryItem/2" },
                inventoryQuantity: 7,
              },
            ],
          },
        },
      },
    });

    const result = await syncShopifyListingTopology({
      connectionId: "conn-1",
      memberId: "mem-1",
      listingLinkId: "link-1",
      productId: "gid://shopify/Product/1",
      storeItemId: "item-1",
      localVariants: [
        {
          storeVariantId: "sv-cotton",
          selectedOptions: [
            { name: "Color", value: "Red" },
            { name: "Size", value: "M" },
            { name: "Material", value: "Cotton" },
          ],
          priceCents: 1200,
          sku: null,
          shopifyVariantId: "gid://shopify/ProductVariant/1",
        },
        {
          // Placeholder from an earlier matrix expand — wrong price/qty, no Shopify map yet.
          storeVariantId: "sv-wool-placeholder",
          selectedOptions: [
            { name: "Color", value: "Red" },
            { name: "Size", value: "M" },
            { name: "Material", value: "Wool" },
          ],
          priceCents: 1100,
          sku: null,
          shopifyVariantId: null,
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.kind).toBe("MUTATE");
    expect(prisma.storeVariant.create).not.toHaveBeenCalled();
    expect(prisma.storeVariant.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "sv-wool-placeholder" }),
        data: expect.objectContaining({
          options: { Color: "Red", Size: "M", Material: "Wool" },
          priceCents: 1500,
        }),
      })
    );
    const adoptedWool = vi
      .mocked(prisma.inventoryState.update)
      .mock.calls.some((call) => {
        const arg = call[0] as {
          where?: { variantId?: string };
          data?: { onHand?: number };
        };
        return arg.where?.variantId === "sv-wool-placeholder" && arg.data?.onHand === 7;
      });
    expect(adoptedWool).toBe(true);
    expect(appendShopifyVariantMaps).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        variants: [
          expect.objectContaining({
            storeVariantId: "sv-wool-placeholder",
            shopifyVariantId: "gid://shopify/ProductVariant/2",
          }),
        ],
      })
    );
  });

  it("pushes a variant added in INW onto Shopify", async () => {
    executeShopifyAdminGraphql.mockImplementation(async (call: { operationName?: string }) => {
      if (call.operationName === "ShopifyProductTopologyRead") {
        return {
          ok: true,
          data: {
            product: {
              options: [
                {
                  id: "gid://shopify/ProductOption/color",
                  name: "Color",
                  position: 1,
                  optionValues: [{ id: "ov-red", name: "Red", hasVariants: true }],
                },
              ],
              variants: {
                nodes: [
                  {
                    id: "gid://shopify/ProductVariant/1",
                    price: "10.00",
                    sku: null,
                    selectedOptions: [{ name: "Color", value: "Red" }],
                    inventoryItem: { id: "gid://shopify/InventoryItem/1" },
                    inventoryQuantity: 4,
                  },
                ],
              },
            },
          },
        };
      }
      if (call.operationName === "ShopifyProductOptionAddValues") {
        return { ok: true, data: { productOptionUpdate: { userErrors: [] } } };
      }
      if (call.operationName === "ShopifyProductVariantsBulkCreate") {
        return {
          ok: true,
          data: {
            productVariantsBulkCreate: {
              productVariants: [
                {
                  id: "gid://shopify/ProductVariant/2",
                  selectedOptions: [{ name: "Color", value: "Blue" }],
                  inventoryItem: { id: "gid://shopify/InventoryItem/2" },
                },
              ],
              userErrors: [],
            },
          },
        };
      }
      return {
        ok: false,
        class: "GRAPHQL_PERMANENT",
        message: call.operationName ?? "unexpected",
        outcomeUnknown: false,
      };
    });

    const result = await syncShopifyListingTopology({
      connectionId: "conn-1",
      memberId: "mem-1",
      listingLinkId: "link-1",
      productId: "gid://shopify/Product/1",
      storeItemId: "item-1",
      localVariants: [
        {
          storeVariantId: "sv-red",
          selectedOptions: [{ name: "Color", value: "Red" }],
          priceCents: 1000,
          sku: null,
          shopifyVariantId: "gid://shopify/ProductVariant/1",
        },
        {
          storeVariantId: "sv-blue",
          selectedOptions: [{ name: "Color", value: "Blue" }],
          priceCents: 1000,
          sku: null,
          shopifyVariantId: null,
        },
      ],
    });

    expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
    const operationNames = executeShopifyAdminGraphql.mock.calls.map(
      (call) => (call[0] as { operationName?: string }).operationName
    );
    expect(operationNames).toContain("ShopifyProductOptionAddValues");
    expect(operationNames).toContain("ShopifyProductVariantsBulkCreate");
    const createCall = executeShopifyAdminGraphql.mock.calls.find(
      (call) =>
        (call[0] as { operationName?: string }).operationName ===
        "ShopifyProductVariantsBulkCreate"
    );
    const variables = (createCall?.[0] as { variables?: { variants?: Array<{ optionValues?: unknown }> } })
      .variables;
    expect(JSON.stringify(variables)).toContain("Blue");
  });

  it("deletes a Shopify variant the seller removed in INW", async () => {
    const { prisma } = await import("database");
    vi.mocked(prisma.storeVariant.create).mockClear();
    let topologyReads = 0;
    executeShopifyAdminGraphql.mockImplementation(async (call: { operationName?: string }) => {
      if (call.operationName === "ShopifyProductTopologyRead") {
        topologyReads += 1;
        // After MANAGE deletes Blue, later reads only see Red.
        if (topologyReads === 1) {
          return {
            ok: true,
            data: {
              product: {
                options: [
                  {
                    id: "gid://shopify/ProductOption/color",
                    name: "Color",
                    position: 1,
                    optionValues: [
                      { id: "ov-red", name: "Red", hasVariants: true },
                      { id: "ov-blue", name: "Blue", hasVariants: true },
                    ],
                  },
                ],
                variants: {
                  nodes: [
                    {
                      id: "gid://shopify/ProductVariant/1",
                      price: "10.00",
                      sku: null,
                      selectedOptions: [{ name: "Color", value: "Red" }],
                      inventoryItem: { id: "gid://shopify/InventoryItem/1" },
                      inventoryQuantity: 4,
                    },
                    {
                      id: "gid://shopify/ProductVariant/2",
                      price: "10.00",
                      sku: null,
                      selectedOptions: [{ name: "Color", value: "Blue" }],
                      inventoryItem: { id: "gid://shopify/InventoryItem/2" },
                      inventoryQuantity: 3,
                    },
                  ],
                },
              },
            },
          };
        }
        return {
          ok: true,
          data: {
            product: {
              options: [
                {
                  id: "gid://shopify/ProductOption/color",
                  name: "Color",
                  position: 1,
                  optionValues: [{ id: "ov-red", name: "Red", hasVariants: true }],
                },
              ],
              variants: {
                nodes: [
                  {
                    id: "gid://shopify/ProductVariant/1",
                    price: "10.00",
                    sku: null,
                    selectedOptions: [{ name: "Color", value: "Red" }],
                    inventoryItem: { id: "gid://shopify/InventoryItem/1" },
                    inventoryQuantity: 4,
                  },
                ],
              },
            },
          },
        };
      }
      if (call.operationName === "ShopifyProductOptionDeleteValues") {
        return {
          ok: true,
          data: { productOptionUpdate: { userErrors: [] } },
        };
      }
      if (call.operationName === "ShopifyProductVariantsBulkDelete") {
        return {
          ok: true,
          data: { productVariantsBulkDelete: { userErrors: [] } },
        };
      }
      return {
        ok: false,
        class: "GRAPHQL_PERMANENT",
        message: call.operationName ?? "unexpected",
        outcomeUnknown: false,
      };
    });

    const result = await syncShopifyListingTopology({
      connectionId: "conn-1",
      memberId: "mem-1",
      listingLinkId: "link-1",
      productId: "gid://shopify/Product/1",
      storeItemId: "item-1",
      localVariants: [
        {
          storeVariantId: "sv-red",
          selectedOptions: [{ name: "Color", value: "Red" }],
          priceCents: 1000,
          sku: null,
          shopifyVariantId: "gid://shopify/ProductVariant/1",
        },
      ],
      removedVariants: [
        {
          storeVariantId: "sv-blue",
          shopifyVariantId: "gid://shopify/ProductVariant/2",
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(prisma.storeVariant.create).not.toHaveBeenCalled();
    expect(prisma.shopifyVariantMap.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          shopifyVariantId: "gid://shopify/ProductVariant/2",
          storeVariantId: "sv-blue",
        }),
      })
    );
    const deleteValuesCall = executeShopifyAdminGraphql.mock.calls.find(
      (call) =>
        (call[0] as { operationName?: string }).operationName ===
        "ShopifyProductOptionDeleteValues"
    );
    expect(deleteValuesCall).toBeTruthy();
    const variables = (
      deleteValuesCall?.[0] as {
        variables?: {
          optionValuesToDelete?: string[];
          variantStrategy?: string;
        };
      }
    ).variables;
    expect(variables?.optionValuesToDelete).toEqual(["ov-blue"]);
    expect(variables?.variantStrategy).toBe("MANAGE");
  });

  it("rewrites Shopify with productSet instead of orphaning one variant on axis removal", async () => {
    const { prisma, appendShopifyVariantMaps } = await import("database");
    vi.mocked(prisma.storeVariant.create).mockClear();
    vi.mocked(prisma.shopifyVariantMap.deleteMany).mockClear();
    vi.mocked(appendShopifyVariantMaps).mockClear();
    executeShopifyAdminGraphql.mockImplementation(async (call: { operationName?: string }) => {
      if (call.operationName === "ShopifyProductTopologyRead") {
        return {
          ok: true,
          data: {
            product: {
              options: [
                {
                  id: "gid://shopify/ProductOption/material",
                  name: "Material",
                  position: 1,
                  optionValues: [
                    { id: "ov-cotton", name: "Cotton", hasVariants: true },
                    { id: "ov-wool", name: "Wool", hasVariants: true },
                  ],
                },
                {
                  id: "gid://shopify/ProductOption/color",
                  name: "Color",
                  position: 2,
                  optionValues: [{ id: "ov-green", name: "Green", hasVariants: true }],
                },
                {
                  id: "gid://shopify/ProductOption/size",
                  name: "Size",
                  position: 3,
                  optionValues: [
                    { id: "ov-s", name: "Small", hasVariants: true },
                    { id: "ov-l", name: "Large", hasVariants: true },
                  ],
                },
              ],
              variants: {
                nodes: [
                  {
                    id: "gid://shopify/ProductVariant/1",
                    price: "12.00",
                    sku: null,
                    selectedOptions: [
                      { name: "Material", value: "Cotton" },
                      { name: "Color", value: "Green" },
                      { name: "Size", value: "Large" },
                    ],
                    inventoryItem: { id: "gid://shopify/InventoryItem/1" },
                    inventoryQuantity: 5,
                  },
                  {
                    id: "gid://shopify/ProductVariant/2",
                    price: "12.00",
                    sku: null,
                    selectedOptions: [
                      { name: "Material", value: "Wool" },
                      { name: "Color", value: "Green" },
                      { name: "Size", value: "Small" },
                    ],
                    inventoryItem: { id: "gid://shopify/InventoryItem/2" },
                    inventoryQuantity: 2,
                  },
                ],
              },
            },
          },
        };
      }
      if (call.operationName === "ShopifyCreateListingProductSet") {
        return {
          ok: true,
          data: {
            productSet: {
              product: {
                id: "gid://shopify/Product/1",
                status: "ACTIVE",
                variants: {
                  nodes: [
                    {
                      id: "gid://shopify/ProductVariant/101",
                      selectedOptions: [
                        { name: "Color", value: "Green" },
                        { name: "Size", value: "Large" },
                      ],
                      inventoryItem: { id: "gid://shopify/InventoryItem/201" },
                    },
                    {
                      id: "gid://shopify/ProductVariant/102",
                      selectedOptions: [
                        { name: "Color", value: "Green" },
                        { name: "Size", value: "Small" },
                      ],
                      inventoryItem: { id: "gid://shopify/InventoryItem/202" },
                    },
                  ],
                },
              },
              userErrors: [],
            },
          },
        };
      }
      return {
        ok: false,
        class: "GRAPHQL_PERMANENT",
        message: call.operationName ?? "unexpected",
        outcomeUnknown: false,
      };
    });

    // Local dropped Material; rematch created new unmapped Color×Size rows while
    // old Material maps are removedVariants — the old delete-nearly-all path.
    const result = await syncShopifyListingTopology({
      connectionId: "conn-1",
      memberId: "mem-1",
      listingLinkId: "link-1",
      productId: "gid://shopify/Product/1",
      storeItemId: "item-1",
      localVariants: [
        {
          storeVariantId: "sv-green-large",
          selectedOptions: [
            { name: "Color", value: "Green" },
            { name: "Size", value: "Large" },
          ],
          priceCents: 1200,
          sku: null,
          shopifyVariantId: null,
        },
        {
          storeVariantId: "sv-green-small",
          selectedOptions: [
            { name: "Color", value: "Green" },
            { name: "Size", value: "Small" },
          ],
          priceCents: 1200,
          sku: null,
          shopifyVariantId: null,
        },
      ],
      removedVariants: [
        {
          storeVariantId: "sv-old-cotton-large",
          shopifyVariantId: "gid://shopify/ProductVariant/1",
        },
        {
          storeVariantId: "sv-old-wool-small",
          shopifyVariantId: "gid://shopify/ProductVariant/2",
        },
      ],
    });

    expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
    const operationNames = executeShopifyAdminGraphql.mock.calls.map(
      (call) => (call[0] as { operationName?: string }).operationName
    );
    expect(operationNames).toContain("ShopifyCreateListingProductSet");
    expect(operationNames).not.toContain("ShopifyProductVariantsBulkDelete");
    expect(prisma.shopifyVariantMap.deleteMany).toHaveBeenCalled();
    expect(appendShopifyVariantMaps).toHaveBeenCalled();
  });
});
