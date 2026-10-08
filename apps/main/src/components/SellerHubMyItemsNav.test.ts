import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MY_ITEMS_HREF = "/seller-hub/store/items";

describe("Seller Hub My Items navigation", () => {
  it("resolves Listings / My Items nav destinations to the authenticated listing page", () => {
    const topNav = readFileSync(path.join(__dirname, "SellerHubTopNav.tsx"), "utf8");
    expect(topNav).toContain(`href: "${MY_ITEMS_HREF}"`);
    expect(topNav).toContain('label: "My Items"');
    expect(topNav).toContain(`if (item.label === "Listings") return "${MY_ITEMS_HREF}"`);

    const sidebar = readFileSync(path.join(__dirname, "SellerSidebar.tsx"), "utf8");
    expect(sidebar).toContain(`href: "${MY_ITEMS_HREF}"`);
    expect(sidebar).toContain('label: "My Items"');

    const drawer = readFileSync(path.join(__dirname, "SellerHubMobileDrawer.tsx"), "utf8");
    expect(drawer).toContain(`href: "${MY_ITEMS_HREF}"`);
    expect(drawer).toContain('label: "My Items"');
  });

  it("keeps the authenticated My Items route page in the seller-hub store tree", () => {
    const pagePath = path.join(
      __dirname,
      "..",
      "app",
      "seller-hub",
      "store",
      "items",
      "page.tsx"
    );
    expect(existsSync(pagePath)).toBe(true);
    const page = readFileSync(pagePath, "utf8");
    expect(page).toContain('data-testid="seller-hub-my-items"');
    expect(page).toContain("/api/store-items?mine=1");
    expect(page).toContain("List an Item");
  });
});
