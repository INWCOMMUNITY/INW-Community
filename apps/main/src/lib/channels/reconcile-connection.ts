import { reconcileConnectionInboundCatalog } from "./reconcile-inbound-catalog";
import { reconcileConnectionInboundMeta } from "./reconcile-inbound-meta";
import { reconcileConnectionInboundListings } from "./reconcile-inbound";
import { reconcileConnectionSales } from "./reconcile";

type ConnectionRow = Parameters<typeof reconcileConnectionSales>[0];

/** Full reconciliation: sales, catalog mirror, meta sync, new product import. */
export async function reconcileConnectionFull(connection: ConnectionRow): Promise<{
  salesApplied: number;
  imported: number;
  catalogUpdated: number;
  catalogRemoved: number;
  metaUpdated: number;
}> {
  const sales = await reconcileConnectionSales(connection);
  const catalog = await reconcileConnectionInboundCatalog(connection);
  const meta = await reconcileConnectionInboundMeta(connection);
  const inbound = await reconcileConnectionInboundListings(connection);
  return {
    salesApplied: sales.applied,
    imported: inbound.imported,
    catalogUpdated: catalog.updated,
    catalogRemoved: catalog.removed,
    metaUpdated: meta.updated,
  };
}
