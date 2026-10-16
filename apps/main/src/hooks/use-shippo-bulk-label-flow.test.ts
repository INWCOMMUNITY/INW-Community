import { describe, expect, it } from "vitest";
import {
  assignTransactionsToBatches,
  labelPayloadsForBatches,
  packingSlipGroupsForSelection,
  parseCombinedOrderGroups,
  purchaseGroupsForSelection,
  type StoreOrderForBulkLabel,
} from "./use-shippo-bulk-label-flow";

describe("combined Shippo purchase groups", () => {
  it("keeps a fully selected box as one combined shipment", () => {
    const groups = purchaseGroupsForSelection(
      ["a", "b", "c"],
      [["a", "b", "c"]]
    );
    expect(groups).toEqual([{ orderIds: ["a", "b", "c"], combine: true }]);
  });

  it("leaves an order out of the box as its own label", () => {
    const groups = purchaseGroupsForSelection(["a", "b", "c"], [["a", "b"]]);
    expect(groups).toEqual([
      { orderIds: ["a", "b"], combine: true },
      { orderIds: ["c"], combine: false },
    ]);
    expect(packingSlipGroupsForSelection(["a", "b", "c"], [["a", "b"]])).toEqual([
      ["a", "b"],
      ["c"],
    ]);
  });

  it("does not combine a partial box with the order that was left out", () => {
    const groups = purchaseGroupsForSelection(["a", "c"], [["a", "b"]]);
    expect(groups).toEqual([
      { orderIds: ["a"], combine: false },
      { orderIds: ["c"], combine: false },
    ]);
  });

  it("reads a combined box when the pipe was only decoded once", () => {
    expect(parseCombinedOrderGroups("a%7Cb%7Cc")).toEqual([["a", "b", "c"]]);
    expect(parseCombinedOrderGroups("a~b~c,d~e")).toEqual([
      ["a", "b", "c"],
      ["d", "e"],
    ]);
  });
});

function shipOrder(id: string, orderNumber: string, title: string): StoreOrderForBulkLabel {
  return {
    id,
    orderNumber,
    status: "paid",
    shippingAddress: { street: "1 Main St", city: "Spokane", state: "WA", zip: "99201" },
    createdAt: "2026-01-01T00:00:00.000Z",
    buyer: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" },
    items: [{ storeItem: { title }, quantity: 1, priceCentsAtPurchase: 1000 }],
  };
}

describe("separate Shippo labels for selected boxes", () => {
  it("sends one Shippo order per box, including an order left out", () => {
    const box = [shipOrder("a", "A1", "Mug"), shipOrder("b", "B2", "Bowl")];
    const leftover = shipOrder("c", "C3", "Plate");
    const payloads = labelPayloadsForBatches([
      { orders: box, combine: true },
      { orders: [leftover], combine: false },
    ]);
    expect(payloads).toHaveLength(2);
    expect(payloads?.[0]?.line_items).toHaveLength(1);
    expect(payloads?.[0]?.line_items[0]?.title).toBe("Combined shipment");
    expect(payloads?.[1]?.line_items).toHaveLength(1);
    expect(payloads?.[1]?.line_items[0]?.title).toBe("Plate");
    expect(payloads?.[0]?.order_number).toMatch(/^CMB/);
    expect(payloads?.[1]?.order_number).toMatch(/C3-L/);
    expect(payloads?.[0]?.order_number).not.toBe(payloads?.[1]?.order_number);
    expect(JSON.stringify(payloads?.[0])).not.toContain("Plate");
    expect(JSON.stringify(payloads?.[1])).not.toContain("Combined shipment");
  });

  it("keeps two selected boxes as two labels", () => {
    const payloads = labelPayloadsForBatches([
      { orders: [shipOrder("a", "A1", "Mug"), shipOrder("b", "B2", "Bowl")], combine: true },
      { orders: [shipOrder("c", "C3", "Plate"), shipOrder("d", "D4", "Cup")], combine: true },
    ]);
    expect(payloads).toHaveLength(2);
    expect(payloads?.every((payload) => payload.line_items.length === 1)).toBe(true);
    expect(payloads?.[0]?.order_number).not.toBe(payloads?.[1]?.order_number);
  });

  it("matches each purchased label to one box", () => {
    const matched = assignTransactionsToBatches(
      [
        { order_id: "shippo-1", object_id: "tx-1" },
        { order_id: "shippo-2", object_id: "tx-2" },
      ],
      {
        batchCount: 2,
        batchOrderNumbers: ["CMB1", "C3-L1"],
        createdOrderIds: ["shippo-1", "shippo-2"],
        savedIndexes: [],
      }
    );
    expect(matched.assignments.map((row) => row.batchIndex)).toEqual([0, 1]);
    expect(matched.assignments[0]?.transaction.object_id).toBe("tx-1");
    expect(matched.assignments[1]?.transaction.object_id).toBe("tx-2");
  });

  it("does not attach one label to every remaining box", () => {
    const matched = assignTransactionsToBatches([{ order_id: "shippo-2", object_id: "tx-2" }], {
      batchCount: 2,
      batchOrderNumbers: ["CMB1", "C3-L1"],
      createdOrderIds: ["shippo-1", "shippo-2"],
      savedIndexes: [],
    });
    expect(matched.assignments).toHaveLength(1);
    expect(matched.assignments[0]?.batchIndex).toBe(1);
  });
});
