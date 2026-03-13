import { prisma } from "database";
import { decrypt } from "@/lib/encrypt";

const SHIPPO_API = "https://api.goshippo.com";

function shippoHeaders(apiKey: string) {
  return {
    "Content-Type": "application/json",
    Authorization: `ShippoToken ${apiKey}`,
  };
}

/**
 * Returns the decrypted Shippo API key for the seller, or null if not connected.
 */
export async function getSellerShippoApiKey(memberId: string): Promise<string | null> {
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: { shippoApiKeyEncrypted: true },
  });
  if (!member?.shippoApiKeyEncrypted) return null;
  try {
    return decrypt(member.shippoApiKeyEncrypted);
  } catch {
    return null;
  }
}

/** Shippo v2 Address Book item */
export type ShippoV2AddressResult = {
  id: string;
  address?: {
    name?: string;
    organization?: string;
    address_line_1?: string;
    address_line_2?: string;
    city_locality?: string;
    state_province?: string;
    postal_code?: string;
    country_code?: string;
    phone?: string;
    email?: string;
  };
};

/** Address shape for Shippo v1 shipment API (address_from / address_to) */
export type ShippoShipmentAddress = {
  name: string;
  company?: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone?: string;
  email?: string;
};

/** Parcel for Shippo shipment (inches, oz) */
export type ShippoParcel = {
  length: number;
  width: number;
  height: number;
  weight: number;
};

/** Rate from Shippo shipment response */
export type ShippoRate = {
  object_id: string;
  amount: string;
  provider?: string;
  servicelevel_name?: string;
  carrier?: string;
  service?: string;
};

/** Shippo shipment create response */
export type ShippoShipmentResponse = {
  object_id: string;
  rates?: ShippoRate[];
};

/** Shippo transaction (label) response */
export type ShippoTransactionResponse = {
  object_id: string;
  label_url?: string | null;
  tracking_number?: string | null;
  tracking_status?: string | null;
  tracking_url_provider?: string | null;
};

function mapV2AddressToShipment(v2: ShippoV2AddressResult["address"], defaultName: string): ShippoShipmentAddress | null {
  const addr = v2;
  if (!addr?.address_line_1?.trim() || !addr?.city_locality?.trim() || !addr?.state_province?.trim() || !addr?.postal_code?.trim()) return null;
  const name = (addr.name ?? addr.organization ?? defaultName).trim() || "Seller";
  return {
    name,
    ...(addr.organization?.trim() ? { company: addr.organization.trim() } : {}),
    street1: addr.address_line_1.trim().slice(0, 35),
    ...(addr.address_line_2?.trim() ? { street2: addr.address_line_2.trim().slice(0, 35) } : {}),
    city: addr.city_locality.trim(),
    state: addr.state_province.trim(),
    zip: String(addr.postal_code).trim().replace(/\D/g, "").slice(0, 16),
    country: (addr.country_code ?? "US").toUpperCase().slice(0, 2),
    ...(addr.phone?.trim() ? { phone: addr.phone.trim().slice(0, 32) } : {}),
    ...(addr.email?.trim() ? { email: addr.email.trim().slice(0, 128) } : {}),
  };
}

/**
 * Fetch the seller's first address from Shippo Address Book (v2). Use as address_from for shipments.
 * Returns null if the account has no addresses (seller must add one in Shippo).
 */
export async function getSellerFromAddress(apiKey: string): Promise<ShippoShipmentAddress | null> {
  const res = await fetch(`${SHIPPO_API}/v2/addresses?limit=1`, {
    headers: shippoHeaders(apiKey),
  });
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as { results?: ShippoV2AddressResult[] } | null;
  const first = data?.results?.[0];
  if (!first?.address) return null;
  return mapV2AddressToShipment(first.address, "Seller");
}

/**
 * Create a shipment and get rates. Uses Shippo v1 API (POST /shipments) with async: false.
 */
export async function createShipment(
  apiKey: string,
  fromAddress: ShippoShipmentAddress,
  toAddress: ShippoShipmentAddress,
  parcel: ShippoParcel
): Promise<ShippoShipmentResponse> {
  const body = {
    address_from: {
      name: fromAddress.name || "Seller",
      company: fromAddress.company ?? fromAddress.name ?? "Seller",
      street1: fromAddress.street1.slice(0, 35),
      ...(fromAddress.street2 ? { street2: fromAddress.street2.slice(0, 35) } : {}),
      city: fromAddress.city,
      state: fromAddress.state,
      zip: fromAddress.zip,
      country: fromAddress.country,
      ...(fromAddress.phone ? { phone: fromAddress.phone } : {}),
      ...(fromAddress.email ? { email: fromAddress.email } : {}),
    },
    address_to: {
      name: toAddress.name || "Recipient",
      street1: toAddress.street1.slice(0, 35),
      ...(toAddress.street2 ? { street2: toAddress.street2.slice(0, 35) } : {}),
      city: toAddress.city,
      state: toAddress.state,
      zip: toAddress.zip,
      country: toAddress.country,
    },
    parcels: [
      {
        length: String(parcel.length),
        width: String(parcel.width),
        height: String(parcel.height),
        distance_unit: "in",
        weight: String(parcel.weight),
        mass_unit: "oz",
      },
    ],
    async: false,
  };
  const res = await fetch(`${SHIPPO_API}/shipments`, {
    method: "POST",
    headers: shippoHeaders(apiKey),
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as ShippoShipmentResponse & {
    _messages?: unknown;
    message?: string;
    detail?: string;
  };
  if (!res.ok) {
    const msg = typeof data?.message === "string" ? data.message : data?.detail ?? "Failed to create shipment";
    const err = new Error(msg) as Error & { json_body?: unknown };
    err.json_body = data;
    throw err;
  }
  return data;
}

/**
 * Purchase a label for the given rate (Shippo transaction). Rate must be less than 7 days old.
 */
export async function buyLabel(apiKey: string, rateObjectId: string): Promise<ShippoTransactionResponse> {
  const res = await fetch(`${SHIPPO_API}/transactions`, {
    method: "POST",
    headers: shippoHeaders(apiKey),
    body: JSON.stringify({ rate: rateObjectId }),
  });
  const data = (await res.json().catch(() => ({}))) as ShippoTransactionResponse & {
    message?: string;
    detail?: string;
    _messages?: unknown;
  };
  if (!res.ok) {
    const msg = typeof data?.message === "string" ? data.message : data?.detail ?? "Failed to purchase label";
    const err = new Error(msg) as Error & { json_body?: unknown };
    err.json_body = data;
    throw err;
  }
  return data;
}
