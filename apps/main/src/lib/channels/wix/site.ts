import { prisma } from "database";
import type { ChannelConnectionContext } from "../types";
import { wixGet } from "./client";

type AppInstanceResponse = {
  site?: { siteId?: string; siteDisplayName?: string };
  instance?: { instanceId?: string };
};

/** Site GUID from the installed app instance (requires Manage Your App permission). */
export async function fetchWixSiteId(accessToken: string): Promise<string | null> {
  try {
    const res = await wixGet<AppInstanceResponse>(accessToken, "/apps/v1/instance");
    const id = res.site?.siteId?.trim();
    return id || null;
  } catch (e) {
    console.warn("[wix] fetch site id failed", { error: String(e) });
    return null;
  }
}

/** Never send instanceId as wix-site-id — only the real site GUID (tenantId). */
export function wixSiteIdFromConn(conn: ChannelConnectionContext): string | null {
  const fromConfig = conn.config?.siteId;
  if (typeof fromConfig === "string" && fromConfig.trim()) return fromConfig.trim();
  const instanceId =
    typeof conn.config?.instanceId === "string" ? conn.config.instanceId.trim() : "";
  const shop = conn.externalShopId?.trim();
  if (!shop) return null;
  if (instanceId && shop === instanceId) return null;
  return shop;
}

/**
 * Resolve and persist `config.siteId` when missing (common when install redirect omits tenantId).
 */
export async function ensureWixSiteId(conn: ChannelConnectionContext): Promise<string | null> {
  const existing = wixSiteIdFromConn(conn);
  if (existing) return existing;

  const siteId = await fetchWixSiteId(conn.accessToken);
  if (!siteId) return null;

  const nextConfig = {
    ...(conn.config && typeof conn.config === "object" ? conn.config : {}),
    siteId,
  };
  await prisma.channelConnection
    .update({
      where: { id: conn.id },
      data: { config: nextConfig as object },
    })
    .catch((e) => console.error("[wix] persist siteId failed", { error: String(e) }));

  conn.config = nextConfig;
  return siteId;
}

/** Resolve a Wix connection row from the install instance id (webhooks, JWT payload). */
export async function findWixConnectionByInstanceId(instanceId: string) {
  const conns = await prisma.channelConnection.findMany({
    where: { provider: "wix", status: { not: "disconnected" } },
  });
  const needle = instanceId.trim();
  return (
    conns.find((c) => {
      const cfg = c.config as { instanceId?: string } | null;
      return cfg?.instanceId === needle;
    }) ?? null
  );
}
