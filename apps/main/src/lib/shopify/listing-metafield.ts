import type { ShopifyFetch } from "./admin-graphql";
import { executeShopifyAdminGraphql } from "./admin-graphql";
import {
  SHOPIFY_LISTING_EXPORT_METAFIELD_KEY,
  SHOPIFY_LISTING_EXPORT_METAFIELD_NAMESPACE,
} from "./listing-export-id";

type MetafieldDefinitionNode = {
  id: string;
  namespace: string;
  key: string;
  type: { name: string };
};

export type EnsureListingExportMetafieldResult =
  | { ok: true; definitionId: string; created: boolean }
  | {
      ok: false;
      class: "RETRY" | "DEAD";
      errorClass: string;
      errorCode: string;
      errorMessage: string;
    };

/**
 * Idempotently ensure the app-owned product custom-ID metafield definition exists.
 * ID metafield types are unique by Shopify contract. Network calls only; no DB TX.
 */
export async function ensureShopifyListingExportMetafieldDefinition(input: {
  connectionId: string;
  fetchImpl?: ShopifyFetch;
  now?: Date;
}): Promise<EnsureListingExportMetafieldResult> {
  const queryResult = await executeShopifyAdminGraphql<{
    metafieldDefinitions: { nodes: MetafieldDefinitionNode[] };
  }>({
    connectionId: input.connectionId,
    operationType: "query",
    operationName: "ShopifyListingExportMetafieldLookup",
    document: `query ShopifyListingExportMetafieldLookup($ownerType: MetafieldOwnerType!, $namespace: String!, $key: String!) {
      metafieldDefinitions(first: 5, ownerType: $ownerType, namespace: $namespace, key: $key) {
        nodes { id namespace key type { name } }
      }
    }`,
    variables: {
      ownerType: "PRODUCT",
      namespace: SHOPIFY_LISTING_EXPORT_METAFIELD_NAMESPACE,
      key: SHOPIFY_LISTING_EXPORT_METAFIELD_KEY,
    },
    fetchImpl: input.fetchImpl,
    now: input.now,
  });

  if (!queryResult.ok) {
    if (
      queryResult.class === "THROTTLED" ||
      queryResult.class === "TRANSIENT_PROVIDER" ||
      queryResult.class === "NETWORK_UNKNOWN"
    ) {
      return {
        ok: false,
        class: "RETRY",
        errorClass: queryResult.class,
        errorCode: "METAFIELD_LOOKUP",
        errorMessage: queryResult.message,
      };
    }
    return {
      ok: false,
      class: "DEAD",
      errorClass: queryResult.class,
      errorCode: "METAFIELD_LOOKUP",
      errorMessage: queryResult.message,
    };
  }

  const existing = queryResult.data?.metafieldDefinitions.nodes?.[0] ?? null;
  if (existing) {
    if (existing.type.name !== "id") {
      return {
        ok: false,
        class: "DEAD",
        errorClass: "GRAPHQL_PERMANENT",
        errorCode: "METAFIELD_INCOMPATIBLE",
        errorMessage: "Listing export metafield exists with an incompatible type",
      };
    }
    return { ok: true, definitionId: existing.id, created: false };
  }

  const createResult = await executeShopifyAdminGraphql<{
    metafieldDefinitionCreate: {
      createdDefinition: MetafieldDefinitionNode | null;
      userErrors: Array<{ field?: string[] | null; message: string; code?: string | null }>;
    };
  }>({
    connectionId: input.connectionId,
    operationType: "mutation",
    operationName: "ShopifyListingExportMetafieldCreate",
    document: `mutation ShopifyListingExportMetafieldCreate($definition: MetafieldDefinitionInput!) {
      metafieldDefinitionCreate(definition: $definition) {
        createdDefinition { id namespace key type { name } }
        userErrors { field message code }
      }
    }`,
    variables: {
      definition: {
        name: "INW listing export ID",
        namespace: SHOPIFY_LISTING_EXPORT_METAFIELD_NAMESPACE,
        key: SHOPIFY_LISTING_EXPORT_METAFIELD_KEY,
        description: "Generation-scoped INW listing identity for Shopify productSet upserts",
        type: "id",
        ownerType: "PRODUCT",
      },
    },
    fetchImpl: input.fetchImpl,
    now: input.now,
  });

  if (!createResult.ok) {
    if (
      createResult.class === "THROTTLED" ||
      createResult.class === "TRANSIENT_PROVIDER" ||
      createResult.class === "NETWORK_UNKNOWN" ||
      createResult.outcomeUnknown
    ) {
      // Unknown create: re-query before creating again.
      const again = await executeShopifyAdminGraphql<{
        metafieldDefinitions: { nodes: MetafieldDefinitionNode[] };
      }>({
        connectionId: input.connectionId,
        operationType: "query",
        operationName: "ShopifyListingExportMetafieldLookup",
        document: `query ShopifyListingExportMetafieldLookup($ownerType: MetafieldOwnerType!, $namespace: String!, $key: String!) {
          metafieldDefinitions(first: 5, ownerType: $ownerType, namespace: $namespace, key: $key) {
            nodes { id namespace key type { name } }
          }
        }`,
        variables: {
          ownerType: "PRODUCT",
          namespace: SHOPIFY_LISTING_EXPORT_METAFIELD_NAMESPACE,
          key: SHOPIFY_LISTING_EXPORT_METAFIELD_KEY,
        },
        fetchImpl: input.fetchImpl,
        now: input.now,
      });
      const found = again.ok ? again.data?.metafieldDefinitions.nodes?.[0] : null;
      if (found?.type.name === "id") {
        return { ok: true, definitionId: found.id, created: false };
      }
      return {
        ok: false,
        class: "RETRY",
        errorClass: createResult.class,
        errorCode: "METAFIELD_CREATE_UNKNOWN",
        errorMessage: createResult.message,
      };
    }
    return {
      ok: false,
      class: "DEAD",
      errorClass: createResult.class,
      errorCode: "METAFIELD_CREATE",
      errorMessage: createResult.message,
    };
  }

  const userErrors = createResult.data?.metafieldDefinitionCreate.userErrors ?? [];
  if (userErrors.length > 0) {
    // Already-taken / race: re-query.
    const again = await executeShopifyAdminGraphql<{
      metafieldDefinitions: { nodes: MetafieldDefinitionNode[] };
    }>({
      connectionId: input.connectionId,
      operationType: "query",
      operationName: "ShopifyListingExportMetafieldLookup",
      document: `query ShopifyListingExportMetafieldLookup($ownerType: MetafieldOwnerType!, $namespace: String!, $key: String!) {
        metafieldDefinitions(first: 5, ownerType: $ownerType, namespace: $namespace, key: $key) {
          nodes { id namespace key type { name } }
        }
      }`,
      variables: {
        ownerType: "PRODUCT",
        namespace: SHOPIFY_LISTING_EXPORT_METAFIELD_NAMESPACE,
        key: SHOPIFY_LISTING_EXPORT_METAFIELD_KEY,
      },
      fetchImpl: input.fetchImpl,
      now: input.now,
    });
    const found = again.ok ? again.data?.metafieldDefinitions.nodes?.[0] : null;
    if (found?.type.name === "id") {
      return { ok: true, definitionId: found.id, created: false };
    }
    return {
      ok: false,
      class: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: userErrors[0]?.code ?? "METAFIELD_USER_ERROR",
      errorMessage: userErrors[0]?.message ?? "Metafield definition could not be created",
    };
  }

  const created = createResult.data?.metafieldDefinitionCreate.createdDefinition;
  if (!created || created.type.name !== "id") {
    return {
      ok: false,
      class: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "METAFIELD_MISSING",
      errorMessage: "Metafield definition create returned no id definition",
    };
  }
  return { ok: true, definitionId: created.id, created: true };
}
