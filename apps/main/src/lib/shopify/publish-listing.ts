import type { ShopifyFetch } from "./admin-graphql";
import { executeShopifyAdminGraphql } from "./admin-graphql";
import { ensureShopifyListingProductActive } from "./activate-listing";

export type EnsureShopifyListingPublishedResult =
  | {
      ok: true;
      status: string;
      publicationId: string;
      activated: boolean;
      published: boolean;
      alreadyPublished: boolean;
    }
  | {
      ok: false;
      class: "RETRY" | "DEAD";
      errorClass: string;
      errorCode: string;
      errorMessage: string;
    };

function isOnlineStorePublication(row: {
  name?: string | null;
  catalog?: { __typename?: string; apps?: { nodes?: Array<{ handle?: string | null }> } } | null;
}): boolean {
  const name = String(row.name ?? "").trim().toLowerCase();
  if (name === "online store") return true;
  const apps = row.catalog?.apps?.nodes ?? [];
  return apps.some((app) => String(app.handle ?? "").toLowerCase() === "online_store");
}

/**
 * Resolve the shop's Online Store publication id.
 * Requires read_publications (satisfied by write_publications when granted).
 */
export async function resolveShopifyOnlineStorePublicationId(input: {
  connectionId: string;
  fetchImpl?: ShopifyFetch;
  now?: Date;
}): Promise<
  | { ok: true; publicationId: string }
  | {
      ok: false;
      class: "RETRY" | "DEAD";
      errorClass: string;
      errorCode: string;
      errorMessage: string;
    }
> {
  const result = await executeShopifyAdminGraphql<{
    publications: {
      nodes: Array<{
        id: string;
        name: string | null;
        catalog: {
          __typename?: string;
          apps?: { nodes?: Array<{ handle?: string | null }> };
        } | null;
      }>;
    } | null;
  }>({
    connectionId: input.connectionId,
    operationType: "query",
    operationName: "ShopifyOnlineStorePublicationLookup",
    document: `query ShopifyOnlineStorePublicationLookup {
      publications(first: 25) {
        nodes {
          id
          name
          catalog {
            __typename
            ... on AppCatalog {
              apps(first: 5) { nodes { handle } }
            }
          }
        }
      }
    }`,
    variables: {},
    fetchImpl: input.fetchImpl,
    now: input.now,
  });

  if (!result.ok) {
    if (result.class === "AUTH") {
      return {
        ok: false,
        class: "DEAD",
        errorClass: "AUTH",
        errorCode: "PUBLICATION_PERMISSION_MISSING",
        errorMessage:
          "Shopify did not grant publication permissions (read_publications / write_publications). Reconnect Shopify after those scopes are enabled, then retry Sync for this listing.",
      };
    }
    if (
      result.class === "THROTTLED" ||
      result.class === "TRANSIENT_PROVIDER" ||
      result.class === "NETWORK_UNKNOWN"
    ) {
      return {
        ok: false,
        class: "RETRY",
        errorClass: result.class,
        errorCode: "PUBLICATION_LOOKUP",
        errorMessage: result.message,
      };
    }
    return {
      ok: false,
      class: "DEAD",
      errorClass: result.class,
      errorCode: "PUBLICATION_LOOKUP",
      errorMessage: result.message,
    };
  }

  const nodes = result.data?.publications?.nodes ?? [];
  const match = nodes.find(isOnlineStorePublication);
  if (!match?.id) {
    return {
      ok: false,
      class: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "ONLINE_STORE_PUBLICATION_MISSING",
      errorMessage:
        "Could not find the Shopify Online Store sales channel for this shop. Enable Online Store, then retry Sync for this listing.",
    };
  }
  return { ok: true, publicationId: match.id };
}

async function readPublicationState(input: {
  connectionId: string;
  shopifyProductId: string;
  publicationId: string;
  fetchImpl?: ShopifyFetch;
  now?: Date;
}): Promise<
  | { ok: true; status: string; published: boolean }
  | {
      ok: false;
      class: "RETRY" | "DEAD";
      errorClass: string;
      errorCode: string;
      errorMessage: string;
    }
> {
  const result = await executeShopifyAdminGraphql<{
    product: {
      id: string;
      status: string;
      publishedOnPublication: boolean;
    } | null;
  }>({
    connectionId: input.connectionId,
    operationType: "query",
    operationName: "ShopifyListingPublicationState",
    document: `query ShopifyListingPublicationState($id: ID!, $publicationId: ID!) {
      product(id: $id) {
        id
        status
        publishedOnPublication(publicationId: $publicationId)
      }
    }`,
    variables: { id: input.shopifyProductId, publicationId: input.publicationId },
    fetchImpl: input.fetchImpl,
    now: input.now,
  });

  if (!result.ok) {
    if (result.class === "AUTH") {
      return {
        ok: false,
        class: "DEAD",
        errorClass: "AUTH",
        errorCode: "PUBLICATION_PERMISSION_MISSING",
        errorMessage:
          "Shopify did not grant publication permissions (read_publications / write_publications). Reconnect Shopify after those scopes are enabled, then retry Sync for this listing.",
      };
    }
    if (
      result.class === "THROTTLED" ||
      result.class === "TRANSIENT_PROVIDER" ||
      result.class === "NETWORK_UNKNOWN"
    ) {
      return {
        ok: false,
        class: "RETRY",
        errorClass: result.class,
        errorCode: "PUBLICATION_STATE_LOOKUP",
        errorMessage: result.message,
      };
    }
    return {
      ok: false,
      class: "DEAD",
      errorClass: result.class,
      errorCode: "PUBLICATION_STATE_LOOKUP",
      errorMessage: result.message,
    };
  }

  const product = result.data?.product ?? null;
  if (!product) {
    return {
      ok: false,
      class: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "PRODUCT_MISSING",
      errorMessage: "Shopify product was not found while checking Online Store publication",
    };
  }
  return {
    ok: true,
    status: String(product.status).toUpperCase(),
    published: Boolean(product.publishedOnPublication),
  };
}

/**
 * After inventory initialization: set product ACTIVE and publish to Online Store.
 * Idempotent when already ACTIVE and published. Does not change INW listing status.
 * Does not unpublish or re-publish during later content sync (call only from PUBLISH_LISTING).
 */
export async function ensureShopifyListingActiveAndPublishedToOnlineStore(input: {
  connectionId: string;
  shopifyProductId: string;
  fetchImpl?: ShopifyFetch;
  now?: Date;
}): Promise<EnsureShopifyListingPublishedResult> {
  const publication = await resolveShopifyOnlineStorePublicationId({
    connectionId: input.connectionId,
    fetchImpl: input.fetchImpl,
    now: input.now,
  });
  if (!publication.ok) return publication;

  const before = await readPublicationState({
    connectionId: input.connectionId,
    shopifyProductId: input.shopifyProductId,
    publicationId: publication.publicationId,
    fetchImpl: input.fetchImpl,
    now: input.now,
  });
  if (!before.ok) return before;

  let activated = false;
  if (before.status !== "ACTIVE") {
    const active = await ensureShopifyListingProductActive({
      connectionId: input.connectionId,
      shopifyProductId: input.shopifyProductId,
      fetchImpl: input.fetchImpl,
      now: input.now,
    });
    if (!active.ok) {
      return {
        ok: false,
        class: active.class,
        errorClass: active.errorClass,
        errorCode: active.errorCode,
        errorMessage: active.errorMessage,
      };
    }
    activated = active.updated;
  }

  if (before.published && before.status === "ACTIVE") {
    return {
      ok: true,
      status: "ACTIVE",
      publicationId: publication.publicationId,
      activated: false,
      published: false,
      alreadyPublished: true,
    };
  }

  // Re-check after activation — activation alone does not publish to Online Store.
  const mid = await readPublicationState({
    connectionId: input.connectionId,
    shopifyProductId: input.shopifyProductId,
    publicationId: publication.publicationId,
    fetchImpl: input.fetchImpl,
    now: input.now,
  });
  if (!mid.ok) return mid;
  if (mid.status === "ACTIVE" && mid.published) {
    return {
      ok: true,
      status: "ACTIVE",
      publicationId: publication.publicationId,
      activated,
      published: false,
      alreadyPublished: true,
    };
  }

  const publish = await executeShopifyAdminGraphql<{
    publishablePublish: {
      publishable: {
        publishedOnPublication: boolean;
      } | null;
      // UserError has field+message only (no code).
      userErrors: Array<{ field?: string[] | null; message: string }>;
    };
  }>({
    connectionId: input.connectionId,
    operationType: "mutation",
    operationName: "ShopifyListingPublishablePublish",
    document: `mutation ShopifyListingPublishablePublish($id: ID!, $publicationId: ID!, $input: [PublicationInput!]!) {
      publishablePublish(id: $id, input: $input) {
        publishable {
          publishedOnPublication(publicationId: $publicationId)
        }
        userErrors { field message }
      }
    }`,
    variables: {
      id: input.shopifyProductId,
      publicationId: publication.publicationId,
      input: [{ publicationId: publication.publicationId }],
    },
    fetchImpl: input.fetchImpl,
    now: input.now,
  });

  if (!publish.ok) {
    if (publish.class === "AUTH") {
      return {
        ok: false,
        class: "DEAD",
        errorClass: "AUTH",
        errorCode: "PUBLICATION_PERMISSION_MISSING",
        errorMessage:
          "Shopify did not grant publication permissions (write_publications). Reconnect Shopify after write_publications is enabled, then retry Sync for this listing. The product was not left marked as successfully published.",
      };
    }
    if (
      publish.class === "THROTTLED" ||
      publish.class === "TRANSIENT_PROVIDER" ||
      publish.class === "NETWORK_UNKNOWN" ||
      publish.outcomeUnknown
    ) {
      return {
        ok: false,
        class: "RETRY",
        errorClass: publish.class,
        errorCode: publish.outcomeUnknown ? "PUBLISH_UNKNOWN" : "PUBLISH_UPDATE",
        errorMessage: publish.message,
      };
    }
    return {
      ok: false,
      class: "DEAD",
      errorClass: publish.class,
      errorCode: "PUBLISH_UPDATE",
      errorMessage: publish.message,
    };
  }

  const userErrors = publish.data?.publishablePublish?.userErrors ?? [];
  if (userErrors.length > 0) {
    const message = userErrors.map((e) => e.message).join("; ");
    const permissionLike = /permission|scope|access|publication|not authorized|forbidden/i.test(
      message
    );
    return {
      ok: false,
      class: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: permissionLike ? "PUBLICATION_PERMISSION_MISSING" : "PUBLISH_USER_ERROR",
      errorMessage: permissionLike
        ? `Shopify blocked Online Store publication: ${message}. Enable write_publications and Online Store access, reconnect if needed, then retry Sync for this listing.`
        : message.slice(0, 500),
    };
  }

  const after = await readPublicationState({
    connectionId: input.connectionId,
    shopifyProductId: input.shopifyProductId,
    publicationId: publication.publicationId,
    fetchImpl: input.fetchImpl,
    now: input.now,
  });
  if (!after.ok) return after;
  if (after.status !== "ACTIVE" || !after.published) {
    return {
      ok: false,
      class: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "PUBLISH_NOT_CONFIRMED",
      errorMessage:
        "Shopify did not confirm Online Store publication after publishablePublish. The listing was not reported as successfully published.",
    };
  }

  return {
    ok: true,
    status: "ACTIVE",
    publicationId: publication.publicationId,
    activated,
    published: true,
    alreadyPublished: false,
  };
}

export type ShopifyListingPublicationMutationResult =
  | { ok: true }
  | {
      ok: false;
      class: "RETRY" | "DEAD";
      errorClass: string;
      errorCode: string;
      errorMessage: string;
    };

/**
 * Remove a product from the Online Store sales channel. Does not delete the product.
 */
export async function unpublishShopifyListingFromOnlineStore(input: {
  connectionId: string;
  shopifyProductId: string;
  fetchImpl?: ShopifyFetch;
  now?: Date;
}): Promise<ShopifyListingPublicationMutationResult> {
  const publication = await resolveShopifyOnlineStorePublicationId({
    connectionId: input.connectionId,
    fetchImpl: input.fetchImpl,
    now: input.now,
  });
  if (!publication.ok) return publication;

  const unpublish = await executeShopifyAdminGraphql<{
    publishableUnpublish: {
      publishable: { publishedOnPublication: boolean } | null;
      userErrors: Array<{ field?: string[] | null; message: string }>;
    };
  }>({
    connectionId: input.connectionId,
    operationType: "mutation",
    operationName: "ShopifyListingPublishableUnpublish",
    document: `mutation ShopifyListingPublishableUnpublish($id: ID!, $publicationId: ID!, $input: [PublicationInput!]!) {
      publishableUnpublish(id: $id, input: $input) {
        publishable {
          publishedOnPublication(publicationId: $publicationId)
        }
        userErrors { field message }
      }
    }`,
    variables: {
      id: input.shopifyProductId,
      publicationId: publication.publicationId,
      input: [{ publicationId: publication.publicationId }],
    },
    fetchImpl: input.fetchImpl,
    now: input.now,
  });

  if (!unpublish.ok) {
    if (
      unpublish.class === "THROTTLED" ||
      unpublish.class === "TRANSIENT_PROVIDER" ||
      unpublish.class === "NETWORK_UNKNOWN" ||
      unpublish.outcomeUnknown
    ) {
      return {
        ok: false,
        class: "RETRY",
        errorClass: unpublish.class,
        errorCode: "UNPUBLISH_UPDATE",
        errorMessage: unpublish.message,
      };
    }
    return {
      ok: false,
      class: "DEAD",
      errorClass: unpublish.class,
      errorCode: "UNPUBLISH_UPDATE",
      errorMessage: unpublish.message,
    };
  }

  const userErrors = unpublish.data?.publishableUnpublish?.userErrors ?? [];
  if (userErrors.length > 0) {
    const message = userErrors.map((e) => e.message).join("; ");
    return {
      ok: false,
      class: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "UNPUBLISH_USER_ERROR",
      errorMessage: message.slice(0, 500),
    };
  }

  return { ok: true };
}

export async function deleteShopifyProduct(input: {
  connectionId: string;
  shopifyProductId: string;
  fetchImpl?: ShopifyFetch;
  now?: Date;
}): Promise<ShopifyListingPublicationMutationResult> {
  const result = await executeShopifyAdminGraphql<{
    productDelete: {
      deletedProductId: string | null;
      userErrors: Array<{ field?: string[] | null; message: string }>;
    };
  }>({
    connectionId: input.connectionId,
    operationType: "mutation",
    operationName: "ShopifyListingProductDelete",
    document: `mutation ShopifyListingProductDelete($input: ProductDeleteInput!) {
      productDelete(input: $input) {
        deletedProductId
        userErrors { field message }
      }
    }`,
    variables: { input: { id: input.shopifyProductId } },
    fetchImpl: input.fetchImpl,
    now: input.now,
  });

  if (!result.ok) {
    if (
      result.class === "THROTTLED" ||
      result.class === "TRANSIENT_PROVIDER" ||
      result.class === "NETWORK_UNKNOWN" ||
      result.outcomeUnknown
    ) {
      return {
        ok: false,
        class: "RETRY",
        errorClass: result.class,
        errorCode: "PRODUCT_DELETE",
        errorMessage: result.message,
      };
    }
    return {
      ok: false,
      class: "DEAD",
      errorClass: result.class,
      errorCode: "PRODUCT_DELETE",
      errorMessage: result.message,
    };
  }

  const userErrors = result.data?.productDelete?.userErrors ?? [];
  if (userErrors.length > 0) {
    const message = userErrors.map((e) => e.message).join("; ");
    return {
      ok: false,
      class: "DEAD",
      errorClass: "GRAPHQL_PERMANENT",
      errorCode: "PRODUCT_DELETE_USER_ERROR",
      errorMessage: message.slice(0, 500),
    };
  }

  return { ok: true };
}
