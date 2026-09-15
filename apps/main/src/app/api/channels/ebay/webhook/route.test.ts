import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshEbayListingByItemId = vi.hoisted(() => vi.fn());
const applyEbayXmlPostcard = vi.hoisted(() => vi.fn());
const prisma = vi.hoisted(() => ({
  channelConnection: { findFirst: vi.fn() },
  channelListingLink: { findFirst: vi.fn() },
}));

vi.mock("@/lib/channels/ebay/pull-ebay-updates", () => ({
  refreshEbayListingByItemId,
  applyEbayXmlPostcard,
}));
vi.mock("database", () => ({ prisma }));
vi.mock("@/lib/channels/reconcile", () => ({
  acknowledgeRecentSalesWithoutDecrement: vi.fn(),
  reconcileConnectionSales: vi.fn(),
}));
vi.mock("@/lib/channels/ebay/notifications-setup", () => ({
  recordEbayWebhookHit: vi.fn(),
  recordEbayWebhookReceipt: vi.fn(),
}));
vi.mock("@/lib/channels/webhook-event", () => ({
  logWebhookEvent: vi.fn(),
  markWebhookProcessing: vi.fn(),
  markWebhookCompleted: vi.fn(),
  markWebhookFailed: vi.fn(),
}));

import { POST } from "./route";

const SOAP_REVISE = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <GetItemResponse xmlns="urn:ebay:apis:eBLBaseComponents">
      <NotificationEventName>ItemRevised</NotificationEventName>
      <RecipientUserID>test-seller</RecipientUserID>
      <Item>
        <ItemID>403004607151</ItemID>
        <Title>Bear Clock</Title>
        <Quantity>5</Quantity>
        <QuantityAvailable>1</QuantityAvailable>
        <Seller><UserID>test-seller</UserID></Seller>
      </Item>
    </GetItemResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

const ORIGINAL_SECRET = process.env.EBAY_WEBHOOK_SECRET;

function reviseRequest() {
  return {
    text: async () => SOAP_REVISE,
    headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "text/xml" : null) },
    nextUrl: { searchParams: { get: (k: string) => (k === "secret" ? "test-secret" : null) } },
  } as never;
}

describe("eBay ItemRevised webhook ack", () => {
  beforeEach(() => {
    process.env.EBAY_WEBHOOK_SECRET = "test-secret";
    refreshEbayListingByItemId.mockClear();
    applyEbayXmlPostcard.mockClear();
    prisma.channelConnection.findFirst.mockClear();
    prisma.channelListingLink.findFirst.mockClear();
  });

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.EBAY_WEBHOOK_SECRET;
    else process.env.EBAY_WEBHOOK_SECRET = ORIGINAL_SECRET;
  });

  it("returns 200 without GetItem, token use, or qty copy", async () => {
    const res = await POST(reviseRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.skipped).toBe("listing_revise_ack_only");
    expect(prisma.channelConnection.findFirst).not.toHaveBeenCalled();
    expect(prisma.channelListingLink.findFirst).not.toHaveBeenCalled();
    expect(refreshEbayListingByItemId).not.toHaveBeenCalled();
    expect(applyEbayXmlPostcard).not.toHaveBeenCalled();
  });
});
