import type { ShopifyFetch } from "./admin-graphql";
import { executeShopifyAdminGraphql } from "./admin-graphql";
import { shopifyAdminProductUrl, shopifyStorefrontProductUrl } from "./apps-airport";

/**
 * Resolve seller-facing View URLs: prefer Online Store / storefront when Live.
 */
export async function resolveShopifyListingViewUrls(input: {
  connectionId: string;
  shopDomain: string | null | undefined;
  shopifyProductId: string;
  preferStorefront: boolean;
  fetchImpl?: ShopifyFetch;
  now?: Date;
}): Promise<{ storefrontUrl: string | null; adminUrl: string | null; primaryUrl: string | null }> {
  const adminUrl = shopifyAdminProductUrl(input.shopDomain, input.shopifyProductId);
  let storefrontUrl: string | null = null;

  if (input.preferStorefront) {
    const result = await executeShopifyAdminGraphql<{
      product: {
        handle: string | null;
        onlineStoreUrl: string | null;
      } | null;
    }>({
      connectionId: input.connectionId,
      operationType: "query",
      operationName: "ShopifyListingStorefrontUrl",
      document: `query ShopifyListingStorefrontUrl($id: ID!) {
        product(id: $id) {
          handle
          onlineStoreUrl
        }
      }`,
      variables: { id: input.shopifyProductId },
      fetchImpl: input.fetchImpl,
      now: input.now,
    });
    if (result.ok && result.data?.product) {
      const online = result.data.product.onlineStoreUrl?.trim() || null;
      if (online && /^https:\/\//i.test(online)) {
        storefrontUrl = online;
      } else {
        storefrontUrl = shopifyStorefrontProductUrl(
          input.shopDomain,
          result.data.product.handle
        );
      }
    }
  }

  return {
    storefrontUrl,
    adminUrl,
    primaryUrl: storefrontUrl ?? adminUrl,
  };
}
