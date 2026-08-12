import { describe, expect, it } from "vitest";
import { resolveImportCategory } from "./import-listing";

describe("resolveImportCategory — eBay paths", () => {
  it("returns canonical category assignment for comic imports", async () => {
    const assignment = await resolveImportCategory({
      provider: "ebay",
      remoteLabel: "Collectibles > Comics > Modern Age (1992-Now)",
      remoteSubLabel: "Modern Age (1992-Now)",
      title: "Batman #423 CGC 9.6 White Pages",
    });
    expect(assignment).not.toBeNull();
    expect(assignment?.source).toBe("ebay_path");
    expect(assignment?.category).toBe("Books, Movies & Music");
    expect(assignment?.subcategory).toBe("Comics & Graphic Novels");
    expect(assignment?.matchedPreset).toBe(true);
  });

  it("returns coin subcategory for eBay coin paths", async () => {
    const assignment = await resolveImportCategory({
      provider: "ebay",
      remoteLabel: "Coins & Paper Money > Coins: US",
      remoteSubLabel: null,
      title: "1881-S Morgan Dollar MS65",
    });
    expect(assignment?.category).toBe("Art & Collectibles");
    expect(assignment?.subcategory).toBe("Coins & Currency");
  });

  it("uses title suggestion when remote category is missing", async () => {
    const assignment = await resolveImportCategory({
      provider: "ebay",
      remoteLabel: null,
      title: "Vintage Comic Book Amazing Fantasy #15",
      description: "Silver age comic book key issue",
    });
    expect(assignment?.source).toBe("title_suggestion");
    expect(assignment?.category).toBeTruthy();
  });
});
