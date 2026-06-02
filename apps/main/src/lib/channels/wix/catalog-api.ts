import { prisma } from "database";
import type { ChannelConnectionContext } from "../types";

export type WixCatalogApi = "v1" | "v3";

/** Classic Editor sites should use Stores v1/v2 for writes; headless uses v3. */
export function wixCatalogApiFromConn(conn: ChannelConnectionContext): WixCatalogApi | null {
  const raw = conn.config?.catalogApi;
  return raw === "v1" || raw === "v3" ? raw : null;
}

export function preferWixV1First(conn: ChannelConnectionContext): boolean {
  return wixCatalogApiFromConn(conn) === "v1";
}

export function catalogApiFromListStrategy(strategyName: string): WixCatalogApi | null {
  if (strategyName.startsWith("v1")) return "v1";
  if (strategyName.startsWith("v3")) return "v3";
  return null;
}

/** Remember which list API worked so outbound writes use the same catalog version. */
export async function persistWixCatalogApi(
  connectionId: string,
  catalogApi: WixCatalogApi,
  listStrategy: string
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
  if (prev.catalogApi === catalogApi && prev.catalogListStrategy === listStrategy) return;
  await prisma.channelConnection
    .update({
      where: { id: connectionId },
      data: {
        config: {
          ...prev,
          catalogApi,
          catalogListStrategy: listStrategy,
        } as object,
      },
    })
    .catch((e) => console.error("[wix] persist catalogApi failed", { error: String(e) }));
}
