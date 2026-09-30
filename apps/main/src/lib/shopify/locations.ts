import { SHOPIFY_LOCATION_GID_PATTERN } from "./constants";

export type ShopifyLocationNode = {
  id: string;
  name: string;
  isActive: boolean;
  fulfillsOnlineOrders: boolean;
  fulfillmentService: { id: string } | null;
};

/**
 * Locations whose inventory can represent online sales.
 * Inactive, legacy fulfillment-service, and non-online locations are excluded.
 * Quantities are never summed across locations.
 */
export function selectInventoryLocations(nodes: ShopifyLocationNode[]): ShopifyLocationNode[] {
  return nodes.filter((node) => {
    if (!SHOPIFY_LOCATION_GID_PATTERN.test(node.id)) return false;
    if (!node.isActive) return false;
    if (!node.fulfillsOnlineOrders) return false;
    if (node.fulfillmentService) return false;
    return true;
  });
}
