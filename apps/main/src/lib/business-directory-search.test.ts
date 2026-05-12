import { describe, expect, it } from "vitest";
import {
  buildBusinessDirectorySearchWhere,
  computeDirectorySearchMatchNote,
  directorySearchIsDirectLiteralMatch,
  directorySearchIsSimilarExpansionMatch,
  expandMatchingPrimaryLabels,
  normalizeSearchForMatching,
  scoreDirectorySearchMatch,
  sortByDirectorySearchRelevance,
  splitSearchQueryWithImpliedCity,
} from "@/lib/business-directory-search";

describe("directorySearch match note (similar vs direct)", () => {
  const row = (over: Partial<Parameters<typeof computeDirectorySearchMatchNote>[0]>) => ({
    name: "Morning Joe",
    shortDescription: "Neighborhood hangout",
    fullDescription: null,
    city: "Spokane",
    address: null,
    categories: ["Coffee Shop"],
    ...over,
  });

  it("marks similar when synonym category matches but query text is absent", () => {
    expect(directorySearchIsDirectLiteralMatch(row({}), "espresso")).toBe(false);
    expect(directorySearchIsSimilarExpansionMatch(row({}), "espresso")).toBe(true);
    expect(computeDirectorySearchMatchNote(row({}), "espresso")).toBe("similar");
  });

  it("does not mark similar when query appears in listing text", () => {
    expect(computeDirectorySearchMatchNote(row({ name: "Espresso House" }), "espresso")).toBeUndefined();
  });

  it("marks similar for HVAC trade name without literal hvac", () => {
    const pillar = row({
      name: "Pillar Heating Air Appliance",
      shortDescription: "Local comfort",
      categories: ["Appliance"],
    });
    expect(computeDirectorySearchMatchNote(pillar, "hvac")).toBe("similar");
  });
});

describe("normalizeSearchForMatching", () => {
  it("trims and collapses spaces", () => {
    expect(normalizeSearchForMatching("  foo   bar  ")).toBe("foo bar");
  });
});

describe("expandMatchingPrimaryLabels", () => {
  it("maps hvac query to HVAC primary", () => {
    expect(expandMatchingPrimaryLabels("hvac")).toContain("HVAC");
    expect(expandMatchingPrimaryLabels("HVAC")).toContain("HVAC");
  });

  it("maps air conditioning phrase to HVAC", () => {
    expect(expandMatchingPrimaryLabels("air conditioning")).toContain("HVAC");
  });

  it("maps subcategory needle to parent primary", () => {
    expect(expandMatchingPrimaryLabels("heating")).toContain("HVAC");
  });

  it("returns empty for very short query", () => {
    expect(expandMatchingPrimaryLabels("a")).toEqual([]);
  });

  it("maps tattoos to Tattoo and Piercing Studio", () => {
    expect(expandMatchingPrimaryLabels("tattoos")).toContain("Tattoo and Piercing Studio");
  });

  it("maps realtor to Real Estate", () => {
    expect(expandMatchingPrimaryLabels("realtor")).toContain("Real Estate Agents and Services");
  });

  it("maps dentist to Health and Dental", () => {
    expect(expandMatchingPrimaryLabels("dentist")).toContain("Health and Dental");
  });
});

describe("buildBusinessDirectorySearchWhere", () => {
  it("returns undefined for empty search", () => {
    expect(buildBusinessDirectorySearchWhere("")).toBeUndefined();
    expect(buildBusinessDirectorySearchWhere("   ")).toBeUndefined();
  });

  it("includes category has for expanded primaries", () => {
    const w = buildBusinessDirectorySearchWhere("hvac");
    expect(w).toBeDefined();
    expect(w?.OR).toBeDefined();
    const ors = w!.OR as Record<string, unknown>[];
    const hasHvac = ors.some(
      (o) => "categories" in o && (o.categories as { has: string }).has === "HVAC"
    );
    expect(hasHvac).toBe(true);
  });

  it("maps CDA to Coeur d'Alene on city field", () => {
    const w = buildBusinessDirectorySearchWhere("CDA");
    expect(w).toBeDefined();
    const ors = w!.OR as Record<string, unknown>[];
    const hasCoeur = ors.some(
      (o) =>
        "city" in o &&
        (o.city as { contains: string; mode: string }).contains === "Coeur d'Alene"
    );
    expect(hasCoeur).toBe(true);
  });

  it("matches Heating+Air trade names for hvac intent", () => {
    const w = buildBusinessDirectorySearchWhere("hvac");
    expect(w).toBeDefined();
    const ors = w!.OR as unknown[];
    const hasHeatingAirName = ors.some((o) => {
      if (!o || typeof o !== "object" || !("AND" in o)) return false;
      const ands = (o as { AND: Record<string, unknown>[] }).AND;
      if (!Array.isArray(ands) || ands.length !== 2) return false;
      const hasHeat = ands.some(
        (x) =>
          "name" in x &&
          (x.name as { contains: string }).contains === "Heating"
      );
      const hasAir = ands.some(
        (x) => "name" in x && (x.name as { contains: string }).contains === "Air"
      );
      return hasHeat && hasAir;
    });
    expect(hasHeatingAirName).toBe(true);
  });
});

describe("scoreDirectorySearchMatch", () => {
  it("boosts trade-style HVAC business names when query is hvac", () => {
    const row = {
      name: "Pillar Heating Air Appliance",
      shortDescription: "Local service",
      fullDescription: null,
      city: null,
      address: null,
      categories: ["Appliance"],
    };
    const plain = {
      ...row,
      name: "Some Appliance Shop",
    };
    expect(scoreDirectorySearchMatch(row, "hvac")).toBeGreaterThan(scoreDirectorySearchMatch(plain, "hvac"));
  });

  const hvacOnlyCategory = {
    name: "Dave's Climate",
    shortDescription: "Comfort year round",
    fullDescription: "Heating and cooling for your home.",
    city: "Spokane",
    address: null,
    categories: ["HVAC"],
    subcategoriesByPrimary: { HVAC: ["Both"] },
  };

  it("scores category-only HVAC business for hvac query", () => {
    const s = scoreDirectorySearchMatch(hvacOnlyCategory, "hvac");
    expect(s).toBeGreaterThan(0);
  });

  it("prefers name match over category-only", () => {
    const nameHit = {
      ...hvacOnlyCategory,
      name: "HVAC Pros",
      categories: ["Plumber"],
    };
    const catOnly = hvacOnlyCategory;
    expect(scoreDirectorySearchMatch(nameHit, "hvac")).toBeGreaterThan(
      scoreDirectorySearchMatch(catOnly, "hvac")
    );
  });
});

describe("sortByDirectorySearchRelevance", () => {
  it("orders name match above category-only match", () => {
    const rows = [
      {
        name: "Smith Sheet Metal",
        shortDescription: "Custom fabrication",
        fullDescription: null,
        city: null,
        address: null,
        categories: ["HVAC"],
        subcategoriesByPrimary: {},
      },
      {
        name: "HVAC Experts",
        shortDescription: null,
        fullDescription: null,
        city: null,
        address: null,
        categories: ["Handyman"],
      },
    ];
    const sorted = sortByDirectorySearchRelevance(rows, "hvac");
    expect(sorted[0]!.name).toBe("HVAC Experts");
  });

  it("sorts by name when no search", () => {
    const rows = [
      { name: "B", shortDescription: null, city: null, address: null, categories: [] },
      { name: "A", shortDescription: null, city: null, address: null, categories: [] },
    ];
    const sorted = sortByDirectorySearchRelevance(rows, "");
    expect(sorted.map((r) => r.name)).toEqual(["A", "B"]);
  });
});

describe("splitSearchQueryWithImpliedCity", () => {
  it("splits service phrase and city (in)", () => {
    const r = splitSearchQueryWithImpliedCity("Tattoos in Hayden", ["Hayden", "Spokane"]);
    expect(r.textSearch.toLowerCase()).toBe("tattoos");
    expect(r.impliedCity).toBe("Hayden");
  });

  it("accepts near / around / at", () => {
    expect(splitSearchQueryWithImpliedCity("coffee near Spokane", ["Spokane"]).impliedCity).toBe("Spokane");
    expect(splitSearchQueryWithImpliedCity("bakery around Hayden", ["Hayden"]).impliedCity).toBe("Hayden");
    expect(splitSearchQueryWithImpliedCity("pizza at Post Falls", ["Post Falls"]).impliedCity).toBe("Post Falls");
  });

  it("resolves city from PREBUILT when not in directory list", () => {
    const r = splitSearchQueryWithImpliedCity("Tattoos in Hayden", []);
    expect(r.impliedCity).toBe("Hayden");
    expect(r.textSearch.toLowerCase()).toBe("tattoos");
  });

  it("maps CDA tail to Coeur d'Alene", () => {
    const r = splitSearchQueryWithImpliedCity("coffee in CDA", ["Spokane"]);
    expect(r.impliedCity).toBe("Coeur d'Alene");
    expect(r.textSearch.toLowerCase()).toBe("coffee");
  });

  it("returns full query when tail is not a known city", () => {
    const r = splitSearchQueryWithImpliedCity("Tattoos in Atlantis", ["Hayden"]);
    expect(r.impliedCity).toBeUndefined();
    expect(r.textSearch).toBe("Tattoos in Atlantis");
  });
});
