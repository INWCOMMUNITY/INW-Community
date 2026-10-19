import { describe, expect, it } from "vitest";
import {
  buyerReturnLabelFollowup,
  buyerReturnShippingWarning,
  chargeReturnShippingForMode,
  handlingTimeBoldLine,
  policyFromStored,
  returnLabelChargesBuyer,
  returnLabelSellerChooses,
  showsFreeReturns,
} from "./seller-return-label-policy";

describe("seller return label policy", () => {
  it("treats an older charge switch as buyer pays", () => {
    const policy = policyFromStored({ chargeReturnShipping: true });
    expect(policy.returnLabelPayer).toBe("buyer");
    expect(returnLabelChargesBuyer(policy, "Order Arrived Damaged")).toBe(true);
    expect(showsFreeReturns(policy)).toBe(false);
  });

  it("treats an older off switch as the seller pays", () => {
    const policy = policyFromStored({ chargeReturnShipping: false });
    expect(policy.returnLabelPayer).toBe("seller");
    expect(showsFreeReturns(policy)).toBe(true);
    expect(returnLabelChargesBuyer(policy, "Changed my mind")).toBe(false);
  });

  it("charges only the reasons marked buyer pays", () => {
    const policy = policyFromStored({
      returnLabelPayer: "by_reason",
      returnLabelPayerByReason: {
        "Changed my mind": "buyer",
        "Order Arrived Damaged": "seller",
      },
    });
    expect(returnLabelChargesBuyer(policy, "Changed my mind")).toBe(true);
    expect(returnLabelChargesBuyer(policy, "Order Arrived Damaged")).toBe(false);
    expect(returnLabelChargesBuyer(policy, "Wrong Item Delivered")).toBe(false);
    expect(returnLabelChargesBuyer(policy, "Doesn't fit")).toBe(true);
    expect(returnLabelChargesBuyer(policy, "Missing parts")).toBe(false);
    expect(returnLabelChargesBuyer(policy, "Initiated by seller")).toBe(false);
    expect(returnLabelChargesBuyer(policy, "Other: too big")).toBe(false);
    expect(chargeReturnShippingForMode("by_reason")).toBe(false);
    expect(chargeReturnShippingForMode("buyer")).toBe(true);
  });

  it("hides buyer-pay when the seller chose I do, and still lets the seller pay when the buyer pays", () => {
    const sellerPays = policyFromStored({ returnLabelPayer: "seller" });
    expect(returnLabelSellerChooses(sellerPays, "Changed my mind")).toBe(false);
    expect(returnLabelSellerChooses(sellerPays, "Order Arrived Damaged")).toBe(false);

    const buyerPays = policyFromStored({ returnLabelPayer: "buyer" });
    expect(returnLabelSellerChooses(buyerPays, "Changed my mind")).toBe(true);
    expect(returnLabelSellerChooses(buyerPays, "Order Arrived Damaged | Note: cracked")).toBe(true);
  });

  it("writes the bold handling line only for a preset", () => {
    expect(handlingTimeBoldLine("Northwest Community", "2-3")).toBe(
      "Northwest Community typically ships in 2-3 business days."
    );
    expect(handlingTimeBoldLine("Northwest Community", "custom")).toBeNull();
    expect(handlingTimeBoldLine("Northwest Community", null)).toBeNull();
  });

  it("names the seller in the buyer warning", () => {
    expect(buyerReturnShippingWarning("Northwest Community")).toContain("Northwest Community doesn't offer free returns");
  });

  it("tells the buyer after they choose a reason whether that reason includes a free label", () => {
    const policy = policyFromStored({ returnLabelPayer: "by_reason" });
    expect(buyerReturnLabelFollowup("Northwest Community", policy, "Changed my mind")).toContain(
      "doesn't offer free returns"
    );
    expect(buyerReturnLabelFollowup("Northwest Community", policy, "Order Arrived Damaged")).toBe(
      "Northwest Community will send you a return label very soon!"
    );
    expect(buyerReturnLabelFollowup("Northwest Community", policy, "Other")).toContain("will decide");
  });
});
