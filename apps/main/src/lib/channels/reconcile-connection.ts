import { reconcileConnectionInboundCatalog } from "./reconcile-inbound-catalog";
import { reconcileConnectionInboundListings } from "./reconcile-inbound";
import { reconcileConnectionSales } from "./reconcile";

type ConnectionRow = Parameters<typeof reconcileConnectionSales>[0];

/** Full Wix (and shared) reconciliation: sales, catalog mirror, new product import. */
export async function reconcileConnectionFull(connection: ConnectionRow): Promise<{
  salesApplied: number;
  imported: number;
  catalogUpdated: number;
  catalogRemoved: number;
}> {
  const sales = await reconcileConnectionSales(connection);
  const catalog = await reconcileConnectionInboundCatalog(connection);
  const inbound = await reconcileConnectionInboundListings(connection);
  return {
    salesApplied: sales.applied,
    imported: inbound.imported,
    catalogUpdated: catalog.updated,
    catalogRemoved: catalog.removed,
  };
}
