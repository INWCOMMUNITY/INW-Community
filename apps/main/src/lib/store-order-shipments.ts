/** Current outbound / return shipment helpers after Shipment became 1:many. */

export const OUTBOUND_SHIPMENT_KINDS = ["outbound", "replacement"] as const;

export type ShipmentKindPick = {
  kind?: string | null;
  supersededAt?: Date | string | null;
  createdAt?: Date | string;
};

export function isOutboundShipmentKind(kind: string | null | undefined): boolean {
  return kind !== "return";
}

export function pickCurrentOutboundShipment<T extends ShipmentKindPick>(
  shipments: T[] | null | undefined
): T | null {
  const active = (shipments ?? []).filter(
    (s) => isOutboundShipmentKind(s.kind) && s.supersededAt == null
  );
  if (active.length === 0) return null;
  active.sort((a, b) => {
    const tb = new Date(b.createdAt ?? 0).getTime();
    const ta = new Date(a.createdAt ?? 0).getTime();
    return tb - ta;
  });
  return active[0] ?? null;
}

export function pickReturnShipment<T extends { kind?: string | null }>(
  shipments: T[] | null | undefined
): T | null {
  const matches = (shipments ?? []).filter((s) => s.kind === "return");
  return matches[0] ?? null;
}

export function hasCurrentOutboundShipment(
  shipments: ShipmentKindPick[] | null | undefined
): boolean {
  return pickCurrentOutboundShipment(shipments) != null;
}

/** Prisma where: order has no current outbound/replacement label. */
export const whereNoCurrentOutboundShipment = {
  shipments: { none: { supersededAt: null, kind: { not: "return" } } },
} as const;

/** Prisma where: order has a current outbound/replacement label. */
export const whereHasCurrentOutboundShipment = {
  shipments: { some: { supersededAt: null, kind: { not: "return" } } },
} as const;

export const storeOrderShipmentInclude = {
  shipments: { orderBy: { createdAt: "desc" as const } },
  storeReturns: {
    orderBy: { createdAt: "desc" as const },
    include: { returnShipment: true },
  },
} as const;

export function serializeOrderShipments<
  T extends {
    shipments?: Parameters<typeof pickCurrentOutboundShipment>[0];
    storeReturns?: Array<{
      returnShipment?: unknown;
      [key: string]: unknown;
    }>;
  },
>(order: T): Omit<T, "shipments" | "storeReturns"> & {
  shipment: ReturnType<typeof pickCurrentOutboundShipment>;
  returnShipment: unknown;
  storeReturn: T["storeReturns"] extends Array<infer R> ? R | null : null;
} {
  const { shipments, storeReturns, ...rest } = order;
  const latestReturn = storeReturns?.[0] ?? null;
  return {
    ...rest,
    shipment: pickCurrentOutboundShipment(shipments),
    returnShipment: pickReturnShipment(shipments) ?? latestReturn?.returnShipment ?? null,
    storeReturn: latestReturn as T["storeReturns"] extends Array<infer R> ? R | null : null,
  };
}
