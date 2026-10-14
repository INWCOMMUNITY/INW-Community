import { describe, expect, it } from "vitest";
import { getSubcategoriesForCategory, STORE_CATEGORY_LABELS } from "@/lib/store-categories";
import {
  ETSY_TAXONOMY_NODES,
  mapEtsyTaxonomyToInw,
  type EtsyTaxonomyNode,
} from "./map-etsy-category";

function nodeByPath(path: string[]): EtsyTaxonomyNode {
  const node = ETSY_TAXONOMY_NODES.find(
    (candidate) =>
      candidate.path.length === path.length &&
      candidate.path.every((segment, index) => segment === path[index])
  );
  if (!node) throw new Error(`Missing taxonomy path: ${path.join(" > ")}`);
  return node;
}

function mapped(path: string[]) {
  const result = mapEtsyTaxonomyToInw(nodeByPath(path).id);
  if (!result) throw new Error(`Unmapped path: ${path.join(" > ")}`);
  return result;
}

describe("etsy taxonomy to INW categories", () => {
  it("maps every snapshot node onto a real INW category and subcategory", () => {
    expect(ETSY_TAXONOMY_NODES.length).toBeGreaterThan(1000);
    const unmapped: number[] = [];
    for (const node of ETSY_TAXONOMY_NODES) {
      const result = mapEtsyTaxonomyToInw(node.id);
      if (!result) {
        unmapped.push(node.id);
        continue;
      }
      expect(STORE_CATEGORY_LABELS).toContain(result.category);
      expect(getSubcategoriesForCategory(result.category)).toContain(result.subcategory);
    }
    expect(unmapped).toEqual([]);
  });

  it("returns null for an id that is not in the snapshot", () => {
    expect(mapEtsyTaxonomyToInw(0)).toBeNull();
    expect(mapEtsyTaxonomyToInw(999_999_999)).toBeNull();
  });

  it("maps cross-category paths onto the INW browse category", () => {
    expect(mapped(["Accessories", "Hats & Head Coverings", "Hats & Caps"])).toEqual({
      category: "Accessories",
      subcategory: "Hats & Caps",
    });
    expect(mapped(["Accessories", "Belts & Suspenders", "Belts"])).toEqual({
      category: "Accessories",
      subcategory: "Belts",
    });
    expect(mapped(["Jewelry", "Necklaces", "Pendant Necklaces"])).toEqual({
      category: "Jewelry & Watches",
      subcategory: "Necklaces & Pendants",
    });
    expect(mapped(["Home & Living", "Furniture", "Bedroom Furniture"])).toEqual({
      category: "Furniture",
      subcategory: "Bedroom",
    });
    expect(mapped(["Home & Living", "Kitchen & Dining", "Cookware"])).toEqual({
      category: "Home & Kitchen",
      subcategory: "Cookware & Bakeware",
    });
    expect(mapped(["Home & Living", "Outdoor & Gardening", "Plants"])).toEqual({
      category: "Home & Garden",
      subcategory: "Plants & Seeds",
    });
    expect(mapped(["Home & Living", "Food & Drink", "Baked Goods"])).toEqual({
      category: "Food & Drink",
      subcategory: "Baked Goods",
    });
    expect(mapped(["Home & Living", "Home Improvement", "Plumbing"])).toEqual({
      category: "Tools & Home Improvement",
      subcategory: "Plumbing",
    });
    expect(mapped(["Books, Movies & Music", "Movies"])).toEqual({
      category: "Books, Movies & Music",
      subcategory: "Movies & TV",
    });
    expect(mapped(["Books, Movies & Music", "Music", "Musical Instruments"])).toMatchObject({
      category: "Musical Instruments",
    });
    expect(mapped(["Weddings"])).toEqual({
      category: "Wedding",
      subcategory: "Other Wedding",
    });
    expect(mapped(["Clothing", "Boys' Clothing"])).toEqual({
      category: "Baby & Kids",
      subcategory: "Kids Clothing",
    });
    expect(mapped(["Clothing", "Boys' Clothing", "Baby Boys' Clothing"])).toEqual({
      category: "Baby & Kids",
      subcategory: "Baby Clothing",
    });
    expect(mapped(["Electronics & Accessories", "Video Games", "Consoles"])).toEqual({
      category: "Video Games & Consoles",
      subcategory: "Consoles",
    });
    expect(mapped(["Bags & Purses", "Luggage & Travel", "Suitcases"])).toEqual({
      category: "Luggage & Travel",
      subcategory: "Suitcases & Luggage",
    });
    expect(mapped(["Pet Supplies", "Pet Toys", "Dog Toys"])).toEqual({
      category: "Pet Supplies",
      subcategory: "Dog",
    });
    expect(mapped(["Toys & Games", "Sports & Outdoor Recreation", "Camping"])).toEqual({
      category: "Sports & Outdoors",
      subcategory: "Camping & Hiking",
    });
    expect(mapped(["Bath & Beauty", "Baby & Child Care", "Diapers"])).toEqual({
      category: "Baby & Kids",
      subcategory: "Diapering",
    });
    expect(mapped(["Shoes", "Boys' Shoes"])).toEqual({
      category: "Shoes",
      subcategory: "Kids' Shoes",
    });
    expect(mapped(["Art & Collectibles", "Mixed Media & Collage", "Other Assemblage"])).toEqual({
      category: "Art & Collectibles",
      subcategory: "Mixed Media & Collage",
    });
  });
});
