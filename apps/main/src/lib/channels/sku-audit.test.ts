import { describe, expect, it } from "vitest";
import {
  auditCatalog,
  buildRewriteVerdict,
  classifyChannelForItem,
  compactSkuAudit,
  finishSkuAuditReport,
  skusExact,
  skusNormalizedEqual,
  wixV1VariantSkuRows,
  type SkuAuditCatalogItem,
  type SkuAuditUnit,
} from "./sku-audit";

const ITEM_ID = "cmt7vumcl000dxjujvgwe8dob";

function item(partial: Partial<SkuAuditCatalogItem> & Pick<SkuAuditCatalogItem, "id">): SkuAuditCatalogItem {
  return {
    title: partial.title ?? "Listing",
    sku: partial.sku ?? null,
    variants: partial.variants ?? null,
    id: partial.id,
  };
}

describe("catalog SKU audit", () => {
  it("flags leftover parent {itemId}-Color and missing combo SKUs", () => {
    const units = auditCatalog([
      item({
        id: ITEM_ID,
        sku: `${ITEM_ID}-Purple`,
        variants: {
          axes: [
            { name: "Size", values: ["S"] },
            { name: "Color", values: ["Purple"] },
          ],
          skus: [{ options: { Size: "S", Color: "Purple" }, quantity: 1 }],
        },
      }),
    ]);
    const parent = units.find((u) => u.kind === "parent")!;
    const combo = units.find((u) => u.kind === "combo")!;
    expect(parent.catalogFindings).toContain("parent_is_variant_leftover");
    expect(parent.catalogFindings).toContain("has_hyphen_or_punct");
    expect(parent.catalogFindings).toContain("illegal_ebay");
    expect(parent.catalogFindings).toContain("uses_item_id");
    expect(combo.catalogFindings).toContain("missing");
  });

  it("does not flag alphanumeric combo SKUs prefixed with the item id as uses_item_id", () => {
    const units = auditCatalog([
      item({
        id: ITEM_ID,
        sku: "CLOCK",
        variants: {
          axes: [{ name: "Size", values: ["S"] }],
          skus: [{ options: { Size: "S" }, quantity: 1, sku: `${ITEM_ID}1505dff` }],
        },
      }),
    ]);
    const combo = units.find((u) => u.kind === "combo")!;
    expect(combo.catalogFindings).not.toContain("uses_item_id");
  });

  it("flags duplicate SKUs across listings (parent and combo)", () => {
    const units = auditCatalog([
      item({ id: "a", sku: "HAT42" }),
      item({
        id: "b",
        sku: "OTHER",
        variants: {
          axes: [{ name: "Size", values: ["M"] }],
          skus: [{ options: { Size: "M" }, quantity: 1, sku: "hat42" }],
        },
      }),
    ]);
    expect(units.find((u) => u.storeItemId === "a" && u.kind === "parent")?.catalogFindings).toContain(
      "duplicate_in_member"
    );
    expect(units.find((u) => u.storeItemId === "b" && u.kind === "combo")?.catalogFindings).toContain(
      "duplicate_in_member"
    );
  });

  it("flags blank parent as missing + uses_item_id", () => {
    const units = auditCatalog([item({ id: "x", sku: null })]);
    expect(units[0].catalogFindings).toEqual(["missing", "uses_item_id"]);
  });

  it("flags parent SKU that equals a combo SKU", () => {
    const units = auditCatalog([
      item({
        id: "p",
        sku: "NAVYS",
        variants: {
          axes: [{ name: "Color", values: ["Navy"] }],
          skus: [{ options: { Color: "Navy" }, quantity: 2, sku: "NAVYS" }],
        },
      }),
    ]);
    expect(units.find((u) => u.kind === "parent")?.catalogFindings).toContain("parent_equals_combo");
  });
});

describe("channel match classes", () => {
  const unit = (inwSku: string | null): SkuAuditUnit => ({
    storeItemId: "a",
    title: "Hat",
    kind: "parent",
    comboKey: null,
    comboLabel: null,
    options: null,
    inwSku,
    catalogFindings: [],
    channels: [],
  });

  it("treats identical strings as exact and hyphen-stripped as normalized", () => {
    expect(skusExact("HAT-42", "HAT-42")).toBe(true);
    expect(skusExact("HAT-42", "HAT42")).toBe(false);
    expect(skusNormalizedEqual("HAT-42", "HAT42")).toBe(true);

    const exact = classifyChannelForItem({
      units: [unit("HAT42")],
      remoteRows: [{ sku: "HAT42", options: {} }],
      provider: "shopify",
    });
    expect(exact.units[0].channels[0].class).toBe("exact");

    const normalized = classifyChannelForItem({
      units: [unit("HAT-42")],
      remoteRows: [{ sku: "HAT42", options: {} }],
      provider: "shopify",
    });
    expect(normalized.units[0].channels[0].class).toBe("normalized");
  });

  it("classifies option-only when SKUs differ but options match", () => {
    const combo: SkuAuditUnit = {
      ...unit("ABC-S-BR"),
      kind: "combo",
      comboKey: "color=brown|size=s",
      options: { Size: "S", Color: "Brown" },
    };
    const result = classifyChannelForItem({
      units: [combo],
      remoteRows: [{ sku: "OTHER", options: { Option: "brown", foo: "s" } }],
      provider: "wix",
    });
    expect(result.units[0].channels[0].class).toBe("option_only");
    expect(result.units[0].channels[0].matchQuality).toBe("values");
  });

  it("marks an unmatched live eBay Custom Label as live_alias_unpinned", () => {
    const combo: SkuAuditUnit = {
      ...unit("generated1"),
      kind: "combo",
      comboKey: "size=s",
      options: { Size: "S" },
    };
    const result = classifyChannelForItem({
      units: [combo],
      remoteRows: [{ sku: "liveCustom1", options: { Size: "S" } }],
      provider: "ebay",
      expectedEbayPushSkus: ["generated1"],
    });
    expect(result.units[0].channels[0].class).toBe("live_alias_unpinned");
  });
});

describe("rewrite verdict", () => {
  it("recommends pinning eBay / rewriting Shopify when hyphens are the gap", () => {
    const units = auditCatalog([item({ id: "a", sku: "HAT-42" })]);
    const withShopify = classifyChannelForItem({
      units,
      remoteRows: [{ sku: "HAT42", options: {} }],
      provider: "shopify",
    });
    const verdict = buildRewriteVerdict({ units: withShopify.units, extras: [] });
    expect(verdict.recommendation).toBe("pin_ebay_rewrite_shopify_fields");
    expect(verdict.hyphenOnlyShopifyMismatches).toBe(1);
  });

  it("recommends full identity reset only when eBay live SKUs are unusable and INW has none canonical", () => {
    const units: SkuAuditUnit[] = [
      {
        storeItemId: "a",
        title: "x",
        kind: "parent",
        comboKey: null,
        comboLabel: null,
        options: null,
        inwSku: null,
        catalogFindings: ["missing", "uses_item_id"],
        channels: [
          {
            provider: "ebay",
            remoteSku: "HAT-LIVE",
            class: "live_alias_unpinned",
            matchQuality: "none",
          },
        ],
      },
    ];
    const verdict = buildRewriteVerdict({ units, extras: [] });
    expect(verdict.inwCanonicalCount).toBe(0);
    expect(verdict.ebayLiveUnusable).toBeGreaterThan(0);
    expect(verdict.recommendation).toBe("full_identity_reset");
  });
});

describe("wix v1 sku rows", () => {
  it("reads variant.sku even when the INW matrix omitted it", () => {
    const rows = wixV1VariantSkuRows({
      sku: "PARENT",
      variants: [
        { sku: "HAT-S", choices: { Size: "S" } },
        { variant: { sku: "HAT-M" }, choices: { Size: "M" } },
      ],
    });
    expect(rows.map((r) => r.sku)).toEqual(["HAT-S", "HAT-M"]);
  });
});

describe("compact summary", () => {
  it("counts catalog issues", () => {
    const units = auditCatalog([item({ id: ITEM_ID, sku: `${ITEM_ID}-Purple` })]);
    const compact = compactSkuAudit(units, []);
    expect(compact.issueCount).toBeGreaterThan(0);
    expect(compact.topClasses.some((c) => c.class === "parent_is_variant_leftover")).toBe(true);
    const report = finishSkuAuditReport({ live: false, units, extras: [] });
    expect(report.compact.rewriteVerdict).toBe(compact.rewriteVerdict);
    expect(report.liveStatus.attempted).toBe(false);
    expect(report.liveStatus.listingsHydrated).toBe(0);
  });
});
