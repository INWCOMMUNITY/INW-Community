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

/** Shippo v2 Address Book item (address may use address_line_1 or address_line1, etc.) */
export type ShippoV2AddressResult = {
  id: string;
  address?: {
    name?: string;
    organization?: string;
    address_line_1?: string;
    address_line1?: string;
    address_line_2?: string;
    address_line2?: string;
    city_locality?: string;
    city?: string;
    state_province?: string;
    state?: string;
    postal_code?: string;
    postcode?: string;
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

function normalizeAddressField(
  ...values: (string | number | null | undefined)[]
): string {
  const v = values.find((x) => x != null && String(x).trim() !== "");
  return v != null ? String(v).trim() : "";
}

function mapV2AddressToShipment(v2: ShippoV2AddressResult["address"], defaultName: string): ShippoShipmentAddress | null {
  const addr = v2;
  const street1 = normalizeAddressField(addr?.address_line_1, addr?.address_line1);
  const city = normalizeAddressField(addr?.city_locality, addr?.city);
  const state = normalizeAddressField(addr?.state_province, addr?.state);
  const zip = normalizeAddressField(addr?.postal_code, addr?.postcode);
  if (!street1 || !city || !state || !zip) return null;
  const name = (addr?.name ?? addr?.organization ?? defaultName).trim() || "Seller";
  const street2 = normalizeAddressField(addr?.address_line_2, addr?.address_line2);
  return {
    name,
    ...(addr?.organization?.trim() ? { company: addr.organization.trim() } : {}),
    street1: street1.slice(0, 35),
    ...(street2 ? { street2: street2.slice(0, 35) } : {}),
    city,
    state,
    zip: zip.replace(/\D/g, "").slice(0, 16),
    country: (addr?.country_code ?? "US").toUpperCase().slice(0, 2),
    ...(addr?.phone?.trim() ? { phone: addr.phone.trim().slice(0, 32) } : {}),
    ...(addr?.email?.trim() ? { email: addr.email.trim().slice(0, 128) } : {}),
  };
}

/**
 * Fetch a valid from-address from Shippo Address Book (v2). Use as address_from for shipments.
 * Tries up to 20 addresses and returns the first one with required fields (street, city, state, zip).
 * Returns null if the account has no valid addresses. Throws on API errors (e.g. invalid key).
 */
export async function getSellerFromAddress(apiKey: string): Promise<ShippoShipmentAddress | null> {
  const res = await fetch(`${SHIPPO_API}/v2/addresses?limit=20`, {
    headers: shippoHeaders(apiKey),
  });
  const data = (await res.json().catch(() => null)) as { results?: ShippoV2AddressResult[]; detail?: string } | null;
  if (!res.ok) {
    const msg = typeof data?.detail === "string" ? data.detail : res.status === 401 ? "Invalid API key" : "Shippo API error";
    throw new Error(msg);
  }
  const results = data?.results ?? [];
  for (const item of results) {
    if (!item?.address) continue;
    const mapped = mapV2AddressToShipment(item.address, "Seller");
    if (mapped) return mapped;
  }
  return null;
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
