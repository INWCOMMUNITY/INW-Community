import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { generatePackingSlipPdf } from "./packing-slip";
import type { PackingSlipGroup, PackingSlipSellerProfile } from "./packing-slip-shared";

const seller: PackingSlipSellerProfile = {
  business: {
    name: "River City Goods",
    phone: "509-555-0100",
    address: "12 River Rd",
    city: "Spokane, WA 99201",
    logoUrl: null,
    website: "https://rivercity.example",
    email: "shop@rivercity.example",
  },
  returnAddressFormatted: "River City Goods\n12 River Rd\nSpokane, WA 99201",
  packingSlipNote: "Thank you for supporting a local shop!",
};

function group(overrides: Partial<PackingSlipGroup> = {}): PackingSlipGroup {
  return {
    buyer: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" },
    orders: [
      {
        id: "order_abc12345wxyz",
        shippingAddress: { street: "100 Main St", city: "Spokane", state: "WA", zip: "99201" },
        createdAt: "2026-08-31T12:00:00.000Z",
        stripePaymentIntentId: "pi_test",
      },
    ],
    combinedItems: [
      {
        id: "oi1",
        quantity: 1,
        priceCentsAtPurchase: 100,
        storeItem: { title: "Handmade mug" },
        orderId: "order_abc12345wxyz",
      },
    ],
    totalCents: 100,
    subtotalCents: 100,
    shippingCostCents: 0,
    taxCents: 6,
    ...overrides,
  };
}

describe("generatePackingSlipPdf", () => {
  it("creates a one-page slip for a short order", async () => {
    const bytes = await generatePackingSlipPdf([group()], seller);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(bytes[0]).toBe(0x25); // %
  });

  it("paginates when there are many line items", async () => {
    const items = Array.from({ length: 40 }, (_, i) => ({
      id: `oi${i}`,
      quantity: 1,
      priceCentsAtPurchase: 100,
      storeItem: { title: `Item ${i + 1}` },
      orderId: "order_abc12345wxyz",
    }));
    const bytes = await generatePackingSlipPdf([group({ combinedItems: items })], seller);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });
});
