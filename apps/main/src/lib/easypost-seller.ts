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
  const key = await getSellerEasyPostApiKey(memberId);
  return key != null ? new EasyPostClient(key) : null;
}

/**
 * Returns the decrypted EasyPost API key for the seller, or null if not connected.
 * Used when calling the EasyPost API directly (e.g. createShipmentWithAddresses, buyShipmentWithRateId).
 */
export async function getSellerEasyPostApiKey(memberId: string): Promise<string | null> {
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: { easypostApiKeyEncrypted: true },
  });
  if (!member?.easypostApiKeyEncrypted) return null;
  try {
    return decrypt(member.easypostApiKeyEncrypted);
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

/** From/sender address for EasyPost shipment create. Must include name or company for ProviderEndShipper. */
export type EasyPostFromAddress = {
  name: string;
  company: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone?: string;
};

/** To/destination address for EasyPost shipment create. */
export type EasyPostToAddress = {
  name: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
};

/** Parcel for EasyPost shipment create (dimensions in inches, weight in oz). */
export type EasyPostParcel = {
  length: number;
  width: number;
  height: number;
  weight: number;
};

/** Created shipment shape from EasyPost POST /shipments */
export type CreatedShipment = {
  id: string;
  rates?: Array<{ id: string; carrier: string; service: string; rate: string }>;
};

/**
 * Create a sender address via POST /addresses so EasyPost stores name and company.
 * Inline from_address on shipment create can fail ProviderEndShipper at buy; using a stored address by id fixes it.
 */
async function createSenderAddress(apiKey: string, fromAddress: EasyPostFromAddress): Promise<string> {
  const auth = Buffer.from(`${apiKey}:`).toString("base64");
  const body = {
    address: {
      name: fromAddress.name,
      company: fromAddress.company,
      street1: fromAddress.street1,
      ...(fromAddress.street2 ? { street2: fromAddress.street2 } : {}),
      city: fromAddress.city,
      state: fromAddress.state,
      zip: fromAddress.zip,
      country: fromAddress.country,
      ...(fromAddress.phone !== undefined ? { phone: fromAddress.phone } : {}),
    },
  };
  const res = await fetch(`${EASYPOST_API}/addresses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as {
    id?: string;
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
          : "Failed to create sender address";
    const err = new Error(msg) as Error & { code?: string; json_body?: unknown };
    err.code = data?.error?.code ?? data?.code;
    err.json_body = data;
    throw err;
  }
  if (typeof data?.id !== "string") throw new Error("EasyPost address response missing id");
  return data.id;
}

/**
 * Create a shipment via direct POST. From_address is created as a separate Address first and referenced by id
 * so ProviderEndShipper (name/company) is reliably stored and accepted at buy time.
 */
export async function createShipmentWithAddresses(
  apiKey: string,
  fromAddress: EasyPostFromAddress,
  toAddress: EasyPostToAddress,
  parcel: EasyPostParcel
): Promise<CreatedShipment> {
  const fromAddressId = await createSenderAddress(apiKey, fromAddress);
  console.error("[shipping/rates] created sender address id=", fromAddressId);
  const auth = Buffer.from(`${apiKey}:`).toString("base64");
  const body = {
    shipment: {
      from_address: { id: fromAddressId },
      to_address: {
        name: toAddress.name,
        street1: toAddress.street1,
        ...(toAddress.street2 ? { street2: toAddress.street2 } : {}),
        city: toAddress.city,
        state: toAddress.state,
        zip: toAddress.zip,
        country: toAddress.country,
      },
      parcel: {
        length: parcel.length,
        width: parcel.width,
        height: parcel.height,
        weight: parcel.weight,
      },
    },
  };
  const res = await fetch(`${EASYPOST_API}/shipments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as CreatedShipment & {
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
          : "Failed to create shipment";
    const err = new Error(msg) as Error & { code?: string; json_body?: unknown };
    err.code = data?.error?.code ?? data?.code;
    err.json_body = data;
    throw err;
  }
  return data;
}

/**
 * Create a shipment with a predefined parcel (e.g. FlatRateEnvelope) via direct POST.
 * From_address created as separate Address and referenced by id for ProviderEndShipper.
 */
export async function createShipmentWithAddressesPredefined(
  apiKey: string,
  fromAddress: EasyPostFromAddress,
  toAddress: EasyPostToAddress,
  predefinedPackage: string,
  weightOz: number
): Promise<CreatedShipment> {
  const fromAddressId = await createSenderAddress(apiKey, fromAddress);
  console.error("[shipping/rates] created sender address id=", fromAddressId);
  const auth = Buffer.from(`${apiKey}:`).toString("base64");
  const body = {
    shipment: {
      from_address: { id: fromAddressId },
      to_address: {
        name: toAddress.name,
        street1: toAddress.street1,
        ...(toAddress.street2 ? { street2: toAddress.street2 } : {}),
        city: toAddress.city,
        state: toAddress.state,
        zip: toAddress.zip,
        country: toAddress.country,
      },
      parcel: {
        predefined_package: predefinedPackage,
        weight: weightOz,
      },
    },
  };
  const res = await fetch(`${EASYPOST_API}/shipments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as CreatedShipment & {
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
          : "Failed to create shipment";
    const err = new Error(msg) as Error & { code?: string; json_body?: unknown };
    err.code = data?.error?.code ?? data?.code;
    err.json_body = data;
    throw err;
  }
  return data;
}

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
