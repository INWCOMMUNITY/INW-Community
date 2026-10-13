import { prisma } from "database";
import { etsyConnectionRequest } from "@/lib/etsy/connection-request";

export type EtsyRemoteShippingProfile = {
  source: "etsy";
  remoteProfileId: string;
  name: string;
  shippingCostCents?: number | null;
};

type EtsyMoney = number | string | { amount?: unknown; divisor?: unknown } | null | undefined;

type EtsyShippingProfileDestination = {
  destination_country_iso?: string | null;
  primary_cost?: EtsyMoney;
};

type EtsyShopShippingProfile = {
  shipping_profile_id?: number | string;
  title?: string | null;
  shipping_profile_name?: string | null;
  profile_type?: string | null;
  shipping_profile_destinations?: EtsyShippingProfileDestination[];
};

function parseFlatShippingCents(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value >= 100 ? Math.round(value) : Math.round(value * 100);
  }
  if (typeof value === "string") {
    const n = Number(value.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(n)) return Math.round(n * 100);
  }
  return null;
}

function etsyMoneyToCents(money: EtsyMoney): number | null {
  if (money == null) return null;
  if (typeof money === "number" || typeof money === "string") {
    return parseFlatShippingCents(money);
  }
  if (typeof money === "object") {
    const amount = Number(money.amount);
    if (!Number.isFinite(amount)) return null;
    const divisor = Number(money.divisor);
    const d = Number.isFinite(divisor) && divisor > 0 ? divisor : 100;
    return Math.max(0, Math.round((amount / d) * 100));
  }
  return null;
}

function isEtsyCalculatedShippingProfile(
  profile: Pick<EtsyShopShippingProfile, "profile_type"> | null | undefined
): boolean {
  const type = String(profile?.profile_type ?? "").toLowerCase();
  if (!type) return true;
  return type === "calculated";
}

function isUsDestination(dest: EtsyShippingProfileDestination): boolean {
  const iso = String(dest.destination_country_iso ?? "").toUpperCase();
  return iso === "US" || iso === "USA" || iso === "";
}

export function etsyProfileDomesticShippingCostCents(
  profile: EtsyShopShippingProfile
): number | null {
  if (isEtsyCalculatedShippingProfile(profile)) return null;
  const dests = profile.shipping_profile_destinations ?? [];
  if (dests.length === 0) return null;
  const picked = dests.find(isUsDestination) ?? dests[0];
  return etsyMoneyToCents(picked?.primary_cost);
}

async function fetchEtsyShippingProfileDestinations(
  connectionId: string,
  memberId: string,
  shopId: string,
  shippingProfileId: string
): Promise<EtsyShippingProfileDestination[]> {
  const res = await etsyConnectionRequest<{ results?: EtsyShippingProfileDestination[] }>({
    connectionId,
    memberId,
    method: "GET",
    path: `/shops/${encodeURIComponent(shopId)}/shipping-profiles/${encodeURIComponent(shippingProfileId)}/destinations`,
    maxAttempts: 2,
  });
  if (!res.ok) return [];
  return Array.isArray(res.data?.results) ? res.data.results : [];
}

/** Fetch Etsy shop shipping profiles as INW import rows. */
export async function fetchEtsyRemoteShippingProfiles(
  memberId: string
): Promise<{ profiles: EtsyRemoteShippingProfile[]; error?: string }> {
  const connection = await prisma.etsyConnection.findFirst({
    where: { memberId, status: "ACTIVE" },
    orderBy: { connectedAt: "desc" },
    select: { id: true, shopId: true },
  });
  if (!connection) {
    return { profiles: [], error: "Connect Etsy first." };
  }

  const res = await etsyConnectionRequest<{ results?: EtsyShopShippingProfile[] } | EtsyShopShippingProfile[]>({
    connectionId: connection.id,
    memberId,
    method: "GET",
    path: `/shops/${encodeURIComponent(connection.shopId)}/shipping-profiles`,
    maxAttempts: 3,
  });
  if (!res.ok) {
    return { profiles: [], error: res.message || "Could not load Etsy shipping profiles." };
  }

  const rows = Array.isArray(res.data)
    ? res.data
    : Array.isArray(res.data?.results)
      ? res.data.results
      : [];

  const profiles: EtsyRemoteShippingProfile[] = [];
  for (const p of rows) {
    const id = String(p.shipping_profile_id ?? "").trim();
    if (!/^\d+$/.test(id)) continue;

    let shippingCostCents = etsyProfileDomesticShippingCostCents(p);
    if (shippingCostCents == null && !isEtsyCalculatedShippingProfile(p)) {
      const dests = await fetchEtsyShippingProfileDestinations(
        connection.id,
        memberId,
        connection.shopId,
        id
      );
      shippingCostCents = etsyProfileDomesticShippingCostCents({
        ...p,
        shipping_profile_destinations: dests,
      });
    }

    profiles.push({
      source: "etsy",
      remoteProfileId: id,
      name: (p.title || p.shipping_profile_name || `Etsy profile ${id}`).trim(),
      shippingCostCents,
    });
  }

  return { profiles };
}
