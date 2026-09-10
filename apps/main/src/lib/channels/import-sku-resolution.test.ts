import { describe, expect, it } from "vitest";
import { resolveInboundSkuMatch } from "./import-listing";

const row = (id: string, links = 0) => ({
  id,
  category: null,
  subcategory: null,
  channelLinks: Array.from({ length: links }, (_, i) => ({ id: `${id}-l${i}` })),
});

describe("resolveInboundSkuMatch", () => {
  it("attaches to a StoreItem id match with inw_create origin", () => {
    const res = resolveInboundSkuMatch({ sku: "item-1", byId: row("item-1"), bySku: [] });
    expect(res).toMatchObject({ kind: "attach", id: "item-1", origin: "inw_create" });
  });

  it("does not attach to an id match already linked for this provider", () => {
    const res = resolveInboundSkuMatch({ sku: "item-1", byId: row("item-1", 1), bySku: [] });
    expect(res).toEqual({ kind: "none" });
  });

  it("attaches to a single unlinked SKU match with import origin", () => {
    const res = resolveInboundSkuMatch({ sku: "COIN-001", byId: null, bySku: [row("a")] });
    expect(res).toMatchObject({ kind: "attach", id: "a", origin: "import" });
  });

  it("flags ambiguous when the SKU maps to multiple unlinked items (avoids duplicate mint)", () => {
    const res = resolveInboundSkuMatch({
      sku: "DUP",
      byId: null,
      bySku: [row("a"), row("b")],
    });
    expect(res).toEqual({ kind: "ambiguous", count: 2 });
  });

  it("mints (none) when all same-SKU items are already linked", () => {
    const res = resolveInboundSkuMatch({
      sku: "DUP",
      byId: null,
      bySku: [row("a", 1), row("b", 1)],
    });
    expect(res).toEqual({ kind: "none" });
  });

  it("mints (none) for an empty sku", () => {
    expect(resolveInboundSkuMatch({ sku: "   ", byId: null, bySku: [] })).toEqual({ kind: "none" });
  });
});
