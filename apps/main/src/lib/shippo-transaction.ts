import type { SellerShippoCredential } from "@/lib/shippo-seller";
import { shippoJsonHeaders } from "@/lib/shippo-seller";

const SHIPPO_API = "https://api.goshippo.com";

export type ShippoTransactionSnapshot = {
  objectId: string;
  status: string;
  trackingNumber: string | null;
  labelUrl: string | null;
  trackingUrlProvider: string | null;
  rateAmountCents: number | null;
};

function centsFromShippoAmount(amount: unknown): number | null {
  if (typeof amount === "number" && Number.isFinite(amount)) return Math.round(amount * 100);
  if (typeof amount === "string") {
    const n = Number(amount);
    return Number.isFinite(n) ? Math.round(n * 100) : null;
  }
  return null;
}

export async function fetchShippoTransaction(
  cred: SellerShippoCredential,
  transactionId: string
): Promise<ShippoTransactionSnapshot | null> {
  const id = transactionId.trim();
  if (!id) return null;
  const res = await fetch(`${SHIPPO_API}/transactions/${encodeURIComponent(id)}`, {
    headers: shippoJsonHeaders(cred),
  });
  if (!res.ok) {
    console.warn("[shippo] GET transaction failed", { status: res.status, transactionId: id });
    return null;
  }
  const body = (await res.json()) as {
    object_id?: string;
    status?: string;
    tracking_number?: string;
    label_url?: string;
    tracking_url_provider?: string;
    rate?: { amount?: string | number };
  };
  return {
    objectId: body.object_id ?? id,
    status: String(body.status ?? ""),
    trackingNumber: body.tracking_number?.trim() || null,
    labelUrl: body.label_url?.trim() || null,
    trackingUrlProvider: body.tracking_url_provider?.trim() || null,
    rateAmountCents: centsFromShippoAmount(body.rate?.amount),
  };
}

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

export type ShippoTrackSnapshot = {
  trackingNumber: string | null;
  trackingStatus: string;
  trackingHistory: unknown[];
};

export async function fetchShippoTracking(
  cred: SellerShippoCredential,
  carrier: string,
  trackingNumber: string
): Promise<ShippoTrackSnapshot | null> {
  const code = trackingNumber.trim();
  if (!code) return null;
  const res = await fetch(`${SHIPPO_API}/tracks`, {
    method: "POST",
    headers: shippoJsonHeaders(cred),
    body: JSON.stringify({
      carrier: carrierToShippoToken(carrier),
      tracking_number: code,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    tracking_status?: { status?: string };
    tracking_history?: unknown[];
    tracking_number?: string;
    status?: string;
    message?: string;
  };
  if (!res.ok) {
    console.warn("[shippo] POST tracks failed", { status: res.status, message: data.message });
    return null;
  }
  return {
    trackingNumber: data.tracking_number?.trim() || code,
    trackingStatus: String(data.tracking_status?.status ?? data.status ?? "UNKNOWN"),
    trackingHistory: data.tracking_history ?? [],
  };
}
