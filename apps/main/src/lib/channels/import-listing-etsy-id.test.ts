import { describe, expect, it, vi } from "vitest";

vi.mock("./channel-category-mapping", () => ({
  resolveFromChannelCategoryMapping: vi.fn(async (args: { remoteCategoryId?: string | null }) => {
    if (args.remoteCategoryId === "999001") {
      return {
        category: "Food & Drink",
        subcategory: "Pantry & Packaged",
        matchedPreset: true,
        score: 1,
        source: "db_mapping",
      };
    }
    return null;
  }),
  upsertChannelCategoryMappings: vi.fn().mockResolvedValue({ inserted: 0, updated: 0 }),
  ensureChannelCategoryMappingsSeeded: vi.fn().mockResolvedValue(undefined),
}));

describe("resolveInwCategoryFromEtsyTaxonomy — ID-only", () => {
  it("resolves a seeded taxonomy ID when the static name map has no label", async () => {
    const { resolveInwCategoryFromEtsyTaxonomy } = await import("./category-resolver");
    const r = await resolveInwCategoryFromEtsyTaxonomy(999001, null, null);
    expect(r?.category).toBe("Food & Drink");
    expect(r?.subcategory).toBe("Pantry & Packaged");
    expect(r?.matchedPreset).toBe(true);
  });
});
