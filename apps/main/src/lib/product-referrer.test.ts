import { describe, expect, it } from "vitest";
import { buildBackLink } from "./product-referrer";

describe("buildBackLink", () => {
  it("sends buyer orders back to My Orders", () => {
    expect(buildBackLink({ type: "order", orderKind: "buyer", orderId: "abc" })).toEqual({
      href: "/my-community/orders/abc",
      label: "Back to Order",
    });
    expect(buildBackLink({ type: "order", orderKind: "buyer" })).toEqual({
      href: "/my-community/orders",
      label: "Back to My Orders",
    });
  });

  it("keeps seller orders on seller hub", () => {
    expect(buildBackLink({ type: "order", orderKind: "seller", orderId: "abc" })).toEqual({
      href: "/seller-hub/orders/abc",
      label: "Back to Order",
    });
  });
});
