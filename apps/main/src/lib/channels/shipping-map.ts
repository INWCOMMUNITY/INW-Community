import { prisma } from "database";
import { etsyForm, etsyGet } from "./etsy/client";
import type { ChannelConnectionContext, ChannelProvider } from "./types";

export type ShippingProfileCache = Record<string, string>;

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

/** Resolve or create an Etsy shipping profile for a flat rate (cents). */
export async function resolveEtsyShippingProfileId(
  conn: ChannelConnectionContext,
  shippingCostCents: number | null
): Promise<string | null> {
  if (shippingCostCents == null || shippingCostCents < 0) {
    return conn.etsyShippingProfileId;
  }
  const rate = Math.round(shippingCostCents);
  const cached = shippingMap(conn.config)[String(rate)];
  if (cached) return cached;

  const shopId = conn.externalShopId;
  if (!shopId) return conn.etsyShippingProfileId;

  const profileName = `INW $${(rate / 100).toFixed(2)}`;
  try {
    const existing = await etsyGet<{ results?: { shipping_profile_id: number; title?: string }[] }>(
      conn.accessToken,
      `/shops/${shopId}/shipping-profiles`
    );
    const match = existing.results?.find(
      (p) => p.title === profileName || String(p.shipping_profile_id) === cached
    );
    if (match?.shipping_profile_id) {
      await persistShippingProfile(conn.id, conn.config, rate, String(match.shipping_profile_id));
      return String(match.shipping_profile_id);
    }

    const created = await etsyForm<{ shipping_profile_id?: number }>(
      conn.accessToken,
      `/shops/${shopId}/shipping-profiles`,
      "POST",
      {
        title: profileName,
        origin_country_iso: "US",
        primary_cost: (rate / 100).toFixed(2),
        secondary_cost: (rate / 100).toFixed(2),
        min_processing_time: 1,
        max_processing_time: 3,
      }
    );
    const id = created.shipping_profile_id;
    if (id) {
      await persistShippingProfile(conn.id, conn.config, rate, String(id));
      return String(id);
    }
  } catch (e) {
    console.error("[channels] resolveEtsyShippingProfileId failed", { error: String(e) });
  }
  return conn.etsyShippingProfileId;
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
