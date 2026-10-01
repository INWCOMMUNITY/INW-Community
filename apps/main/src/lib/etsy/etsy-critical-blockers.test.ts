import { describe, expect, it } from "vitest";
import { normalizeEtsyTitle } from "database";
import { hydrateEtsyCandidateWithInventory, type EtsyImportCandidate } from "./import-discovery";
import { shouldCopyMarketplacePhotosToInw } from "@/lib/listing-photo-rehost";

describe("etsy import how-made fields", () => {
  it("preserves who_made / when_made / is_supply / taxonomy through inventory hydrate", () => {
    const base: EtsyImportCandidate = {
      etsyListingId: "555",
      title: "Candle",
      description: "Soy",
      state: "active",
      supported: true,
      unsupportedReason: null,
      priceCents: 2000,
      quantity: 2,
      sku: null,
      imageUrl: null,
      photos: [],
      recommendedStockMode: "PHYSICAL",
      variants: [],
      axes: [],
      etsyWhoMade: "i_did",
      etsyWhenMade: "made_to_order",
      etsyIsSupply: false,
      etsyTaxonomyId: 69150467,
    };
    const hydrated = hydrateEtsyCandidateWithInventory(base, {
      products: [
        {
          product_id: 1,
          offerings: [
            {
              offering_id: 9,
              quantity: 2,
              is_enabled: true,
              price: { amount: 2000, divisor: 100 },
            },
          ],
        },
      ],
    });
    expect(hydrated.etsyWhoMade).toBe("i_did");
    expect(hydrated.etsyWhenMade).toBe("made_to_order");
    expect(hydrated.etsyIsSupply).toBe(false);
    expect(hydrated.etsyTaxonomyId).toBe(69150467);
    expect(hydrated.supported).toBe(true);
  });
});

describe("etsy inbound title length", () => {
  it("supports truncating to Etsy max of 140 (not 80)", () => {
    const long = "A".repeat(160);
    const sliced = normalizeEtsyTitle(long).slice(0, 140);
    expect(sliced.length).toBe(140);
  });
});

describe("listing photo rehost gates", () => {
  it("rehosts only when every photo is marketplace CDN and none are INW-hosted", () => {
    expect(
      shouldCopyMarketplacePhotosToInw([
        "https://i.etsystatic.com/a.jpg",
        "https://i.etsystatic.com/b.jpg",
      ])
    ).toBe(true);
    expect(
      shouldCopyMarketplacePhotosToInw([
        "https://i.etsystatic.com/a.jpg",
        "https://public.blob.vercel-storage.com/x.jpg",
      ])
    ).toBe(false);
    expect(shouldCopyMarketplacePhotosToInw(["https://private.example/secret.jpg"])).toBe(false);
  });
});

describe("etsy taxonomy list payload", () => {
  it("omits etsyTaxonomyId when blank instead of forcing null", () => {
    const taxonomyId = "";
    const body = {
      etsyWhoMade: "i_did",
      etsyWhenMade: "2020_2024",
      etsyIsSupply: false,
      ...(taxonomyId.trim() && /^\d+$/.test(taxonomyId.trim())
        ? { etsyTaxonomyId: Number.parseInt(taxonomyId.trim(), 10) }
        : {}),
    };
    expect(body).not.toHaveProperty("etsyTaxonomyId");
    expect(JSON.stringify(body)).not.toContain("etsyTaxonomyId");
  });

  it("includes numeric taxonomy when provided", () => {
    const taxonomyId = "101";
    const body = {
      etsyWhoMade: "i_did",
      ...(taxonomyId.trim() && /^\d+$/.test(taxonomyId.trim())
        ? { etsyTaxonomyId: Number.parseInt(taxonomyId.trim(), 10) }
        : {}),
    };
    expect(body.etsyTaxonomyId).toBe(101);
  });
});
