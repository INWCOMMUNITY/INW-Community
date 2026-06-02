import { prisma } from "database";
import type { ChannelConnectionContext } from "../types";
import { WixApiError, wixGet } from "./client";

export type WixCatalogApi = "v1" | "v3";

export type WixCatalogVersionRaw =
  | "V1_CATALOG"
  | "V3_CATALOG"
  | "STORES_NOT_INSTALLED"
  | string;

type CatalogVersionResponse = {
  catalogVersion?: WixCatalogVersionRaw;
};

/** Official catalog version for the site (safe to call on v1 sites — not a catalog v3 product API). */
export async function fetchWixCatalogVersion(
  accessToken: string
): Promise<{ api: WixCatalogApi | null; raw: WixCatalogVersionRaw | null }> {
  try {
    const res = await wixGet<CatalogVersionResponse>(
      accessToken,
      "/stores/v3/provision/version"
    );
    const raw = res.catalogVersion ?? null;
    if (raw === "V1_CATALOG") return { api: "v1", raw };
    if (raw === "V3_CATALOG") return { api: "v3", raw };
    return { api: null, raw };
  } catch (e) {
    console.warn("[wix] fetch catalog version failed", { error: String(e) });
    return { api: null, raw: null };
  }
}

export function wixCatalogApiFromConn(conn: ChannelConnectionContext): WixCatalogApi | null {
  const raw = conn.config?.catalogApi;
  return raw === "v1" || raw === "v3" ? raw : null;
}

/** True when the site must not use /stores/v3/products or /stores/v3/inventory-items (428 otherwise). */
export function isWixCatalogV1(conn: ChannelConnectionContext): boolean {
  return wixCatalogApiFromConn(conn) === "v1";
}

export function isWixCatalogV3(conn: ChannelConnectionContext): boolean {
  return wixCatalogApiFromConn(conn) === "v3";
}

/** @deprecated use isWixCatalogV1 */
export function preferWixV1First(conn: ChannelConnectionContext): boolean {
  return isWixCatalogV1(conn);
}

export function catalogApiFromListStrategy(strategyName: string): WixCatalogApi | null {
  if (strategyName.startsWith("v1")) return "v1";
  if (strategyName.startsWith("v3")) return "v3";
  if (strategyName === "provision/version") return null;
  return null;
}

export function isWrongCatalogVersionError(e: unknown): boolean {
  if (!(e instanceof WixApiError)) return false;
  if (e.status === 428) return true;
  const msg = e.message.toLowerCase();
  return msg.includes("catalog") && (msg.includes("version") || msg.includes("catalog_v1"));
}

/** Remember which catalog API to use (from Wix provision API or successful list strategy). */
export async function persistWixCatalogApi(
  connectionId: string,
  catalogApi: WixCatalogApi,
  source: string,
  catalogVersionRaw?: WixCatalogVersionRaw | null
): Promise<void> {
  const conn = await prisma.channelConnection.findUnique({
    where: { id: connectionId },
    select: { config: true },
  });
  if (!conn) return;
  const prev = (conn.config && typeof conn.config === "object" ? conn.config : {}) as Record<
    string,
    unknown
  >;
  const nextRaw = catalogVersionRaw ?? (catalogApi === "v1" ? "V1_CATALOG" : "V3_CATALOG");
  if (prev.catalogApi === catalogApi && prev.catalogVersion === nextRaw) return;
  await prisma.channelConnection
    .update({
      where: { id: connectionId },
      data: {
        config: {
          ...prev,
          catalogApi,
          catalogVersion: nextRaw,
          catalogListStrategy: source,
        } as object,
      },
    })
    .catch((err) => console.error("[wix] persist catalogApi failed", { error: String(err) }));
}

/**
 * Resolve catalog version via GET /stores/v3/provision/version and persist on the connection.
 * Call before any Stores catalog read/write (except the provision endpoint itself).
 */
export async function ensureWixCatalogVersion(
  conn: ChannelConnectionContext
): Promise<WixCatalogApi | null> {
  const rawCached = conn.config?.catalogVersion;
  if (rawCached === "V1_CATALOG") return "v1";
  if (rawCached === "V3_CATALOG") return "v3";

  const { api, raw } = await fetchWixCatalogVersion(conn.accessToken);
  if (!api) return null;

  await persistWixCatalogApi(conn.id, api, "provision/version", raw);
  conn.config = {
    ...(conn.config && typeof conn.config === "object" ? conn.config : {}),
    catalogApi: api,
    catalogVersion: raw,
  };
  console.info("[wix] catalog version resolved", { connectionId: conn.id, catalogApi: api, raw });
  return api;
}

export type WixCatalogMode = "v1" | "v3" | "unknown";

/** Site id + catalog mode before Stores catalog read/write. */
export async function resolveWixCatalogMode(
  conn: ChannelConnectionContext
): Promise<WixCatalogMode> {
  const api = await ensureWixCatalogVersion(conn);
  if (api === "v1") return "v1";
  if (api === "v3") return "v3";
  return "unknown";
}

/**
 * If a v3 call failed with 428 wrong-catalog, refresh version from Wix and update the connection.
 * Returns the corrected api so the caller can retry once.
 */
export async function refreshCatalogVersionAfterMismatch(
  conn: ChannelConnectionContext,
  e: unknown
): Promise<WixCatalogApi | null> {
  if (!isWrongCatalogVersionError(e)) return null;
  const { api, raw } = await fetchWixCatalogVersion(conn.accessToken);
  if (!api) return null;
  await persistWixCatalogApi(conn.id, api, "provision/version-retry", raw);
  conn.config = {
    ...(conn.config && typeof conn.config === "object" ? conn.config : {}),
    catalogApi: api,
    catalogVersion: raw,
  };
  console.warn("[wix] catalog version corrected after 428", {
    connectionId: conn.id,
    catalogApi: api,
    raw,
  });
  return api;
}
