import { describe, expect, it } from "vitest";
import { sellerLedgerDebitCents } from "./refund-store-order";

describe("sellerLedgerDebitCents", () => {
  it("matches the Connect transfer withheld from the seller on fulfill", () => {
    // $10 item, 1% reserve = 10 cents, no extra platform fee
    expect(sellerLedgerDebitCents({ totalCents: 1000, subtotalCents: 1000 })).toBe(990);
  });
});
