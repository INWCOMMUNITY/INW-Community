import EasyPostClient from "@easypost/api";
import { prisma } from "database";
import { decrypt } from "@/lib/encrypt";

const EASYPOST_API = "https://api.easypost.com/v2";

/**
 * Returns an EasyPost client for the seller's connected account, or null if not connected.
 * Use for rates and label purchase so the seller's card is charged.
 */
export async function getSellerEasyPostClient(
  memberId: string
): Promise<InstanceType<typeof EasyPostClient> | null> {
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: { easypostApiKeyEncrypted: true },
  });
  if (!member?.easypostApiKeyEncrypted) return null;
  try {
    const key = decrypt(member.easypostApiKeyEncrypted);
    return new EasyPostClient(key);
  } catch {
    return null;
  }
}

/** Bought shipment shape from EasyPost POST /shipments/:id/buy */
export type BoughtShipment = {
  id: string;
  tracking_code?: string | null;
  postage_label?: { label_url?: string } | null;
};

/**
 * Buy a shipment with the given rate ID using a direct POST so the request body
 * matches the API exactly: { rate: { id: "rate_..." } }. The SDK can send a
 * malformed body and trigger BAD_REQUEST.
 */
export async function buyShipmentWithRateId(
  memberId: string,
  shipmentId: string,
  rateId: string
): Promise<BoughtShipment> {
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: { easypostApiKeyEncrypted: true },
  });
  if (!member?.easypostApiKeyEncrypted) throw new Error("SHIPPING_ACCOUNT_REQUIRED");
  const apiKey = decrypt(member.easypostApiKeyEncrypted);
  const auth = Buffer.from(`${apiKey}:`).toString("base64");
  const res = await fetch(`${EASYPOST_API}/shipments/${shipmentId}/buy`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({ rate: { id: rateId } }),
  });
  const data = (await res.json().catch(() => ({}))) as BoughtShipment & {
    error?: { code?: string; message?: string };
    message?: string;
    code?: string;
  };
  if (!res.ok) {
    const msg =
      typeof data?.error?.message === "string"
        ? data.error.message
        : typeof data?.message === "string"
          ? data.message
          : "Failed to buy shipment";
    const err = new Error(msg) as Error & { code?: string; json_body?: unknown };
    err.code = data?.error?.code ?? data?.code;
    err.json_body = data;
    throw err;
  }
  return data;
}
