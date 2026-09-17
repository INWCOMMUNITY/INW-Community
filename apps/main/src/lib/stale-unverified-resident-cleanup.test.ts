import { describe, expect, it } from "vitest";
import { staleUnverifiedResidentWhere } from "./stale-unverified-resident-cleanup";

describe("stale unverified resident cleanup", () => {
  it("excludes closed accounts and durable commerce/financial relations", () => {
    const where = staleUnverifiedResidentWhere(new Date("2020-01-01T00:00:00.000Z"));
    expect(where.status).toEqual({ not: "closed" });
    expect(where.storeItemsSold).toEqual({ none: {} });
    expect(where.storeOrdersAsBuyer).toEqual({ none: {} });
    expect(where.storeOrdersAsSeller).toEqual({ none: {} });
    expect(where.storeVariants).toEqual({ none: {} });
    expect(where.checkoutAttempts).toEqual({ none: {} });
    expect(where.inventoryStates).toEqual({ none: {} });
    expect(where.inventoryEvents).toEqual({ none: {} });
    expect(where.inventoryReservations).toEqual({ none: {} });
    expect(where.variantBackfillMaps).toEqual({ none: {} });
    expect(where.refundOperations).toEqual({ none: {} });
    expect(where.transferOperations).toEqual({ none: {} });
    expect(where.sellerBalance).toEqual({ is: null });
    expect(where.sellerBalanceTransactions).toEqual({ none: {} });
    expect(where.subscriptions).toEqual({ none: {} });
    expect(where.reports).toEqual({ none: {} });
    expect(where.stripeCustomerId).toBeNull();
    expect(where.stripeConnectAccountId).toBeNull();
  });

  it("does not select a stale unverified resident who only has a Report", () => {
    const where = staleUnverifiedResidentWhere(new Date("2020-01-01T00:00:00.000Z"));
    expect(where.reports).toEqual({ none: {} });
  });
});
