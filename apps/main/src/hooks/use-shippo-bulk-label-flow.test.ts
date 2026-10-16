import { describe, expect, it } from "vitest";
import {
  packingSlipGroupsForSelection,
  parseCombinedOrderGroups,
  purchaseGroupsForSelection,
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
