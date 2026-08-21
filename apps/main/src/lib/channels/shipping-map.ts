import { prisma } from "database";
import { etsyForm, etsyGet } from "./etsy/client";
import type { ChannelConnectionContext, ChannelProvider } from "./types";

export type ShippingProfileCache = Record<string, string>;

export type EtsyShopShippingProfile = {
  shipping_profile_id: number;
  title?: string | null;
  profile_type?: string | null;
};

function shippingMap(config: Record<string, unknown> | null): ShippingProfileCache {
  const raw = config?.shippingProfileMap;
  if (!raw || typeof raw !== "object") return {};
  return raw as ShippingProfileCache;
}

async function persistShippingProfile(
  connectionId: string,
  config: Record<string, unknown> | null,
  rateCents: number,
  profileId: string
): Promise<void> {
  const key = String(rateCents);
  const map = shippingMap(config);
  map[key] = profileId;
  await prisma.channelConnection.update({
    where: { id: connectionId },
    data: { config: { ...(config ?? {}), shippingProfileMap: map } },
  });
}

export function isEtsyCalculatedShippingProfile(
  profile: Pick<EtsyShopShippingProfile, "profile_type"> | null | undefined
): boolean {
  const type = String(profile?.profile_type ?? "").toLowerCase();
  if (!type) return true;
  return type === "calculated";
}

/** Prefer a flat/manual shop profile. Calculated profiles need package weight and size. */
export function pickPreferredEtsyShippingProfile(
  profiles: EtsyShopShippingProfile[],
  preferredId?: string | null
): EtsyShopShippingProfile | null {
  if (profiles.length === 0) return null;
  const preferred =
    preferredId != null && preferredId !== ""
      ? profiles.find((p) => String(p.shipping_profile_id) === String(preferredId))
      : undefined;
  if (preferred && !isEtsyCalculatedShippingProfile(preferred)) return preferred;
  const firstManual = profiles.find((p) => !isEtsyCalculatedShippingProfile(p));
  if (firstManual) return firstManual;
  return preferred ?? profiles[0] ?? null;
}

export async function fetchEtsyShippingProfiles(
  accessToken: string,
  shopId: string
): Promise<EtsyShopShippingProfile[]> {
  const res = await etsyGet<{ results?: EtsyShopShippingProfile[] }>(
    accessToken,
    `/shops/${shopId}/shipping-profiles`
  );
  return res.results ?? [];
}

async function tryCreateInwFlatProfile(
  conn: ChannelConnectionContext,
  shopId: string,
  rateCents: number,
  profileName: string
): Promise<string | null> {
  try {
    const created = await etsyForm<{ shipping_profile_id?: number }>(
      conn.accessToken,
      `/shops/${shopId}/shipping-profiles`,
      "POST",
      {
        title: profileName,
        origin_country_iso: "US",
        primary_cost: (rateCents / 100).toFixed(2),
        secondary_cost: (rateCents / 100).toFixed(2),
        min_processing_time: 1,
        max_processing_time: 3,
      }
    );
    const id = created.shipping_profile_id;
    if (!id) return null;
    const profileId = String(id);
    await persistShippingProfile(conn.id, conn.config, rateCents, profileId);
    return profileId;
  } catch (e) {
    console.warn("[channels] could not create Etsy flat shipping profile", {
      error: String(e),
      profileName,
    });
    return null;
  }
}

export type ResolvedEtsyShippingProfile = {
  shippingProfileId: string | null;
  isCalculated: boolean;
};

function resolvedProfile(
  shippingProfileId: string | null,
  isCalculated: boolean
): ResolvedEtsyShippingProfile {
  return { shippingProfileId, isCalculated };
}

/** Resolve an Etsy shipping profile, preferring flat/manual over calculated. */
export async function resolveEtsyShippingProfile(
  conn: ChannelConnectionContext,
  shippingCostCents: number | null
): Promise<ResolvedEtsyShippingProfile> {
  const shopId = conn.externalShopId;
  let profiles: EtsyShopShippingProfile[] = [];
  if (shopId) {
    try {
      profiles = await fetchEtsyShippingProfiles(conn.accessToken, shopId);
    } catch (e) {
      console.error("[channels] fetch Etsy shipping profiles failed", { error: String(e) });
    }
  }

  if (shippingCostCents != null && shippingCostCents >= 0 && shopId) {
    const rate = Math.round(shippingCostCents);
    const profileName = `INW $${(rate / 100).toFixed(2)}`;
    const cached = shippingMap(conn.config)[String(rate)];
    const cachedProfile = cached
      ? profiles.find((p) => String(p.shipping_profile_id) === cached)
      : undefined;
    if (cached && cachedProfile && !isEtsyCalculatedShippingProfile(cachedProfile)) {
      return resolvedProfile(cached, false);
    }
    if (cached && !cachedProfile) {
      return resolvedProfile(cached, false);
    }
    const match = profiles.find((p) => p.title === profileName);
    if (match?.shipping_profile_id && !isEtsyCalculatedShippingProfile(match)) {
      await persistShippingProfile(conn.id, conn.config, rate, String(match.shipping_profile_id));
      return resolvedProfile(String(match.shipping_profile_id), false);
    }
    const createdId = await tryCreateInwFlatProfile(conn, shopId, rate, profileName);
    if (createdId) return resolvedProfile(createdId, false);
  }

  const picked = pickPreferredEtsyShippingProfile(profiles, conn.etsyShippingProfileId);
  if (!picked) {
    return resolvedProfile(conn.etsyShippingProfileId, true);
  }

  const pickedId = String(picked.shipping_profile_id);
  const isCalculated = isEtsyCalculatedShippingProfile(picked);
  if (!isCalculated && pickedId !== conn.etsyShippingProfileId) {
    await prisma.channelConnection
      .update({
        where: { id: conn.id },
        data: { etsyShippingProfileId: pickedId },
      })
      .catch(() => {});
    conn.etsyShippingProfileId = pickedId;
  }
  return resolvedProfile(pickedId, isCalculated);
}

export async function resolveEtsyShippingProfileId(
  conn: ChannelConnectionContext,
  shippingCostCents: number | null
): Promise<string | null> {
  return (await resolveEtsyShippingProfile(conn, shippingCostCents)).shippingProfileId;
}

/** Calculated profiles need package size; do not re-attach them on listing PATCH. */
export function shippingProfileIdForEtsyUpdate(
  resolved: ResolvedEtsyShippingProfile
): string | null {
  if (!resolved.shippingProfileId || resolved.isCalculated) return null;
  return resolved.shippingProfileId;
}

/** Normalize remote shipping to cents when provider exposes a flat primary rate. */
export function parseFlatShippingCents(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value >= 100 ? Math.round(value) : Math.round(value * 100);
  }
  if (typeof value === "string") {
    const n = Number(value.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(n)) return Math.round(n * 100);
  }
  return null;
}

export type ShippingPushContext = {
  provider: ChannelProvider;
  conn: ChannelConnectionContext;
  shippingCostCents: number | null;
};

/** Provider hook result for outbound shipping — adapters call this before create/update. */
export async function resolveOutboundShipping(ctx: ShippingPushContext): Promise<{
  etsyShippingProfileId?: string | null;
  flatRateCents?: number | null;
}> {
  if (ctx.provider === "etsy") {
    return {
      etsyShippingProfileId: await resolveEtsyShippingProfileId(ctx.conn, ctx.shippingCostCents),
    };
  }
  return { flatRateCents: ctx.shippingCostCents };
}
