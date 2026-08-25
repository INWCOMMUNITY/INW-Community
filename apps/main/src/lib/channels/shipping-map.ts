import { prisma } from "database";
import { etsyForm, etsyGet } from "./etsy/client";
import type { ChannelConnectionContext, ChannelProvider } from "./types";

export type ShippingProfileCache = Record<string, string>;

export type EtsyMoney = {
  amount?: number;
  divisor?: number;
  currency_code?: string;
};

export type EtsyShippingProfileDestination = {
  destination_country_iso?: string | null;
  destination_region?: string | null;
  primary_cost?: EtsyMoney | number | string | null;
};

export type EtsyShopShippingProfile = {
  shipping_profile_id: number;
  title?: string | null;
  profile_type?: string | null;
  shipping_profile_destinations?: EtsyShippingProfileDestination[] | null;
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

export function isEtsyMissingShopsWriteScope(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /shops_w/i.test(msg);
}

function canCreateEtsyShippingProfiles(conn: ChannelConnectionContext): boolean {
  if (conn.config?.etsyCannotCreateShippingProfiles === true) return false;
  const scopes = String(conn.scopes ?? "");
  if (scopes && !/\bshops_w\b/.test(scopes)) return false;
  return true;
}

async function markCannotCreateShippingProfiles(conn: ChannelConnectionContext): Promise<void> {
  const config = { ...(conn.config ?? {}), etsyCannotCreateShippingProfiles: true };
  conn.config = config;
  await prisma.channelConnection
    .update({
      where: { id: conn.id },
      data: { config },
    })
    .catch(() => {});
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

export async function fetchEtsyShippingProfileDestinations(
  accessToken: string,
  shopId: string,
  shippingProfileId: number | string
): Promise<EtsyShippingProfileDestination[]> {
  try {
    const res = await etsyGet<{ results?: EtsyShippingProfileDestination[] }>(
      accessToken,
      `/shops/${shopId}/shipping-profiles/${shippingProfileId}/destinations`
    );
    return res.results ?? [];
  } catch {
    return [];
  }
}

/** Convert an Etsy money object (or dollar string) to integer cents. */
export function etsyMoneyToCents(money: unknown): number | null {
  if (money == null) return null;
  if (typeof money === "number" || typeof money === "string") {
    return parseFlatShippingCents(money);
  }
  if (typeof money === "object") {
    const amount = Number((money as { amount?: unknown }).amount);
    if (!Number.isFinite(amount)) return null;
    const divisor = Number((money as { divisor?: unknown }).divisor);
    const d = Number.isFinite(divisor) && divisor > 0 ? divisor : 100;
    return Math.max(0, Math.round((amount / d) * 100));
  }
  return null;
}

function isUsDestination(dest: EtsyShippingProfileDestination): boolean {
  const country = String(dest.destination_country_iso ?? "").toUpperCase();
  const region = String(dest.destination_region ?? "").toUpperCase();
  return country === "US" || region === "US" || region === "UNITED_STATES";
}

/** First US (or otherwise first) destination primary cost. Calculated profiles have no flat rate. */
export function etsyProfileDomesticShippingCostCents(
  profile: EtsyShopShippingProfile
): number | null {
  if (isEtsyCalculatedShippingProfile(profile)) return null;
  const dests = profile.shipping_profile_destinations ?? [];
  if (dests.length === 0) return null;
  const picked = dests.find(isUsDestination) ?? dests[0];
  return etsyMoneyToCents(picked?.primary_cost);
}

/** POST body for Etsy createShopShippingProfile (US domestic flat rate). */
export function buildInwFlatProfileFields(
  rateCents: number,
  profileName: string
): Record<string, string | number> {
  const cost = (Math.max(0, Math.round(rateCents)) / 100).toFixed(2);
  return {
    title: profileName,
    origin_country_iso: "US",
    destination_country_iso: "US",
    primary_cost: cost,
    secondary_cost: cost,
    min_processing_time: 1,
    max_processing_time: 3,
  };
}

/**
 * When an INW rate bucket could not be created, only reuse a shop profile whose US
 * primary cost matches. Otherwise the listing should stay a draft.
 */
export function etsyFallbackProfileIfRateMatches(
  intendedCents: number,
  profile: EtsyShopShippingProfile | null | undefined
): EtsyShopShippingProfile | null {
  if (!profile || isEtsyCalculatedShippingProfile(profile)) return null;
  const domestic = etsyProfileDomesticShippingCostCents(profile);
  if (domestic == null || domestic !== Math.round(intendedCents)) return null;
  return profile;
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
      buildInwFlatProfileFields(rateCents, profileName)
    );
    const id = created.shipping_profile_id;
    if (!id) return null;
    const profileId = String(id);
    await persistShippingProfile(conn.id, conn.config, rateCents, profileId);
    return profileId;
  } catch (e) {
    if (isEtsyMissingShopsWriteScope(e)) {
      console.warn(
        "[channels] Etsy token cannot create shipping profiles (needs shops_w). Reconnect Etsy in Sync Stores.",
        { profileName }
      );
      await markCannotCreateShippingProfiles(conn);
      return null;
    }
    console.error("[channels] could not create Etsy flat shipping profile", {
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
    const createdId = canCreateEtsyShippingProfiles(conn)
      ? await tryCreateInwFlatProfile(conn, shopId, rate, profileName)
      : null;
    if (createdId) return resolvedProfile(createdId, false);

    const fallback = pickPreferredEtsyShippingProfile(profiles, conn.etsyShippingProfileId);
    const matched = etsyFallbackProfileIfRateMatches(rate, fallback);
    if (matched) {
      const matchedId = String(matched.shipping_profile_id);
      if (matchedId !== conn.etsyShippingProfileId) {
        await prisma.channelConnection
          .update({
            where: { id: conn.id },
            data: { etsyShippingProfileId: matchedId },
          })
          .catch(() => {});
        conn.etsyShippingProfileId = matchedId;
      }
      return resolvedProfile(matchedId, false);
    }
    console.error(
      "[channels] Etsy INW shipping profile unavailable; listing will be a draft rather than using a mismatched shop profile",
      {
        profileName,
        intendedCents: rate,
        fallbackProfileId: fallback ? String(fallback.shipping_profile_id) : null,
        fallbackCents: fallback ? etsyProfileDomesticShippingCostCents(fallback) : null,
      }
    );
    return resolvedProfile(null, false);
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
