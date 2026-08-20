import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { decrypt } from "@/lib/encrypt";
import { etsyGet, setEtsyConnectionContext } from "@/lib/channels/etsy/client";
import {
  fetchEtsyShippingProfiles,
  pickPreferredEtsyShippingProfile,
} from "@/lib/channels/shipping-map";

export const dynamic = "force-dynamic";

type RefreshResult = {
  ok: boolean;
  connectionId: string;
  shopId: string | null;
  previousConfig: Record<string, unknown>;
  newConfig: Record<string, unknown>;
  error?: string;
};

/**
 * POST /api/channels/etsy/refresh-config
 *
 * Refreshes the stored config for an Etsy connection by re-fetching:
 * - Shipping profiles
 * - Processing profiles (readiness_state_id required for physical listings)
 *
 * This is needed after Etsy made readiness_state_id mandatory in summer 2025.
 * Existing connections need their config updated to include defaultReadinessStateId.
 *
 * Call this endpoint after connecting to Etsy or if inventory sync fails with
 * "All offerings need readiness state" error.
 */
export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const conn = await prisma.channelConnection.findUnique({
    where: { memberId_provider: { memberId: userId, provider: "etsy" } },
  });

  if (!conn || conn.status === "disconnected" || !conn.accessTokenEncrypted) {
    return NextResponse.json({
      ok: false,
      error: "No active Etsy connection found. Please connect Etsy first.",
    }, { status: 400 });
  }

  let accessToken: string;
  try {
    accessToken = decrypt(conn.accessTokenEncrypted);
  } catch {
    return NextResponse.json({
      ok: false,
      error: "Could not decrypt access token. Please reconnect Etsy.",
    }, { status: 400 });
  }

  const shopId = conn.externalShopId;
  if (!shopId) {
    return NextResponse.json({
      ok: false,
      error: "Connection is missing shop ID. Please reconnect Etsy.",
    }, { status: 400 });
  }

  setEtsyConnectionContext(conn.id);

  const previousConfig = (conn.config && typeof conn.config === "object")
    ? (conn.config as Record<string, unknown>)
    : {};

  let etsyShippingProfileId: string | null = null;
  let defaultReadinessStateId: number | null = null;

  // Prefer a flat/manual profile. Calculated profiles need package weight and size.
  try {
    const profiles = await fetchEtsyShippingProfiles(accessToken, shopId);
    const picked = pickPreferredEtsyShippingProfile(profiles, conn.etsyShippingProfileId);
    etsyShippingProfileId =
      picked?.shipping_profile_id != null ? String(picked.shipping_profile_id) : null;
  } catch (e) {
    console.warn("[etsy] refresh-config: failed to fetch shipping profiles", { error: String(e) });
  }

  // Fetch processing profiles for readiness_state_id
  try {
    const profiles = await etsyGet<{
      count?: number;
      results?: { readiness_state_id: number; readiness_state?: string; processing_days_display_label?: string }[];
    }>(
      accessToken,
      `/shops/${shopId}/readiness-state-definitions`
    );
    
    console.log("[etsy] refresh-config: fetched processing profiles", {
      shopId,
      count: profiles.count ?? profiles.results?.length ?? 0,
      profiles: profiles.results?.map(p => ({
        id: p.readiness_state_id,
        state: p.readiness_state,
        label: p.processing_days_display_label,
      })),
    });

    defaultReadinessStateId = profiles.results?.[0]?.readiness_state_id ?? null;
  } catch (e) {
    console.error("[etsy] refresh-config: failed to fetch processing profiles", { error: String(e) });
    return NextResponse.json<RefreshResult>({
      ok: false,
      connectionId: conn.id,
      shopId,
      previousConfig,
      newConfig: previousConfig,
      error: `Failed to fetch processing profiles: ${String(e)}`,
    }, { status: 500 });
  }

  const newConfig = {
    ...previousConfig,
    etsyShippingProfileId,
    defaultReadinessStateId,
  };

  // Update the connection config
  await prisma.channelConnection.update({
    where: { id: conn.id },
    data: {
      config: newConfig,
      ...(etsyShippingProfileId ? { etsyShippingProfileId } : {}),
    },
  });

  console.log("[etsy] refresh-config: updated connection config", {
    connectionId: conn.id,
    shopId,
    previousDefaultReadinessStateId: previousConfig.defaultReadinessStateId,
    newDefaultReadinessStateId: defaultReadinessStateId,
  });

  return NextResponse.json<RefreshResult>({
    ok: true,
    connectionId: conn.id,
    shopId,
    previousConfig,
    newConfig,
  });
}

/**
 * GET /api/channels/etsy/refresh-config
 *
 * Returns the current config without refreshing. Useful for debugging.
 */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const conn = await prisma.channelConnection.findUnique({
    where: { memberId_provider: { memberId: userId, provider: "etsy" } },
    select: {
      id: true,
      externalShopId: true,
      externalShopName: true,
      status: true,
      config: true,
      etsyShippingProfileId: true,
    },
  });

  if (!conn) {
    return NextResponse.json({
      ok: false,
      error: "No Etsy connection found.",
    }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    connectionId: conn.id,
    shopId: conn.externalShopId,
    shopName: conn.externalShopName,
    status: conn.status,
    config: conn.config,
    etsyShippingProfileId: conn.etsyShippingProfileId,
    hasDefaultReadinessStateId: !!(conn.config as Record<string, unknown> | null)?.defaultReadinessStateId,
  });
}
