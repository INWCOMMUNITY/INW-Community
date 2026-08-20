import { describe, expect, it } from "vitest";
import {
  parseEbayDescription,
  parseEbayItemSpecifics,
  parseEbayLastModified,
  parseEbayPrimaryCategory,
} from "./item-specifics";

const ITEM_XML = `
<Item>
  <PrimaryCategory>
    <CategoryID>11116</CategoryID>
    <CategoryName>Coins &amp; Paper Money &gt; Coins: US</CategoryName>
  </PrimaryCategory>
  <Description>&lt;p&gt;Nice coin&lt;/p&gt;</Description>
  <ItemSpecifics>
    <NameValueList>
      <Name>Year</Name>
      <Value>1921</Value>
    </NameValueList>
    <NameValueList>
      <Name>Composition</Name>
      <Value>Silver</Value>
      <Value>90% Silver</Value>
    </NameValueList>
    <NameValueList>
      <Name>Empty</Name>
    </NameValueList>
  </ItemSpecifics>
</Item>`;

describe("parseEbayItemSpecifics", () => {
  it("parses NameValueList into aspect rows including MULTI values", () => {
    const aspects = parseEbayItemSpecifics(ITEM_XML);
    expect(aspects).toEqual([
      { name: "Year", value: "1921" },
      { name: "Composition", value: "Silver" },
      { name: "Composition", value: "90% Silver" },
    ]);
  });

  it("returns empty when there are no item specifics", () => {
    expect(parseEbayItemSpecifics("<Item><Title>No specifics</Title></Item>")).toEqual([]);
  });

  it("decodes XML entities in names and values", () => {
    const xml = `<ItemSpecifics><NameValueList><Name>Brand &amp; Co</Name><Value>A &amp; B</Value></NameValueList></ItemSpecifics>`;
    expect(parseEbayItemSpecifics(xml)).toEqual([{ name: "Brand & Co", value: "A & B" }]);
  });
});

describe("parseEbayPrimaryCategory", () => {
  it("reads the category id and decoded name", () => {
    expect(parseEbayPrimaryCategory(ITEM_XML)).toEqual({
      categoryId: "11116",
      categoryName: "Coins & Paper Money > Coins: US",
    });
  });

  it("returns nulls when no PrimaryCategory is present", () => {
    expect(parseEbayPrimaryCategory("<Item></Item>")).toEqual({
      categoryId: null,
      categoryName: null,
    });
  });
});

describe("parseEbayDescription", () => {
  it("decodes the description (HTML left for the caller to strip)", () => {
    expect(parseEbayDescription(ITEM_XML)).toBe("<p>Nice coin</p>");
  });

  it("returns null for a missing description", () => {
    expect(parseEbayDescription("<Item></Item>")).toBeNull();
  });
});

describe("parseEbayLastModified", () => {
  it("reads LastModifiedTime from an Item slice", () => {
    const xml = `<Item><LastModifiedTime>2026-08-20T05:32:00.000Z</LastModifiedTime></Item>`;
    expect(parseEbayLastModified(xml)?.toISOString()).toBe("2026-08-20T05:32:00.000Z");
  });

  it("reads a namespaced LastModifiedTime from the full GetItem envelope", () => {
    const xml = `<?xml version="1.0"?>
<GetItemResponse xmlns="urn:ebay:apis:eBLBaseComponents">
  <Ack>Success</Ack>
  <Item>
    <Title>TEST 4</Title>
    <ns:LastModifiedTime>2026-08-20T05:32:11.000Z</ns:LastModifiedTime>
  </Item>
</GetItemResponse>`;
    expect(parseEbayLastModified(xml)?.toISOString()).toBe("2026-08-20T05:32:11.000Z");
  });

  it("does not treat envelope UpdateTime as the listing LastModifiedTime", () => {
    const xml = `<?xml version="1.0"?>
<GetItemResponse xmlns="urn:ebay:apis:eBLBaseComponents">
  <Timestamp>2026-08-20T06:50:03.000Z</Timestamp>
  <UpdateTime>2026-08-20T06:50:03.000Z</UpdateTime>
  <Item>
    <Title>EBAY CRON TEST 5</Title>
  </Item>
</GetItemResponse>`;
    expect(parseEbayLastModified(xml)).toBeNull();
  });
});
