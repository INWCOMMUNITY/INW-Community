import { describe, expect, it } from "vitest";
import {
  mergePaidOrderLineIdentities,
  parseShopifyOrdersPaidWebhookBody,
} from "./order-sale";

describe("parseShopifyOrdersPaidWebhookBody", () => {
  it("extracts order/line GIDs and paid quantity (not current_quantity)", () => {
    const body = JSON.stringify({
      id: 820982911946154508,
      admin_graphql_api_id: "gid://shopify/Order/820982911946154508",
      financial_status: "paid",
      line_items: [
        {
          id: 487817672276298554,
          admin_graphql_api_id: "gid://shopify/LineItem/487817672276298554",
          quantity: 2,
          current_quantity: 1,
          variant_id: 808950810,
          sku: "IGNORE-ME",
          title: "Ignore Title",
        },
      ],
    });
    const parsed = parseShopifyOrdersPaidWebhookBody(body);
    expect(parsed).toEqual({
      shopifyOrderId: "gid://shopify/Order/820982911946154508",
      lines: [
        {
          shopifyOrderId: "gid://shopify/Order/820982911946154508",
          shopifyLineItemId: "gid://shopify/LineItem/487817672276298554",
          shopifyVariantId: "gid://shopify/ProductVariant/808950810",
          paidQuantity: 2,
        },
      ],
    });
  });

  it("builds GIDs from numeric ids when admin_graphql_api_id absent", () => {
    const body = JSON.stringify({
      id: 99,
      line_items: [{ id: 11, quantity: 3, variant_id: 22 }],
    });
    const parsed = parseShopifyOrdersPaidWebhookBody(body);
    expect(parsed?.shopifyOrderId).toBe("gid://shopify/Order/99");
    expect(parsed?.lines[0]).toMatchObject({
      shopifyLineItemId: "gid://shopify/LineItem/11",
      shopifyVariantId: "gid://shopify/ProductVariant/22",
      paidQuantity: 3,
    });
  });

  it("keeps null variant when missing (identity resolution later)", () => {
    const body = JSON.stringify({
      admin_graphql_api_id: "gid://shopify/Order/1",
      line_items: [{ admin_graphql_api_id: "gid://shopify/LineItem/2", quantity: 1, variant_id: null }],
    });
    const parsed = parseShopifyOrdersPaidWebhookBody(body);
    expect(parsed?.lines[0].shopifyVariantId).toBeNull();
  });
});

describe("mergePaidOrderLineIdentities", () => {
  it("fills missing variant GIDs without changing paid quantity", () => {
    const merged = mergePaidOrderLineIdentities(
      [
        {
          shopifyOrderId: "gid://shopify/Order/1",
          shopifyLineItemId: "gid://shopify/LineItem/2",
          shopifyVariantId: null,
          paidQuantity: 5,
        },
      ],
      [{ shopifyLineItemId: "gid://shopify/LineItem/2", shopifyVariantId: "gid://shopify/ProductVariant/9" }]
    );
    expect(merged[0]).toMatchObject({
      shopifyVariantId: "gid://shopify/ProductVariant/9",
      paidQuantity: 5,
    });
  });
});
