import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Seller Hub Apps Airport navigation", () => {
  it("exposes Apps Airport as a first-class top nav destination", () => {
    const source = readFileSync(path.join(__dirname, "SellerHubTopNav.tsx"), "utf8");
    expect(source).toContain('href: "/seller-hub/apps"');
    expect(source).toContain('label: "Apps Airport"');
  });

  it("exposes Apps Airport in the mobile drawer", () => {
    const source = readFileSync(path.join(__dirname, "SellerHubMobileDrawer.tsx"), "utf8");
    expect(source).toContain('href="/seller-hub/apps"');
    expect(source).toContain("Apps Airport");
  });
});
