import { describe, expect, it } from "vitest";
import {
  EBAY_CRON_DIRTY_GETITEM_LIMIT,
  EBAY_CRON_GETITEM_LIMIT,
  ebaySellerListRowIsDirty,
  rotateEbayLinks,
} from "./pull-ebay-updates";
import { ebayNotificationPostcardWrites } from "./notification-parse";

describe("EBAY_CRON_GETITEM_LIMIT", () => {
  it("is a small rotate backstop, not a catalog crawl", () => {
    expect(EBAY_CRON_GETITEM_LIMIT).toBe(5);
  });

  it("caps dirty GetItems below a full-shop crawl", () => {
    expect(EBAY_CRON_DIRTY_GETITEM_LIMIT).toBe(20);
    expect(EBAY_CRON_DIRTY_GETITEM_LIMIT).toBeGreaterThan(EBAY_CRON_GETITEM_LIMIT);
  });
});

describe("ebaySellerListRowIsDirty", () => {
  const inw = { title: "Bear Clock", priceCents: 4400, quantity: 4 };

  it("is clean when title, price, and qty match", () => {
    expect(ebaySellerListRowIsDirty(inw, { title: "Bear Clock", priceCents: 4400, quantity: 4 })).toBe(
      false
    );
  });

  it("is dirty when the seller list title or price moved", () => {
    expect(ebaySellerListRowIsDirty(inw, { title: "Bear Clock v2", priceCents: 4400, quantity: 4 })).toBe(
      true
    );
    expect(ebaySellerListRowIsDirty(inw, { title: "Bear Clock", priceCents: 5500, quantity: 4 })).toBe(
      true
    );
  });

  it("is dirty when quantity moved", () => {
    expect(ebaySellerListRowIsDirty(inw, { title: "Bear Clock", priceCents: 4400, quantity: 3 })).toBe(
      true
    );
  });
});

describe("rotateEbayLinks", () => {
  const links = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ id: `link-${n}` }));

  it("takes at most the cron GetItem limit", () => {
    const { batch, nextCursor } = rotateEbayLinks(links, null, EBAY_CRON_GETITEM_LIMIT);
    expect(batch).toHaveLength(5);
    expect(nextCursor).toBe("link-6");
  });

  it("advances across the full catalog even when the cursor id was dirty this tick", () => {
    const { batch, nextCursor } = rotateEbayLinks(links, "link-3", EBAY_CRON_GETITEM_LIMIT);
    expect(batch.map((row) => row.id)).toEqual([
      "link-3",
      "link-4",
      "link-5",
      "link-6",
      "link-7",
    ]);
    expect(nextCursor).toBe("link-8");
  });
});

describe("xml postcard never writes qty or ended", () => {
  it("omits quantity even when the snapshot has stock", () => {
    const writes = ebayNotificationPostcardWrites({
      title: "Clock",
      priceCents: 1200,
      quantity: 0,
      lastModified: null,
    });
    expect(writes).toEqual({ title: "Clock", priceCents: 1200 });
    expect(writes).not.toHaveProperty("quantity");
  });
});
