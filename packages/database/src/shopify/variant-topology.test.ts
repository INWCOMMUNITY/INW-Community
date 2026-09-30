/**
 * Topology planner/applicator coverage.
 *
 * Foundation intentionally rejects seller structural Variant identity changes
 * (`structural_variant_change`). Seller INW→Shopify structural topology is
 * INTENTIONALLY UNSUPPORTED until a dedicated Foundation decision lifts that
 * block. Reconcile may still apply topology via syncShopifyListingTopology.
 */
import { describe, expect, it } from "vitest";
import {
  shopifyOptionCombinationKey,
  validateShopifyImportTopology,
  correlateVariantsByOptionCombination,
  planShopifyTopologyDiff,
  SHOPIFY_MAX_OPTION_DIMENSIONS,
  SHOPIFY_MAX_VARIANTS,
} from "./variant-topology";

describe("seller structural topology policy", () => {
  it("documents Foundation block: seller structural topology is intentionally unsupported", () => {
    // Production PATCH uses assertFoundationMatrixStructureUnchanged and throws
    // structural_variant_change when Variant identity set changes. Do not treat
    // missing UPDATE_LISTING_TOPOLOGY desire as a silent bug until that is lifted.
    expect(SHOPIFY_MAX_OPTION_DIMENSIONS).toBe(3);
    expect(SHOPIFY_MAX_VARIANTS).toBe(100);
  });
});

describe("shopifyOptionCombinationKey", () => {
  it("produces deterministic sorted key regardless of option order", () => {
    const a = shopifyOptionCombinationKey([
      { name: "Size", value: "M" },
      { name: "Color", value: "Red" },
    ]);
    const b = shopifyOptionCombinationKey([
      { name: "Color", value: "Red" },
      { name: "Size", value: "M" },
    ]);
    expect(a).toBe(b);
    expect(a).toBe("Color=Red|Size=M");
  });

  it("trims whitespace in names and values", () => {
    const key = shopifyOptionCombinationKey([
      { name: " Size ", value: " L " },
    ]);
    expect(key).toBe("Size=L");
  });
});

describe("validateShopifyImportTopology", () => {
  const makeVariant = (
    idx: number,
    opts: Array<{ name: string; value: string }>,
    overrides?: Partial<{
      priceCents: number;
      available: number | null;
      tracked: boolean;
    }>
  ) => ({
    shopifyVariantId: `gid://shopify/ProductVariant/${idx}`,
    shopifyInventoryItemId: `gid://shopify/InventoryItem/${idx}`,
    selectedOptions: opts,
    priceCents: overrides?.priceCents ?? 1000,
    sku: null,
    available: overrides?.available ?? 5,
    tracked: overrides?.tracked ?? true,
  });

  it("accepts valid 1-axis, 2-variant topology", () => {
    const result = validateShopifyImportTopology({
      axes: [{ name: "Size", position: 1, values: ["S", "M"] }],
      variants: [
        makeVariant(1, [{ name: "Size", value: "S" }]),
        makeVariant(2, [{ name: "Size", value: "M" }]),
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.axes).toHaveLength(1);
      expect(result.variants).toHaveLength(2);
    }
  });

  it("accepts valid 3-axis topology", () => {
    const result = validateShopifyImportTopology({
      axes: [
        { name: "Color", position: 1, values: ["Red", "Blue"] },
        { name: "Size", position: 2, values: ["S", "M"] },
        { name: "Material", position: 3, values: ["Cotton"] },
      ],
      variants: [
        makeVariant(1, [
          { name: "Color", value: "Red" },
          { name: "Size", value: "S" },
          { name: "Material", value: "Cotton" },
        ]),
        makeVariant(2, [
          { name: "Color", value: "Blue" },
          { name: "Size", value: "M" },
          { name: "Material", value: "Cotton" },
        ]),
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects >3 option dimensions", () => {
    const result = validateShopifyImportTopology({
      axes: [
        { name: "A", position: 1, values: ["1"] },
        { name: "B", position: 2, values: ["2"] },
        { name: "C", position: 3, values: ["3"] },
        { name: "D", position: 4, values: ["4"] },
      ],
      variants: [
        makeVariant(1, [
          { name: "A", value: "1" },
          { name: "B", value: "2" },
          { name: "C", value: "3" },
          { name: "D", value: "4" },
        ]),
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("OPTION_DIMENSION_LIMIT");
    }
  });

  it("rejects >100 variants", () => {
    const axes = [{ name: "ID", position: 1, values: Array.from({ length: 101 }, (_, i) => `v${i}`) }];
    const variants = Array.from({ length: 101 }, (_, i) =>
      makeVariant(i + 1, [{ name: "ID", value: `v${i}` }])
    );
    const result = validateShopifyImportTopology({ axes, variants });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("VARIANT_COUNT_LIMIT");
    }
  });

  it("rejects 0 variants", () => {
    const result = validateShopifyImportTopology({
      axes: [{ name: "Size", position: 1, values: ["S"] }],
      variants: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("VARIANT_COUNT_LIMIT");
    }
  });

  it("rejects duplicate option combinations", () => {
    const result = validateShopifyImportTopology({
      axes: [{ name: "Size", position: 1, values: ["S"] }],
      variants: [
        makeVariant(1, [{ name: "Size", value: "S" }]),
        makeVariant(2, [{ name: "Size", value: "S" }]),
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("DUPLICATE_COMBINATION");
    }
  });

  it("rejects duplicate variant GIDs", () => {
    const result = validateShopifyImportTopology({
      axes: [{ name: "Size", position: 1, values: ["S", "M"] }],
      variants: [
        {
          shopifyVariantId: "gid://shopify/ProductVariant/1",
          shopifyInventoryItemId: "gid://shopify/InventoryItem/1",
          selectedOptions: [{ name: "Size", value: "S" }],
          priceCents: 1000,
          sku: null,
          available: 5,
          tracked: true,
        },
        {
          shopifyVariantId: "gid://shopify/ProductVariant/1",
          shopifyInventoryItemId: "gid://shopify/InventoryItem/2",
          selectedOptions: [{ name: "Size", value: "M" }],
          priceCents: 1000,
          sku: null,
          available: 5,
          tracked: true,
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("DUPLICATE_VARIANT_GID");
    }
  });

  it("rejects missing variant GID", () => {
    const result = validateShopifyImportTopology({
      axes: [{ name: "Size", position: 1, values: ["S"] }],
      variants: [
        {
          shopifyVariantId: "",
          shopifyInventoryItemId: "gid://shopify/InventoryItem/1",
          selectedOptions: [{ name: "Size", value: "S" }],
          priceCents: 1000,
          sku: null,
          available: 5,
          tracked: true,
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("MISSING_VARIANT_GID");
    }
  });

  it("rejects invalid price", () => {
    const result = validateShopifyImportTopology({
      axes: [{ name: "Size", position: 1, values: ["S"] }],
      variants: [makeVariant(1, [{ name: "Size", value: "S" }], { priceCents: 0 })],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INVALID_PRICE");
    }
  });

  it("rejects option cardinality mismatch", () => {
    const result = validateShopifyImportTopology({
      axes: [
        { name: "Size", position: 1, values: ["S"] },
        { name: "Color", position: 2, values: ["Red"] },
      ],
      variants: [makeVariant(1, [{ name: "Size", value: "S" }])],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("OPTION_CARDINALITY");
    }
  });

  it("exports correct limits", () => {
    expect(SHOPIFY_MAX_OPTION_DIMENSIONS).toBe(3);
    expect(SHOPIFY_MAX_VARIANTS).toBe(100);
  });
});

describe("correlateVariantsByOptionCombination", () => {
  it("pairs variants by matching option combinations", () => {
    const result = correlateVariantsByOptionCombination({
      requested: [
        { storeVariantId: "sv-1", selectedOptions: [{ name: "Size", value: "S" }] },
        { storeVariantId: "sv-2", selectedOptions: [{ name: "Size", value: "M" }] },
      ],
      remote: [
        {
          shopifyVariantId: "gid://shopify/ProductVariant/20",
          shopifyInventoryItemId: "gid://shopify/InventoryItem/20",
          selectedOptions: [{ name: "Size", value: "M" }],
        },
        {
          shopifyVariantId: "gid://shopify/ProductVariant/10",
          shopifyInventoryItemId: "gid://shopify/InventoryItem/10",
          selectedOptions: [{ name: "Size", value: "S" }],
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pairs).toHaveLength(2);
    const sMatch = result.pairs.find((p) => p.storeVariantId === "sv-1");
    expect(sMatch?.shopifyVariantId).toBe("gid://shopify/ProductVariant/10");
    const mMatch = result.pairs.find((p) => p.storeVariantId === "sv-2");
    expect(mMatch?.shopifyVariantId).toBe("gid://shopify/ProductVariant/20");
  });

  it("fails on count mismatch", () => {
    const result = correlateVariantsByOptionCombination({
      requested: [
        { storeVariantId: "sv-1", selectedOptions: [{ name: "Size", value: "S" }] },
      ],
      remote: [
        {
          shopifyVariantId: "gid://shopify/ProductVariant/10",
          shopifyInventoryItemId: "gid://shopify/InventoryItem/10",
          selectedOptions: [{ name: "Size", value: "S" }],
        },
        {
          shopifyVariantId: "gid://shopify/ProductVariant/20",
          shopifyInventoryItemId: "gid://shopify/InventoryItem/20",
          selectedOptions: [{ name: "Size", value: "M" }],
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("VARIANT_COUNT_MISMATCH");
    }
  });

  it("fails when no matching remote combination exists", () => {
    const result = correlateVariantsByOptionCombination({
      requested: [
        { storeVariantId: "sv-1", selectedOptions: [{ name: "Size", value: "S" }] },
        { storeVariantId: "sv-2", selectedOptions: [{ name: "Size", value: "L" }] },
      ],
      remote: [
        {
          shopifyVariantId: "gid://shopify/ProductVariant/10",
          shopifyInventoryItemId: "gid://shopify/InventoryItem/10",
          selectedOptions: [{ name: "Size", value: "S" }],
        },
        {
          shopifyVariantId: "gid://shopify/ProductVariant/20",
          shopifyInventoryItemId: "gid://shopify/InventoryItem/20",
          selectedOptions: [{ name: "Size", value: "M" }],
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("OPTION_CORRELATION_FAILED");
    }
  });

  it("correlates multi-axis variants correctly", () => {
    const result = correlateVariantsByOptionCombination({
      requested: [
        {
          storeVariantId: "sv-1",
          selectedOptions: [
            { name: "Color", value: "Red" },
            { name: "Size", value: "S" },
          ],
        },
        {
          storeVariantId: "sv-2",
          selectedOptions: [
            { name: "Color", value: "Blue" },
            { name: "Size", value: "M" },
          ],
        },
      ],
      remote: [
        {
          shopifyVariantId: "gid://shopify/ProductVariant/20",
          shopifyInventoryItemId: "gid://shopify/InventoryItem/20",
          selectedOptions: [
            { name: "Size", value: "M" },
            { name: "Color", value: "Blue" },
          ],
        },
        {
          shopifyVariantId: "gid://shopify/ProductVariant/10",
          shopifyInventoryItemId: "gid://shopify/InventoryItem/10",
          selectedOptions: [
            { name: "Color", value: "Red" },
            { name: "Size", value: "S" },
          ],
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pairs).toHaveLength(2);
    const p1 = result.pairs.find((p) => p.storeVariantId === "sv-1")!;
    expect(p1.shopifyVariantId).toBe("gid://shopify/ProductVariant/10");
    const p2 = result.pairs.find((p) => p.storeVariantId === "sv-2")!;
    expect(p2.shopifyVariantId).toBe("gid://shopify/ProductVariant/20");
  });
});

describe("planShopifyTopologyDiff", () => {
  it("plans create for new local variant without productSet partial", () => {
    const plan = planShopifyTopologyDiff({
      localVariants: [
        {
          storeVariantId: "sv-s",
          selectedOptions: [{ name: "Size", value: "S" }],
          priceCents: 1000,
          sku: null,
          shopifyVariantId: "gid://shopify/ProductVariant/1",
        },
        {
          storeVariantId: "sv-l",
          selectedOptions: [{ name: "Size", value: "L" }],
          priceCents: 1200,
          sku: null,
          shopifyVariantId: null,
        },
      ],
      remoteVariants: [
        {
          shopifyVariantId: "gid://shopify/ProductVariant/1",
          shopifyInventoryItemId: "gid://shopify/InventoryItem/1",
          selectedOptions: [{ name: "Size", value: "S" }],
          priceCents: 1000,
          sku: null,
          available: 5,
          tracked: true,
        },
      ],
    });
    expect(plan.kind).toBe("MUTATE");
    if (plan.kind !== "MUTATE") return;
    expect(plan.forbidProductSetPartial).toBe(true);
    expect(plan.createVariants).toHaveLength(1);
    expect(plan.createVariants[0].storeVariantId).toBe("sv-l");
  });

  it("plans import for unmapped remote Shopify variant", () => {
    const plan = planShopifyTopologyDiff({
      localVariants: [
        {
          storeVariantId: "sv-s",
          selectedOptions: [{ name: "Size", value: "S" }],
          priceCents: 1000,
          sku: null,
          shopifyVariantId: "gid://shopify/ProductVariant/1",
        },
      ],
      remoteVariants: [
        {
          shopifyVariantId: "gid://shopify/ProductVariant/1",
          shopifyInventoryItemId: "gid://shopify/InventoryItem/1",
          selectedOptions: [{ name: "Size", value: "S" }],
          priceCents: 1000,
          sku: null,
          available: 5,
          tracked: true,
        },
        {
          shopifyVariantId: "gid://shopify/ProductVariant/2",
          shopifyInventoryItemId: "gid://shopify/InventoryItem/2",
          selectedOptions: [{ name: "Size", value: "M" }],
          priceCents: 1100,
          sku: null,
          available: 3,
          tracked: true,
        },
      ],
    });
    expect(plan.kind).toBe("MUTATE");
    if (plan.kind !== "MUTATE") return;
    expect(plan.importRemoteVariants).toHaveLength(1);
    expect(plan.importRemoteVariants[0].shopifyVariantId).toBe(
      "gid://shopify/ProductVariant/2"
    );
  });

  it("pulls remote option value onto mapped GID (Shopify→INW)", () => {
    const plan = planShopifyTopologyDiff({
      localVariants: [
        {
          storeVariantId: "sv-1",
          selectedOptions: [{ name: "Color", value: "Navy" }],
          priceCents: 1000,
          sku: null,
          shopifyVariantId: "gid://shopify/ProductVariant/9",
        },
      ],
      remoteVariants: [
        {
          shopifyVariantId: "gid://shopify/ProductVariant/9",
          shopifyInventoryItemId: "gid://shopify/InventoryItem/9",
          selectedOptions: [{ name: "Color", value: "Blue" }],
          priceCents: 1000,
          sku: null,
          available: 1,
          tracked: true,
        },
      ],
    });
    expect(plan.kind).toBe("MUTATE");
    if (plan.kind !== "MUTATE") return;
    expect(plan.renameOptionValues).toHaveLength(1);
    expect(plan.renameOptionValues[0].shopifyVariantId).toBe(
      "gid://shopify/ProductVariant/9"
    );
    expect(plan.renameOptionValues[0].optionValues).toEqual([
      { optionName: "Color", name: "Blue" },
    ]);
    expect(plan.createVariants).toHaveLength(0);
  });

  it("treats empty INW options as equivalent to Shopify Title/Default Title", () => {
    const plan = planShopifyTopologyDiff({
      localVariants: [
        {
          storeVariantId: "sv-1",
          selectedOptions: [],
          priceCents: 1000,
          sku: null,
          shopifyVariantId: "gid://shopify/ProductVariant/1",
        },
      ],
      remoteVariants: [
        {
          shopifyVariantId: "gid://shopify/ProductVariant/1",
          shopifyInventoryItemId: "gid://shopify/InventoryItem/1",
          selectedOptions: [{ name: "Title", value: "Default Title" }],
          priceCents: 1000,
          sku: null,
          available: 2,
          tracked: true,
        },
      ],
    });
    expect(plan.kind).toBe("NOOP");
  });

  it("pulls simple→multi option conversion on the same mapped GID", () => {
    const plan = planShopifyTopologyDiff({
      localVariants: [
        {
          storeVariantId: "sv-1",
          selectedOptions: [],
          priceCents: 1000,
          sku: null,
          shopifyVariantId: "gid://shopify/ProductVariant/1",
        },
      ],
      remoteVariants: [
        {
          shopifyVariantId: "gid://shopify/ProductVariant/1",
          shopifyInventoryItemId: "gid://shopify/InventoryItem/1",
          selectedOptions: [{ name: "Size", value: "S" }],
          priceCents: 1000,
          sku: null,
          available: 2,
          tracked: true,
        },
        {
          shopifyVariantId: "gid://shopify/ProductVariant/2",
          shopifyInventoryItemId: "gid://shopify/InventoryItem/2",
          selectedOptions: [{ name: "Size", value: "M" }],
          priceCents: 1100,
          sku: null,
          available: 3,
          tracked: true,
        },
      ],
    });
    expect(plan.kind).toBe("MUTATE");
    if (plan.kind !== "MUTATE") return;
    expect(plan.renameOptionValues).toHaveLength(1);
    expect(plan.renameOptionValues[0].optionValues).toEqual([
      { optionName: "Size", name: "S" },
    ]);
    expect(plan.importRemoteVariants).toHaveLength(1);
    expect(plan.importRemoteVariants[0].shopifyVariantId).toBe(
      "gid://shopify/ProductVariant/2"
    );
  });

  it("plans reorder when desired option order differs", () => {
    const plan = planShopifyTopologyDiff({
      localVariants: [
        {
          storeVariantId: "sv-1",
          selectedOptions: [
            { name: "Size", value: "S" },
            { name: "Color", value: "Red" },
          ],
          priceCents: 1000,
          sku: null,
          shopifyVariantId: "gid://shopify/ProductVariant/1",
        },
      ],
      remoteVariants: [
        {
          shopifyVariantId: "gid://shopify/ProductVariant/1",
          shopifyInventoryItemId: "gid://shopify/InventoryItem/1",
          selectedOptions: [
            { name: "Color", value: "Red" },
            { name: "Size", value: "S" },
          ],
          priceCents: 1000,
          sku: null,
          available: 1,
          tracked: true,
        },
      ],
      remoteOptions: [
        {
          id: "gid://shopify/ProductOption/color",
          name: "Color",
          position: 1,
          values: [{ id: "gid://shopify/ProductOptionValue/red", name: "Red" }],
        },
        {
          id: "gid://shopify/ProductOption/size",
          name: "Size",
          position: 2,
          values: [{ id: "gid://shopify/ProductOptionValue/s", name: "S" }],
        },
      ],
      desiredOptionOrder: ["Size", "Color"],
    });
    expect(plan.kind).toBe("MUTATE");
    if (plan.kind !== "MUTATE") return;
    expect(plan.reorderOptionNames).toEqual(["Size", "Color"]);
  });

  it("conflicts on concurrent incompatible topology changes", () => {
    const plan = planShopifyTopologyDiff({
      localVariants: [
        {
          storeVariantId: "sv-1",
          selectedOptions: [{ name: "Color", value: "Red" }],
          priceCents: 1000,
          sku: null,
          shopifyVariantId: "gid://shopify/ProductVariant/1",
        },
      ],
      remoteVariants: [
        {
          shopifyVariantId: "gid://shopify/ProductVariant/1",
          shopifyInventoryItemId: "gid://shopify/InventoryItem/1",
          selectedOptions: [{ name: "Color", value: "Red" }],
          priceCents: 1000,
          sku: null,
          available: 1,
          tracked: true,
        },
      ],
      remoteOptions: [
        {
          id: "o1",
          name: "Color",
          position: 1,
          values: [{ id: "v1", name: "Red" }],
        },
        {
          id: "o2",
          name: "Size",
          position: 2,
          values: [{ id: "v2", name: "XL" }],
        },
      ],
      // Local removed Size / added Material while remote still has Size.
      desiredOptionOrder: ["Material"],
    });
    expect(plan.kind).toBe("CONFLICT");
    if (plan.kind !== "CONFLICT") return;
    expect(plan.code).toBe("TOPOLOGY_CONCURRENT_CONFLICT");
  });
});
