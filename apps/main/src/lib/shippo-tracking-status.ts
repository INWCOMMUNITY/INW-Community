/** Client-safe Shippo tracking helpers. Do not import Prisma or shippo-seller here. */

export function isShippoTrackingDelivered(status: string | null | undefined): boolean {
  if (!status) return false;
  const s = status.toUpperCase();
  return s === "DELIVERED" || s.includes("DELIVERED");
}

export function carrierToShippoToken(carrier: string): string {
  const c = carrier.toLowerCase().trim();
  if (c.includes("usps")) return "usps";
  if (c.includes("fedex")) return "fedex";
  if (c.includes("ups")) return "ups";
  if (c.includes("dhl")) return "dhl";
  return c || "usps";
}
