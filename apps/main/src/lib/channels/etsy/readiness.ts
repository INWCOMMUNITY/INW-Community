import { prisma } from "database";
import type { ChannelConnectionContext } from "../types";
import { etsyGet, setEtsyConnectionContext } from "./client";

export const ETSY_MISSING_PROCESSING_PROFILE =
  "Etsy requires a processing profile (how long you take to ship) before listing. Add one in your Etsy Shop Manager, then refresh Etsy in Sync Stores.";

export function cachedEtsyReadinessStateId(
  config: Record<string, unknown> | null | undefined
): number | null {
  const n = config?.defaultReadinessStateId;
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : null;
}

/** Etsy requires readiness_state_id on physical listing create (since 2025). */
export async function resolveEtsyReadinessStateId(
  conn: ChannelConnectionContext,
  shopId: string
): Promise<number> {
  const cached = cachedEtsyReadinessStateId(conn.config);
  if (cached != null) return cached;

  setEtsyConnectionContext(conn.id);
  let id: number | null = null;
  try {
    const profiles = await etsyGet<{ results?: { readiness_state_id: number }[] }>(
      conn.accessToken,
      `/shops/${shopId}/readiness-state-definitions`
    );
    id = profiles.results?.[0]?.readiness_state_id ?? null;
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Could not load processing profiles.";
    throw new Error(`${ETSY_MISSING_PROCESSING_PROFILE} (${detail})`);
  }
  if (id == null) throw new Error(ETSY_MISSING_PROCESSING_PROFILE);

  const nextConfig = { ...(conn.config ?? {}), defaultReadinessStateId: id };
  await prisma.channelConnection
    .update({
      where: { id: conn.id },
      data: { config: nextConfig },
    })
    .catch(() => {});
  conn.config = nextConfig;
  return id;
}
