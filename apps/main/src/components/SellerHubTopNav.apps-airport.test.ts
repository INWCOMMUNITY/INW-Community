import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Seller Hub Sync Airport navigation", () => {
  it("nests Sync Airport under the Listings dropdown in top nav", () => {
    const source = readFileSync(path.join(__dirname, "SellerHubTopNav.tsx"), "utf8");
    expect(source).toContain('href: "/seller-hub/apps"');
    expect(source).toContain('label: "Sync Airport"');
    expect(source).toContain("listingsChildren");
    // Must not be a first-class top-level nav segment next to Seller Hub
    expect(source).not.toMatch(
      /navItems:\s*NavItem\[]\s*=\s*\[[^\]]*href:\s*"\/seller-hub\/apps"/s
    );
    const listingsBlock = source.slice(
      source.indexOf("const listingsChildren"),
      source.indexOf("const ordersChildren")
    );
    expect(listingsBlock).toContain('label: "Sync Airport"');
    expect(listingsBlock).toContain('href: "/seller-hub/apps"');
  });

  it("nests Sync Airport under Listings in the mobile drawer", () => {
    const source = readFileSync(path.join(__dirname, "SellerHubMobileDrawer.tsx"), "utf8");
    const listingsBlock = source.slice(
      source.indexOf("const listingsItems"),
      source.indexOf("const ordersItems")
    );
    expect(listingsBlock).toContain('href: "/seller-hub/apps"');
    expect(listingsBlock).toContain('label: "Sync Airport"');
    // Standalone top-level Sync Airport link removed from drawer
    expect(source).not.toMatch(
      /href="\/seller-hub\/apps"[\s\S]*?Sync Airport[\s\S]*?title="Listings"/
    );
  });
});
