import { describe, expect, it } from "vitest";
import { pickCurrentOutboundShipment, pickReturnShipment } from "./store-order-shipments";

describe("shipment picks", () => {
  it("returns the latest active outbound and ignores returns and superseded rows", () => {
    const shipments = [
      { id: "old", kind: "outbound", supersededAt: "2026-09-01", createdAt: "2026-09-01" },
      { id: "ret", kind: "return", supersededAt: null, createdAt: "2026-09-03" },
      { id: "rep", kind: "replacement", supersededAt: null, createdAt: "2026-09-02" },
    ];
    expect(pickCurrentOutboundShipment(shipments)?.id).toBe("rep");
    expect(pickReturnShipment(shipments)?.id).toBe("ret");
  });
});
