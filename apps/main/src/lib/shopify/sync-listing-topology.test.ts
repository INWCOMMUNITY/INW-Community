import { beforeEach, describe, expect, it, vi } from "vitest";
import { planShopifyTopologyDiff } from "database";

const executeShopifyAdminGraphql = vi.fn();

vi.mock("./admin-graphql", () => ({
  executeShopifyAdminGraphql: (...args: unknown[]) => executeShopifyAdminGraphql(...args),
}));

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
});
