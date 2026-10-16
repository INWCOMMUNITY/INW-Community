import { describe, expect, it } from "vitest";
import { parseCombinedOrderGroups, purchaseGroupsForSelection } from "./use-shippo-bulk-label-flow";

describe("combined Shippo purchase groups", () => {
  it("keeps a fully selected box as one combined shipment", () => {
    const groups = purchaseGroupsForSelection(
      ["a", "b", "c"],
      [["a", "b", "c"]]
    );
    expect(groups).toEqual([{ orderIds: ["a", "b", "c"], combine: true }]);
  });

  it("reads a combined box when the pipe was only decoded once", () => {
    expect(parseCombinedOrderGroups("a%7Cb%7Cc")).toEqual([["a", "b", "c"]]);
    expect(parseCombinedOrderGroups("a~b~c,d~e")).toEqual([
      ["a", "b", "c"],
      ["d", "e"],
    ]);
  });
});
