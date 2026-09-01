import { describe, expect, it } from "vitest";
import {
  formatPackingSlipMoney,
  formatPackingSlipOrderRef,
  packingSlipContactLine,
  packingSlipGrandTotalCents,
  packingSlipLocalDeliveryCents,
  packingSlipPaymentLabel,
  packingSlipTotalRows,
} from "./packing-slip-shared";

describe("packing slip totals", () => {
  it("adds tax to the displayed grand total", () => {
    expect(packingSlipGrandTotalCents({ totalCents: 100, taxCents: 6 })).toBe(106);
    expect(formatPackingSlipMoney(106)).toBe("$1.06");
  });

  it("treats missing tax as zero", () => {
    expect(packingSlipGrandTotalCents({ totalCents: 100 })).toBe(100);
    expect(packingSlipGrandTotalCents({ totalCents: 100, taxCents: null })).toBe(100);
  });

  it("shows tax in the receipt stack and includes it in Total", () => {
    const rows = packingSlipTotalRows({
      subtotalCents: 100,
      shippingCostCents: 0,
      totalCents: 100,
      taxCents: 6,
    });
    expect(rows).toEqual([
      { label: "Subtotal", value: "$1.00" },
      { label: "Shipping", value: "Free" },
      { label: "Tax", value: "$0.06" },
      { label: "Total", value: "$1.06", emphasis: true },
    ]);
  });

  it("surfaces local delivery when it is in total but not shipping", () => {
    expect(
      packingSlipLocalDeliveryCents({
        totalCents: 1500,
        subtotalCents: 1000,
        shippingCostCents: 0,
      })
    ).toBe(500);
  });
});

describe("packing slip labels", () => {
  it("formats a short order ref", () => {
    expect(formatPackingSlipOrderRef("clxyzabc1234wxyz")).toBe("#1234WXYZ");
  });

  it("labels payment from Stripe vs cash vs reward", () => {
    expect(packingSlipPaymentLabel([{ stripePaymentIntentId: "pi_1" }], 100)).toBe("Paid");
    expect(packingSlipPaymentLabel([{}], 100)).toBe("Cash due");
    expect(
      packingSlipPaymentLabel([{ orderKind: "reward_redemption" }], 0)
    ).toBe("Reward");
  });

  it("joins contact parts and strips the website protocol", () => {
    expect(
      packingSlipContactLine({
        name: "Shop",
        phone: "509-555-0100",
        address: null,
        logoUrl: null,
        website: "https://shop.example/",
        email: "hi@shop.example",
      })
    ).toBe("shop.example  ·  hi@shop.example  ·  509-555-0100");
  });
});
