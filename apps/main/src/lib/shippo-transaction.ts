import type { SellerShippoCredential } from "@/lib/shippo-seller";
import { shippoJsonHeaders } from "@/lib/shippo-seller";
import { carrierToShippoToken } from "@/lib/shippo-tracking-status";

export { carrierToShippoToken, isShippoTrackingDelivered } from "@/lib/shippo-tracking-status";

const SHIPPO_API = "https://api.goshippo.com";

export type ShippoTransactionSnapshot = {
  objectId: string;
  status: string;
  trackingNumber: string | null;
  labelUrl: string | null;
  trackingUrlProvider: string | null;
  rateAmountCents: number | null;
  carrier: string | null;
  service: string | null;
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
  const body = (await res.json().catch(() => null)) as {
    object_id?: string;
    status?: string;
    tracking_number?: string;
    label_url?: string;
    tracking_url_provider?: string;
    rate?: { amount?: string | number } | string;
  } | null;
  if (!body || typeof body !== "object") return null;
  const rate = body.rate && typeof body.rate === "object" ? body.rate : undefined;
  const rateRecord = rate as { provider?: unknown; servicelevel_name?: unknown; servicelevel?: { name?: unknown } } | undefined;
  let carrier = typeof rateRecord?.provider === "string" ? rateRecord.provider.trim() : "";
  let service =
    typeof rateRecord?.servicelevel_name === "string"
      ? rateRecord.servicelevel_name.trim()
      : typeof rateRecord?.servicelevel?.name === "string"
        ? rateRecord.servicelevel.name.trim()
        : "";
  let rateAmountCents = centsFromShippoAmount(rate?.amount);
  const rateId = typeof body.rate === "string" ? body.rate.trim() : "";
  if (rateId && rateAmountCents == null) {
    const rateRes = await fetch(`${SHIPPO_API}/rates/${encodeURIComponent(rateId)}`, {
      headers: shippoJsonHeaders(cred),
    });
    const rateBody = (await rateRes.json().catch(() => null)) as {
      amount?: unknown;
      provider?: unknown;
      servicelevel_name?: unknown;
      servicelevel?: { name?: unknown };
    } | null;
    if (rateRes.ok && rateBody && typeof rateBody === "object") {
      rateAmountCents = centsFromShippoAmount(rateBody.amount);
      if (!carrier && typeof rateBody.provider === "string") carrier = rateBody.provider.trim();
      if (!service && typeof rateBody.servicelevel_name === "string") service = rateBody.servicelevel_name.trim();
      if (!service && typeof rateBody.servicelevel?.name === "string") service = rateBody.servicelevel.name.trim();
    }
  }
  const status =
    typeof body.status === "string" && body.status.trim()
      ? body.status
      : typeof (body as { object_status?: unknown }).object_status === "string"
        ? (body as { object_status: string }).object_status
        : "";
  return {
    objectId: typeof body.object_id === "string" && body.object_id.trim() ? body.object_id.trim() : id,
    status,
    trackingNumber: typeof body.tracking_number === "string" ? body.tracking_number.trim() || null : null,
    labelUrl: typeof body.label_url === "string" ? body.label_url.trim() || null : null,
    trackingUrlProvider:
      typeof body.tracking_url_provider === "string" ? body.tracking_url_provider.trim() || null : null,
    rateAmountCents,
    carrier: carrier || null,
    service: service || null,
  };
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
