import { describe, expect, it } from "vitest";
import {
  findFlattenedEtsyCategory,
  flattenEtsyTaxonomyNodes,
  scoreEtsyCategoryMatch,
  searchFlattenedEtsyCategories,
  type EtsyTaxonomyApiNode,
} from "./taxonomy-search";

const tree: EtsyTaxonomyApiNode[] = [
  {
    id: 1,
    name: "Art & Collectibles",
    children: [
      {
        id: 28,
        name: "Collectibles",
        children: [{ id: 33, name: "Coins & Money" }, { id: 34, name: "Stamps" }],
      },
    ],
  },
  {
    id: 84,
    name: "Home & Living",
    children: [
      { id: 891, name: "Home Decor" },
      {
        id: 900,
        name: "Clocks",
        children: [{ id: 901, name: "Wall Clocks" }, { id: 902, name: "Desk Clocks" }],
      },
    ],
  },
];

describe("flattenEtsyTaxonomyNodes", () => {
  it("records parents and leaves with full paths", () => {
    const flat = flattenEtsyTaxonomyNodes(tree);
    expect(flat.find((n) => n.taxonomyId === 33)).toEqual({
      taxonomyId: 33,
      name: "Coins & Money",
      path: "Art & Collectibles > Collectibles > Coins & Money",
      isLeaf: true,
    });
    expect(flat.find((n) => n.taxonomyId === 1)?.isLeaf).toBe(false);
    expect(flat.find((n) => n.taxonomyId === 891)?.isLeaf).toBe(true);
  });
});

describe("searchFlattenedEtsyCategories", () => {
  const nodes = flattenEtsyTaxonomyNodes(tree);

  it("returns matching leaves for a keyword", () => {
    const hits = searchFlattenedEtsyCategories(nodes, "clock");
    expect(hits.map((h) => h.taxonomyId)).toEqual([901, 902]);
    expect(hits[0]?.categoryPath).toContain("Wall Clocks");
  });

  it("matches a path segment like collectibles", () => {
    const hits = searchFlattenedEtsyCategories(nodes, "collect");
    expect(hits.some((h) => h.taxonomyId === 33)).toBe(true);
    expect(hits.some((h) => h.taxonomyId === 34)).toBe(true);
    expect(hits.every((h) => h.categoryPath.includes("Collectibles"))).toBe(true);
  });

  it("does not return parent nodes as selectable results", () => {
    const hits = searchFlattenedEtsyCategories(nodes, "home");
    expect(hits.some((h) => h.taxonomyId === 84)).toBe(false);
    expect(hits.some((h) => h.taxonomyId === 891)).toBe(true);
  });

  it("returns nothing for a 1-character query", () => {
    expect(searchFlattenedEtsyCategories(nodes, "c")).toEqual([]);
  });
});

describe("scoreEtsyCategoryMatch", () => {
  it("scores an exact leaf name above a path contains match", () => {
    const exact = scoreEtsyCategoryMatch("stamps", {
      taxonomyId: 34,
      name: "Stamps",
      path: "Art & Collectibles > Collectibles > Stamps",
      isLeaf: true,
    });
    const pathOnly = scoreEtsyCategoryMatch("stamps", {
      taxonomyId: 99,
      name: "Postage",
      path: "Paper > Stamps > Postage",
      isLeaf: true,
    });
    expect(exact).toBeGreaterThan(pathOnly);
  });
});

describe("findFlattenedEtsyCategory", () => {
  it("looks up a saved taxonomy id including parents", () => {
    const nodes = flattenEtsyTaxonomyNodes(tree);
    expect(findFlattenedEtsyCategory(nodes, 28)?.categoryPath).toBe(
      "Art & Collectibles > Collectibles"
    );
    expect(findFlattenedEtsyCategory(nodes, 999)).toBeNull();
  });
});
