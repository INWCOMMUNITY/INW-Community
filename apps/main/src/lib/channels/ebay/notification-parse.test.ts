import { describe, expect, it } from "vitest";
import {
  ebayNotificationPostcardWrites,
  extractEbayLegacyItemId,
  isEbayRelevantNotification,
  isEbaySaleNotification,
  parseEbayNotificationBody,
} from "./notification-parse";

const SOAP_REVISE = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <GetItemResponse xmlns="urn:ebay:apis:eBLBaseComponents">
      <NotificationEventName>ItemRevised</NotificationEventName>
      <RecipientUserID>test-seller</RecipientUserID>
      <Item>
        <ItemID>403004607151</ItemID>
        <Title>Bear Clock &amp; Chimes</Title>
        <SellingStatus>
          <CurrentPrice currencyID="USD">44.00</CurrentPrice>
          <QuantitySold>0</QuantitySold>
          <ListingStatus>Active</ListingStatus>
        </SellingStatus>
        <Quantity>4</Quantity>
        <QuantityAvailable>4</QuantityAvailable>
        <Seller><UserID>test-seller</UserID></Seller>
        <LastModifiedTime>2026-09-01T18:00:00.000Z</LastModifiedTime>
        <PictureDetails><PictureURL>https://i.ebayimg.com/a.jpg</PictureURL></PictureDetails>
        <Description>Do not apply this from XML</Description>
      </Item>
    </GetItemResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

const SOAP_SALE = `<?xml version="1.0" encoding="utf-8"?>
<GetItemTransactionsResponse xmlns="urn:ebay:apis:eBLBaseComponents">
  <NotificationEventName>FixedPriceTransaction</NotificationEventName>
  <Item>
    <ItemID>403004607151</ItemID>
    <Title>Bear Clock</Title>
    <SellingStatus>
      <CurrentPrice>44.00</CurrentPrice>
      <QuantitySold>1</QuantitySold>
      <ListingStatus>Active</ListingStatus>
    </SellingStatus>
    <QuantityAvailable>3</QuantityAvailable>
    <Seller><UserID>test-seller</UserID></Seller>
  </Item>
</GetItemTransactionsResponse>`;

const SOAP_NO_ITEM_ID = `<?xml version="1.0" encoding="utf-8"?>
<GetItemResponse xmlns="urn:ebay:apis:eBLBaseComponents">
  <NotificationEventName>ItemRevised</NotificationEventName>
  <Ack>Success</Ack>
</GetItemResponse>`;

describe("extractEbayLegacyItemId", () => {
  it("keeps a Trading ItemID", () => {
    expect(extractEbayLegacyItemId("403004607151")).toBe("403004607151");
  });

  it("unwraps a Commerce REST listing id", () => {
    expect(extractEbayLegacyItemId("v1|403004607151|0")).toBe("403004607151");
  });
});

describe("parseEbayNotificationBody SOAP", () => {
  it("reads ItemRevised title, price, seller, and LastModified", () => {
    const parsed = parseEbayNotificationBody(SOAP_REVISE, "text/xml");
    expect(parsed.source).toBe("soap");
    expect(parsed.eventType).toBe("ItemRevised");
    expect(parsed.kind).toBe("revise");
    expect(parsed.itemId).toBe("403004607151");
    expect(parsed.ebayUserId).toBe("test-seller");
    expect(parsed.postcard.title).toBe("Bear Clock & Chimes");
    expect(parsed.postcard.priceCents).toBe(4400);
    expect(parsed.postcard.quantity).toBe(4);
    expect(parsed.postcard.lastModified?.toISOString()).toBe("2026-09-01T18:00:00.000Z");
    expect(parsed.parseable).toBe(true);
  });

  it("classifies a sale event and still parses qty only for logging", () => {
    const parsed = parseEbayNotificationBody(SOAP_SALE);
    expect(parsed.kind).toBe("sale");
    expect(isEbaySaleNotification(parsed.eventType)).toBe(true);
    expect(parsed.postcard.quantity).toBe(3);
    expect(ebayNotificationPostcardWrites(parsed.postcard).priceCents).toBe(4400);
  });

  it("returns no itemId when the envelope has none", () => {
    const parsed = parseEbayNotificationBody(SOAP_NO_ITEM_ID);
    expect(parsed.itemId).toBeNull();
    expect(parsed.eventType).toBe("ItemRevised");
    expect(parsed.parseable).toBe(true);
  });
});

describe("parseEbayNotificationBody Commerce JSON", () => {
  it("maps ITEM_PRICE_REVISION onto revise with a legacy item id", () => {
    const parsed = parseEbayNotificationBody(
      JSON.stringify({
        metadata: { topic: "ITEM_PRICE_REVISION" },
        notification: {
          data: {
            itemId: "v1|403004607151|0",
            title: "Bear Clock",
            price: { value: "44.00" },
            username: "test-seller",
          },
        },
      }),
      "application/json"
    );
    expect(parsed.source).toBe("commerce_json");
    expect(parsed.kind).toBe("revise");
    expect(parsed.itemId).toBe("403004607151");
    expect(parsed.ebayUserId).toBe("test-seller");
    expect(parsed.postcard.title).toBe("Bear Clock");
    expect(parsed.postcard.priceCents).toBe(4400);
  });

  it("maps ORDER_CONFIRMATION to sale", () => {
    const parsed = parseEbayNotificationBody(
      JSON.stringify({
        metadata: { topic: "ORDER_CONFIRMATION" },
        notification: { data: { itemId: "403004607151" } },
      })
    );
    expect(parsed.kind).toBe("sale");
    expect(isEbaySaleNotification(parsed.eventType)).toBe(true);
  });

  it("maps ITEM_AVAILABILITY to revise", () => {
    const parsed = parseEbayNotificationBody(
      JSON.stringify({ metadata: { topic: "ITEM_AVAILABILITY" }, notification: { data: {} } })
    );
    expect(parsed.kind).toBe("revise");
    expect(isEbayRelevantNotification(parsed.eventType)).toBe(true);
  });

  it("marks unparseable JSON as not parseable", () => {
    const parsed = parseEbayNotificationBody("{not-json", "application/json");
    expect(parsed.parseable).toBe(false);
    expect(parsed.itemId).toBeNull();
  });
});

describe("ebayNotificationPostcardWrites", () => {
  it("keeps title and positive price only", () => {
    expect(
      ebayNotificationPostcardWrites({
        title: "  Clock  ",
        priceCents: 1200,
        quantity: 0,
        lastModified: null,
      })
    ).toEqual({ title: "Clock", priceCents: 1200 });
  });

  it("drops zero price so callers cannot apply a bad snapshot", () => {
    expect(
      ebayNotificationPostcardWrites({
        title: null,
        priceCents: 0,
        quantity: 0,
        lastModified: null,
      })
    ).toEqual({ title: null, priceCents: null });
  });
});
