import { describe, expect, it } from "vitest";
import { parseEtsyOrderPaidWebhookBody } from "./process-orders-paid";

describe("parseEtsyOrderPaidWebhookBody", () => {
  it("reads receipt_id and resource_url", () => {
    expect(
      parseEtsyOrderPaidWebhookBody(
        JSON.stringify({
          shop_id: 42,
          receipt_id: 99,
          event_type: "order.paid",
        })
      )
    ).toEqual({ shopId: "42", receiptId: "99", resourceUrl: null });

    expect(
      parseEtsyOrderPaidWebhookBody(
        JSON.stringify({
          shop_id: "7",
          resource_url: "https://api.etsy.com/v3/application/shops/7/receipts/12345",
        })
      )
    ).toEqual({
      shopId: "7",
      receiptId: "12345",
      resourceUrl: "https://api.etsy.com/v3/application/shops/7/receipts/12345",
    });
  });
});
