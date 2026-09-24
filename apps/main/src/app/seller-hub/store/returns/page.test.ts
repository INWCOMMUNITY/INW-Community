import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  STORE_RETURN_RECEIVE_ACTION_LABEL,
  STORE_RETURN_RETRY_REFUND_ACTION_LABEL,
  storeReturnSellerMoneyAction,
  storeReturnSellerMoneyActionLabel,
} from "@/lib/store-return";

const webSrc = readFileSync(path.join(__dirname, "page.tsx"), "utf8");
const mobileSrc = readFileSync(
  path.join(__dirname, "../../../../../../mobile/app/seller-hub/store/returns/index.tsx"),
  "utf8"
);

describe("seller return money-action surfaces", () => {
  it("maps inbound vs received vs refunded to the same actions used by web and mobile", () => {
    expect(storeReturnSellerMoneyAction({ returnStatus: "awaiting_return", orderStatus: "shipped" })).toBe(
      "receive"
    );
    expect(storeReturnSellerMoneyAction({ returnStatus: "in_transit", orderStatus: "shipped" })).toBe("receive");
    expect(storeReturnSellerMoneyAction({ returnStatus: "received", orderStatus: "shipped" })).toBe(
      "retry_refund"
    );
    expect(storeReturnSellerMoneyAction({ returnStatus: "received", orderStatus: "refunded" })).toBeNull();
    expect(storeReturnSellerMoneyAction({ returnStatus: "refunded", orderStatus: "refunded" })).toBeNull();
    expect(storeReturnSellerMoneyActionLabel("receive")).toBe(STORE_RETURN_RECEIVE_ACTION_LABEL);
    expect(storeReturnSellerMoneyActionLabel("retry_refund")).toBe(STORE_RETURN_RETRY_REFUND_ACTION_LABEL);
  });

  it("web posts the same receive route, labels retry distinctly, and refetches after error", () => {
    expect(webSrc).toContain("storeReturnSellerMoneyAction");
    expect(webSrc).toContain("storeReturnSellerMoneyActionLabel");
    expect(webSrc).toContain('postAction(order.id, "/returns/receive")');
    expect(webSrc).toContain("if (!res.ok)");
    expect(webSrc).toMatch(/if \(!res\.ok\)[\s\S]*load\(\)/);
    expect(webSrc).not.toMatch(/moneyAction[\s\S]{0,400}Mark received & refund/);
  });

  it("mobile posts the same receive route and refetches after error", () => {
    expect(mobileSrc).toContain("storeReturnSellerMoneyAction");
    expect(mobileSrc).toContain("storeReturnSellerMoneyActionLabel");
    expect(mobileSrc).toContain('act(order.id, "/returns/receive")');
    expect(mobileSrc).toMatch(/catch \(e: unknown\) \{[\s\S]*load\(\)/);
    expect(mobileSrc).toContain('disabled={busy}');
  });
});
