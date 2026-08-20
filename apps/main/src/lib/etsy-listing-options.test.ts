import { describe, it, expect } from "vitest";
import { normalizeEtsyWhenMade, isEtsyWhoMade } from "./etsy-listing-options";

describe("normalizeEtsyWhenMade", () => {
  it("keeps current Etsy API values", () => {
    expect(normalizeEtsyWhenMade("made_to_order")).toBe("made_to_order");
    expect(normalizeEtsyWhenMade("2020_2026")).toBe("2020_2026");
    expect(normalizeEtsyWhenMade("before_2007")).toBe("before_2007");
  });

  it("maps legacy form values onto the current Etsy enum", () => {
    expect(normalizeEtsyWhenMade("2020_2025")).toBe("2020_2026");
    expect(normalizeEtsyWhenMade("2004_2009")).toBe("2007_2009");
    expect(normalizeEtsyWhenMade("before_2004")).toBe("before_2007");
    expect(normalizeEtsyWhenMade("2000_2003")).toBe("2000_2006");
    expect(normalizeEtsyWhenMade("before_1960")).toBe("1950s");
    expect(normalizeEtsyWhenMade("before_2006")).toBe("before_2007");
  });

  it("returns null for missing or unknown values", () => {
    expect(normalizeEtsyWhenMade(null)).toBeNull();
    expect(normalizeEtsyWhenMade("not_a_real_era")).toBeNull();
  });
});

describe("isEtsyWhoMade", () => {
  it("accepts Etsy who_made enums only", () => {
    expect(isEtsyWhoMade("i_did")).toBe(true);
    expect(isEtsyWhoMade("someone_else")).toBe(true);
    expect(isEtsyWhoMade("collective")).toBe(true);
    expect(isEtsyWhoMade("factory")).toBe(false);
    expect(isEtsyWhoMade(null)).toBe(false);
  });
});
