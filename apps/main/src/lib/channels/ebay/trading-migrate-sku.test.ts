import { describe, expect, it } from "vitest";
import {
  canSkipEbayBulkMigrate,
  classifyEbayItemForMigration,
  EBAY_SKU_VERIFY_DELAYS_MS,
  generateEbayMigrationSku,
  generateEbayVariationMigrationSku,
  isValidEbayInventorySku,
  listingHasValidMigrateSku,
  NOT_FIXED_PRICE_MIGRATE_ERROR,
  plannedParentSku,
  plannedVariationSkus,
} from "./migrate-prep";
import { ebayErrorActionHint } from "./errors";

describe("canSkipEbayBulkMigrate", () => {
  it("skips Inventory-native rows and already-stamped inw SKUs", () => {
    expect(canSkipEbayBulkMigrate("inw393111584313", "inw393111584313")).toBe(true);
    expect(canSkipEbayBulkMigrate("393111584313", "inw393111584313")).toBe(true);
    expect(canSkipEbayBulkMigrate("sellerSkuOnly", "sellerSkuOnly")).toBe(true);
  });

  it("still migrates classic listings with a seller Custom Label", () => {
    expect(canSkipEbayBulkMigrate("393111584313", "ABC123")).toBe(false);
    expect(canSkipEbayBulkMigrate("393111584313", null)).toBe(false);
    expect(canSkipEbayBulkMigrate("393111584313", "1942-S")).toBe(false);
  });
});

describe("EBAY_SKU_VERIFY_DELAYS_MS", () => {
  it("polls about 8 seconds after a successful revise", () => {
    const waited = EBAY_SKU_VERIFY_DELAYS_MS.reduce<number>((sum, ms) => sum + ms, 0);
    expect(waited).toBeGreaterThanOrEqual(8000);
    expect(EBAY_SKU_VERIFY_DELAYS_MS[0]).toBe(0);
  });
});

describe("isValidEbayInventorySku", () => {
  it("accepts alphanumeric SKUs up to 50 characters", () => {
    expect(isValidEbayInventorySku("inw393111584313")).toBe(true);
    expect(isValidEbayInventorySku("ABC123")).toBe(true);
  });

  it("rejects hyphens, spaces, empty, and over-length SKUs", () => {
    expect(isValidEbayInventorySku("1942-S")).toBe(false);
    expect(isValidEbayInventorySku("sku b")).toBe(false);
    expect(isValidEbayInventorySku("")).toBe(false);
    expect(isValidEbayInventorySku("a".repeat(51))).toBe(false);
  });
});

describe("generateEbayMigrationSku", () => {
  it("builds an alphanumeric SKU from the listing id", () => {
    expect(generateEbayMigrationSku("393111584313")).toBe("inw393111584313");
    expect(generateEbayMigrationSku("393-111")).toBe("inw393111");
    expect(generateEbayMigrationSku("1".repeat(60)).length).toBeLessThanOrEqual(50);
    expect(generateEbayVariationMigrationSku("123", 0)).toBe("inw123v1");
  });
});

describe("classifyEbayItemForMigration", () => {
  it("rejects auctions and classified ads before migrate", () => {
    expect(classifyEbayItemForMigration("<Item><ListingType>Chinese</ListingType></Item>")).toEqual({
      kind: "not_fixed_price",
      listingType: "Chinese",
    });
    expect(classifyEbayItemForMigration("<Item><ListingType>AdType</ListingType></Item>").kind).toBe(
      "not_fixed_price"
    );
    expect(classifyEbayItemForMigration("<Item><ListingStatus>Completed</ListingStatus></Item>").kind).toBe(
      "ended"
    );
  });

  it("treats fixed-price listings with a valid SKU as ready to migrate", () => {
    const cls = classifyEbayItemForMigration(
      "<Item><ListingType>FixedPriceItem</ListingType><SKU>inw393111584313</SKU></Item>"
    );
    expect(cls.kind).toBe("ready");
    expect(listingHasValidMigrateSku(cls)).toBe(true);
  });

  it("does not treat an empty Custom Label as ready", () => {
    const cls = classifyEbayItemForMigration("<Item><ListingType>StoresFixedPrice</ListingType></Item>");
    expect(cls.kind).toBe("ready");
    expect(listingHasValidMigrateSku(cls)).toBe(false);
    expect(plannedParentSku("402857526391", null)).toBe("inw402857526391");
  });

  it("plans per-variation SKUs when variation Custom Labels are missing", () => {
    const xml = `<Item>
      <ListingType>FixedPriceItem</ListingType>
      <SKU></SKU>
      <Variations>
        <Variation>
          <VariationSpecifics><NameValueList><Name>Size</Name><Value>M</Value></NameValueList></VariationSpecifics>
        </Variation>
        <Variation>
          <SKU>keepme</SKU>
          <VariationSpecifics><NameValueList><Name>Size</Name><Value>L</Value></NameValueList></VariationSpecifics>
        </Variation>
      </Variations>
    </Item>`;
    const cls = classifyEbayItemForMigration(xml);
    expect(cls.kind).toBe("ready");
    if (cls.kind !== "ready") return;
    expect(listingHasValidMigrateSku(cls)).toBe(false);
    expect(plannedVariationSkus("99", cls.variations)).toEqual(["inw99v1", "keepme"]);
  });
});

describe("empty SKU migrate hint", () => {
  it("does not treat empty-SKU #25002 as a GTC listing problem", () => {
    const reason =
      "[#25002 · API_INVENTORY · REQUEST · HTTP 400] A user error has occurred. The listing SKU cannot be null or empty.";
    expect(ebayErrorActionHint(reason)).toMatch(/Custom Label/i);
    expect(ebayErrorActionHint(reason)).not.toMatch(/GTC listing/i);
  });

  it("hints about auctions with the not_fixed_price skip reason", () => {
    expect(ebayErrorActionHint(NOT_FIXED_PRICE_MIGRATE_ERROR)).toMatch(/Buy It Now/i);
  });
});
