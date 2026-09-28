import { SHOPIFY_ADMIN_API_VERSION, SHOPIFY_SHOP_GID_PATTERN } from "./constants";
import type { ShopifyLocationNode } from "./locations";
import { redactShopifySecrets } from "./redact";
import { normalizeShopifyShopDomain } from "./shop-domain";

export type ShopifyFetch = typeof fetch;

export type ShopifyTokenSet = {
  accessToken: string;
  refreshToken: string;
  scope: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
};

export class ShopifyRequestError extends Error {
  constructor(message: string) {
    super(redactShopifySecrets(message));
    this.name = "ShopifyRequestError";
  }
}

export class ShopifyDomainAssociationError extends Error {
  constructor(
    readonly associationReason: "REQUESTED_SHOP_NOT_ASSOCIATED" | "SHOP_DOMAIN_ASSOCIATION_UNVERIFIED"
  ) {
    super(associationReason);
    this.name = "ShopifyDomainAssociationError";
  }
}

function expiresAtFromSeconds(seconds: unknown, now: Date): Date | null {
  const value = typeof seconds === "number" ? seconds : Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Date(now.getTime() + value * 1000);
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ShopifyRequestError(`Shopify returned a non-JSON response (${response.status})`);
  }
}

export async function exchangeShopifyAuthorizationCode(input: {
  shopDomain: string;
  code: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: ShopifyFetch;
  now?: Date;
}): Promise<ShopifyTokenSet> {
  const shopDomain = normalizeShopifyShopDomain(input.shopDomain);
  if (!shopDomain) throw new ShopifyRequestError("Invalid shop domain");
  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? new Date();
  let response: Response;
  try {
    response = await fetchImpl(`https://${shopDomain}/admin/oauth/access_token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        client_id: input.clientId,
        client_secret: input.clientSecret,
        code: input.code,
        expiring: "1",
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new ShopifyRequestError(
      error instanceof Error ? `Shopify token exchange unreachable: ${error.name}` : "Shopify token exchange unreachable"
    );
  }
  if (!response.ok) {
    throw new ShopifyRequestError(`Shopify token exchange failed (${response.status})`);
  }
  const body = (await readJson(response)) as {
    access_token?: unknown;
    refresh_token?: unknown;
    scope?: unknown;
    expires_in?: unknown;
    refresh_token_expires_in?: unknown;
  } | null;
  const accessToken = typeof body?.access_token === "string" ? body.access_token : "";
  const refreshToken = typeof body?.refresh_token === "string" ? body.refresh_token : "";
  const scope = typeof body?.scope === "string" ? body.scope : "";
  const accessTokenExpiresAt = expiresAtFromSeconds(body?.expires_in, now);
  const refreshTokenExpiresAt = expiresAtFromSeconds(body?.refresh_token_expires_in, now);
  if (!accessToken || !refreshToken || !scope || !accessTokenExpiresAt || !refreshTokenExpiresAt) {
    throw new ShopifyRequestError("Shopify token response was missing expiring offline token fields");
  }
  return { accessToken, refreshToken, scope, accessTokenExpiresAt, refreshTokenExpiresAt };
}

export type ShopifyRefreshResult =
  | { status: "refreshed"; tokens: ShopifyTokenSet }
  | { status: "reauthorize" }
  | { status: "retry" }
  | { status: "failed" };

export async function refreshShopifyOfflineToken(input: {
  shopDomain: string;
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: ShopifyFetch;
  now?: Date;
}): Promise<ShopifyRefreshResult> {
  const shopDomain = normalizeShopifyShopDomain(input.shopDomain);
  if (!shopDomain || !input.refreshToken) return { status: "reauthorize" };
  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? new Date();
  let response: Response;
  try {
    response = await fetchImpl(`https://${shopDomain}/admin/oauth/access_token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        client_id: input.clientId,
        client_secret: input.clientSecret,
        grant_type: "refresh_token",
        refresh_token: input.refreshToken,
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return { status: "retry" };
  }
  if (response.status === 401) return { status: "reauthorize" };
  if (response.status === 429 || response.status >= 500) return { status: "retry" };
  if (!response.ok) return { status: "failed" };
  const body = (await readJson(response)) as {
    access_token?: unknown;
    refresh_token?: unknown;
    scope?: unknown;
    expires_in?: unknown;
    refresh_token_expires_in?: unknown;
  } | null;
  const accessToken = typeof body?.access_token === "string" ? body.access_token : "";
  const refreshToken = typeof body?.refresh_token === "string" ? body.refresh_token : "";
  const scope = typeof body?.scope === "string" ? body.scope : "";
  const accessTokenExpiresAt = expiresAtFromSeconds(body?.expires_in, now);
  const refreshTokenExpiresAt = expiresAtFromSeconds(body?.refresh_token_expires_in, now);
  if (!accessToken || !refreshToken || !accessTokenExpiresAt || !refreshTokenExpiresAt) {
    return { status: "failed" };
  }
  return {
    status: "refreshed",
    tokens: {
      accessToken,
      refreshToken,
      scope,
      accessTokenExpiresAt,
      refreshTokenExpiresAt,
    },
  };
}

const SHOP_IDENTITY_QUERY = `query ShopifyShopIdentity {
  shop {
    id
    myshopifyDomain
    name
    primaryDomain { host url }
  }
}`;

/** Optional: may require scopes not granted; never fail closed solely on this. */
const SHOP_DOMAINS_QUERY = `query ShopifyShopDomains {
  shop {
    domains { host url }
  }
}`;

const LOCATIONS_QUERY = `query ShopifyInventoryLocations($cursor: String) {
  locations(first: 50, after: $cursor) {
    nodes { id name isActive fulfillsOnlineOrders fulfillmentService { id } }
    pageInfo { hasNextPage endCursor }
  }
}`;

const WEBHOOK_MUTATION = `mutation ShopifyAppUninstalledWebhook($uri: String!) {
  webhookSubscriptionCreate(
    topic: APP_UNINSTALLED
    webhookSubscription: { uri: $uri, format: JSON }
  ) {
    userErrors { field message }
    webhookSubscription { id }
  }
}`;

const PRODUCTS_UPDATE_QUERY = `query ShopifyProductsUpdateWebhookSubscriptions {
  webhookSubscriptions(first: 50, topics: [PRODUCTS_UPDATE]) {
    nodes {
      id
      topic
      uri
      endpoint {
        __typename
        ... on WebhookHttpEndpoint { callbackUrl }
      }
    }
  }
}`;

const PRODUCTS_UPDATE_MUTATION = `mutation ShopifyProductsUpdateWebhook($uri: String!) {
  webhookSubscriptionCreate(
    topic: PRODUCTS_UPDATE
    webhookSubscription: { uri: $uri, format: JSON }
  ) {
    userErrors { field message }
    webhookSubscription { id topic uri }
  }
}`;
async function graphql<T>(input: {
  shopDomain: string;
  accessToken: string;
  query: string;
  variables?: Record<string, unknown>;
  fetchImpl?: ShopifyFetch;
}): Promise<T> {
  const shopDomain = normalizeShopifyShopDomain(input.shopDomain);
  if (!shopDomain) throw new ShopifyRequestError("Invalid shop domain");
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`https://${shopDomain}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Shopify-Access-Token": input.accessToken,
      },
      body: JSON.stringify({ query: input.query, variables: input.variables ?? {} }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new ShopifyRequestError(
      error instanceof Error ? `Shopify GraphQL unreachable: ${error.name}` : "Shopify GraphQL unreachable"
    );
  }
  if (!response.ok) {
    throw new ShopifyRequestError(`Shopify GraphQL failed (${response.status})`);
  }
  const body = (await readJson(response)) as { data?: T; errors?: unknown } | null;
  if (!body?.data || body.errors) {
    throw new ShopifyRequestError("Shopify GraphQL returned errors");
  }
  return body.data;
}

export async function fetchShopifyShopIdentity(input: {
  /** Callback / API host — must equal Admin API `shop.myshopifyDomain` after canonicalize. */
  shopDomain: string;
  accessToken: string;
  /** Seller-entered onboarding hint; required for renamed-domain association proof. */
  requestedShopDomain?: string | null;
  fetchImpl?: ShopifyFetch;
}): Promise<{
  shopId: string;
  shopDomain: string;
  /** Always true when returned; renamed case throws if association cannot be proven. */
  requestedDomainAssociated: true;
}> {
  const apiHost = normalizeShopifyShopDomain(input.shopDomain);
  if (!apiHost) throw new ShopifyRequestError("Invalid shop domain");

  const data = await graphql<{
    shop: {
      id?: string;
      myshopifyDomain?: string;
      name?: string;
      primaryDomain?: { host?: string; url?: string } | null;
    } | null;
  }>({
    shopDomain: apiHost,
    accessToken: input.accessToken,
    query: SHOP_IDENTITY_QUERY,
    fetchImpl: input.fetchImpl,
  });
  const shopId = data.shop?.id ?? "";
  const shopDomain = data.shop?.myshopifyDomain
    ? normalizeShopifyShopDomain(data.shop.myshopifyDomain)
    : null;
  if (!SHOPIFY_SHOP_GID_PATTERN.test(shopId) || !shopDomain) {
    throw new ShopifyRequestError("Shopify shop identity was incomplete");
  }
  // Fail closed: authenticated permanent domain must match the OAuth callback shop.
  if (shopDomain !== apiHost) {
    throw new ShopifyRequestError("Shopify shop identity did not match the authorized shop");
  }

  const requested = input.requestedShopDomain
    ? normalizeShopifyShopDomain(input.requestedShopDomain)
    : null;

  // Same-domain case: no domains-list requirement.
  if (!requested || requested === shopDomain) {
    return { shopId, shopDomain, requestedDomainAssociated: true };
  }

  // Renamed-domain case: must prove requested host appears on shop.domains.
  let domainsData: {
    shop: { domains?: Array<{ host?: string; url?: string } | null> | null } | null;
  };
  try {
    domainsData = await graphql({
      shopDomain: apiHost,
      accessToken: input.accessToken,
      query: SHOP_DOMAINS_QUERY,
      fetchImpl: input.fetchImpl,
    });
  } catch {
    throw new ShopifyDomainAssociationError("SHOP_DOMAIN_ASSOCIATION_UNVERIFIED");
  }

  const hosts = (domainsData.shop?.domains ?? [])
    .map((d) => d?.host)
    .filter((h): h is string => typeof h === "string" && h.length > 0);
  if (hosts.length === 0) {
    throw new ShopifyDomainAssociationError("SHOP_DOMAIN_ASSOCIATION_UNVERIFIED");
  }

  const associated = hosts.some((host) => {
    const asMyshopify = normalizeShopifyShopDomain(host);
    if (asMyshopify) return asMyshopify === requested;
    return host.trim().toLowerCase() === requested;
  });
  if (!associated) {
    throw new ShopifyDomainAssociationError("REQUESTED_SHOP_NOT_ASSOCIATED");
  }

  return { shopId, shopDomain, requestedDomainAssociated: true };
}

export async function fetchShopifyLocations(input: {
  shopDomain: string;
  accessToken: string;
  fetchImpl?: ShopifyFetch;
}): Promise<ShopifyLocationNode[]> {
  const nodes: ShopifyLocationNode[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 10; page += 1) {
    const data: {
      locations: {
        nodes: ShopifyLocationNode[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    } = await graphql({
      shopDomain: input.shopDomain,
      accessToken: input.accessToken,
      query: LOCATIONS_QUERY,
      variables: { cursor },
      fetchImpl: input.fetchImpl,
    });
    nodes.push(...(data.locations?.nodes ?? []));
    if (!data.locations?.pageInfo?.hasNextPage) break;
    cursor = data.locations.pageInfo.endCursor;
    if (!cursor) break;
  }
  return nodes;
}

export async function registerShopifyUninstallWebhook(input: {
  shopDomain: string;
  accessToken: string;
  callbackUrl: string;
  fetchImpl?: ShopifyFetch;
}): Promise<void> {
  const data = await graphql<{
    webhookSubscriptionCreate: {
      userErrors: { message: string }[];
      webhookSubscription: { id: string } | null;
    };
  }>({
    shopDomain: input.shopDomain,
    accessToken: input.accessToken,
    query: WEBHOOK_MUTATION,
    variables: { uri: input.callbackUrl },
    fetchImpl: input.fetchImpl,
  });
  const errors = data.webhookSubscriptionCreate?.userErrors ?? [];
  const already =
    errors.length > 0 &&
    errors.every((error) => /already been taken|already exists/i.test(error.message));
  if (errors.length > 0 && !already) {
    throw new ShopifyRequestError("Shopify uninstall webhook registration failed");
  }
  if (!already && !data.webhookSubscriptionCreate?.webhookSubscription?.id) {
    throw new ShopifyRequestError("Shopify uninstall webhook registration failed");
  }
}

type WebhookSubscriptionNode = {
  id: string;
  topic: string;
  uri?: string | null;
  endpoint?: { __typename?: string; callbackUrl?: string | null } | null;
};

function normalizeWebhookUri(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/** Admin API 2026-07 canonical destination is `uri`; keep endpoint.callbackUrl as legacy fallback. */
function webhookNodeDestination(node: WebhookSubscriptionNode): string {
  if (node.uri) return normalizeWebhookUri(node.uri);
  if (node.endpoint?.callbackUrl) return normalizeWebhookUri(node.endpoint.callbackUrl);
  return "";
}

function classifyWebhookDestinations(
  nodes: WebhookSubscriptionNode[],
  wanted: string
): { match: WebhookSubscriptionNode | null; stale: WebhookSubscriptionNode[] } {
  let match: WebhookSubscriptionNode | null = null;
  const stale: WebhookSubscriptionNode[] = [];
  for (const node of nodes) {
    const destination = webhookNodeDestination(node);
    if (!destination) continue;
    if (destination === wanted) match = node;
    else stale.push(node);
  }
  return { match, stale };
}

const WEBHOOK_UPDATE_MUTATION = `mutation ShopifyWebhookSubscriptionUpdate($id: ID!, $uri: String!) {
  webhookSubscriptionUpdate(
    id: $id
    webhookSubscription: { uri: $uri, format: JSON }
  ) {
    userErrors { field message }
    webhookSubscription { id topic uri }
  }
}`;

async function updateShopifyWebhookSubscriptionUri(input: {
  shopDomain: string;
  accessToken: string;
  subscriptionId: string;
  uri: string;
  topicLabel: "PRODUCTS_UPDATE" | "ORDERS_PAID";
  fetchImpl?: ShopifyFetch;
}): Promise<void> {
  const data = await graphql<{
    webhookSubscriptionUpdate: {
      userErrors: { message: string }[];
      webhookSubscription: { id: string } | null;
    };
  }>({
    shopDomain: input.shopDomain,
    accessToken: input.accessToken,
    query: WEBHOOK_UPDATE_MUTATION,
    variables: { id: input.subscriptionId, uri: input.uri },
    fetchImpl: input.fetchImpl,
  });
  const errors = data.webhookSubscriptionUpdate?.userErrors ?? [];
  if (errors.length > 0 || !data.webhookSubscriptionUpdate?.webhookSubscription?.id) {
    throw new ShopifyRequestError(`Shopify ${input.topicLabel} webhook registration failed`);
  }
}

async function listProductsUpdateWebhookSubscriptions(input: {
  shopDomain: string;
  accessToken: string;
  fetchImpl?: ShopifyFetch;
}): Promise<WebhookSubscriptionNode[]> {
  const data = await graphql<{
    webhookSubscriptions: { nodes: WebhookSubscriptionNode[] };
  }>({
    shopDomain: input.shopDomain,
    accessToken: input.accessToken,
    query: PRODUCTS_UPDATE_QUERY,
    fetchImpl: input.fetchImpl,
  });
  return data.webhookSubscriptions?.nodes ?? [];
}

async function retargetStaleWebhookSubscriptions(input: {
  shopDomain: string;
  accessToken: string;
  callbackUrl: string;
  topicLabel: "PRODUCTS_UPDATE" | "ORDERS_PAID";
  stale: WebhookSubscriptionNode[];
  list: () => Promise<WebhookSubscriptionNode[]>;
  fetchImpl?: ShopifyFetch;
}): Promise<{ status: "UPDATED"; subscriptionId: string }> {
  for (const node of input.stale) {
    await updateShopifyWebhookSubscriptionUri({
      shopDomain: input.shopDomain,
      accessToken: input.accessToken,
      subscriptionId: node.id,
      uri: input.callbackUrl,
      topicLabel: input.topicLabel,
      fetchImpl: input.fetchImpl,
    });
  }
  const wanted = normalizeWebhookUri(input.callbackUrl);
  const after = classifyWebhookDestinations(await input.list(), wanted);
  if (!after.match || after.stale.length > 0) {
    throw new ShopifyRequestError(`Shopify ${input.topicLabel} webhook registration failed`);
  }
  return { status: "UPDATED", subscriptionId: after.match.id };
}

/**
 * Ensure PRODUCTS_UPDATE delivers to the S3 provider-evidence inbox.
 * Query-first / reuse / retarget same-app stale URI / create if absent.
 * Shop-scoped subscriptions belong to this app — stale preview/legacy URIs are updated.
 */
export async function ensureShopifyProductsUpdateWebhook(input: {
  shopDomain: string;
  accessToken: string;
  callbackUrl: string;
  fetchImpl?: ShopifyFetch;
}): Promise<{ status: "REUSED" | "CREATED" | "UPDATED"; subscriptionId: string }> {
  const wanted = normalizeWebhookUri(input.callbackUrl);
  if (!wanted) throw new ShopifyRequestError("Shopify products/update webhook callback is required");

  const list = () =>
    listProductsUpdateWebhookSubscriptions({
      shopDomain: input.shopDomain,
      accessToken: input.accessToken,
      fetchImpl: input.fetchImpl,
    });

  const initial = classifyWebhookDestinations(await list(), wanted);
  if (initial.match && initial.stale.length === 0) {
    return { status: "REUSED", subscriptionId: initial.match.id };
  }
  if (initial.stale.length > 0) {
    return retargetStaleWebhookSubscriptions({
      shopDomain: input.shopDomain,
      accessToken: input.accessToken,
      callbackUrl: input.callbackUrl,
      topicLabel: "PRODUCTS_UPDATE",
      stale: initial.stale,
      list,
      fetchImpl: input.fetchImpl,
    });
  }

  type CreateOutcome =
    | { status: "created"; id: string }
    | { status: "already" }
    | { status: "unknown" };

  const attemptCreate = async (): Promise<CreateOutcome> => {
    try {
      const data = await graphql<{
        webhookSubscriptionCreate: {
          userErrors: { message: string }[];
          webhookSubscription: { id: string } | null;
        };
      }>({
        shopDomain: input.shopDomain,
        accessToken: input.accessToken,
        query: PRODUCTS_UPDATE_MUTATION,
        variables: { uri: input.callbackUrl },
        fetchImpl: input.fetchImpl,
      });
      const errors = data.webhookSubscriptionCreate?.userErrors ?? [];
      const already =
        errors.length > 0 &&
        errors.every((error) => /already been taken|already exists/i.test(error.message));
      if (already) return { status: "already" };
      if (errors.length > 0) {
        throw new ShopifyRequestError("Shopify PRODUCTS_UPDATE webhook registration failed");
      }
      const id = data.webhookSubscriptionCreate?.webhookSubscription?.id;
      if (!id) return { status: "unknown" };
      return { status: "created", id };
    } catch (error) {
      if (
        error instanceof ShopifyRequestError &&
        /PRODUCTS_UPDATE webhook registration failed/i.test(error.message)
      ) {
        throw error;
      }
      return { status: "unknown" };
    }
  };

  const first = await attemptCreate();
  if (first.status === "created") {
    const after = classifyWebhookDestinations(await list(), wanted);
    return { status: "CREATED", subscriptionId: after.match?.id ?? first.id };
  }
  if (first.status === "already") {
    const after = classifyWebhookDestinations(await list(), wanted);
    if (after.stale.length > 0) {
      return retargetStaleWebhookSubscriptions({
        shopDomain: input.shopDomain,
        accessToken: input.accessToken,
        callbackUrl: input.callbackUrl,
        topicLabel: "PRODUCTS_UPDATE",
        stale: after.stale,
        list,
        fetchImpl: input.fetchImpl,
      });
    }
    if (!after.match) {
      throw new ShopifyRequestError("Shopify PRODUCTS_UPDATE webhook registration failed");
    }
    return { status: "REUSED", subscriptionId: after.match.id };
  }

  const requery = classifyWebhookDestinations(await list(), wanted);
  if (requery.match && requery.stale.length === 0) {
    return { status: "REUSED", subscriptionId: requery.match.id };
  }
  if (requery.stale.length > 0) {
    return retargetStaleWebhookSubscriptions({
      shopDomain: input.shopDomain,
      accessToken: input.accessToken,
      callbackUrl: input.callbackUrl,
      topicLabel: "PRODUCTS_UPDATE",
      stale: requery.stale,
      list,
      fetchImpl: input.fetchImpl,
    });
  }

  const second = await attemptCreate();
  if (second.status === "created") {
    const after = classifyWebhookDestinations(await list(), wanted);
    return { status: "CREATED", subscriptionId: after.match?.id ?? second.id };
  }
  const final = classifyWebhookDestinations(await list(), wanted);
  if (final.stale.length > 0) {
    return retargetStaleWebhookSubscriptions({
      shopDomain: input.shopDomain,
      accessToken: input.accessToken,
      callbackUrl: input.callbackUrl,
      topicLabel: "PRODUCTS_UPDATE",
      stale: final.stale,
      list,
      fetchImpl: input.fetchImpl,
    });
  }
  if (!final.match) {
    throw new ShopifyRequestError("Shopify PRODUCTS_UPDATE webhook registration failed");
  }
  return { status: "REUSED", subscriptionId: final.match.id };
}

const ORDERS_PAID_QUERY = `query ShopifyOrdersPaidWebhookSubscriptions {
  webhookSubscriptions(first: 50, topics: [ORDERS_PAID]) {
    nodes {
      id
      topic
      uri
      endpoint {
        __typename
        ... on WebhookHttpEndpoint { callbackUrl }
      }
    }
  }
}`;

const ORDERS_PAID_MUTATION = `mutation ShopifyOrdersPaidWebhook($uri: String!) {
  webhookSubscriptionCreate(
    topic: ORDERS_PAID
    webhookSubscription: { uri: $uri, format: JSON }
  ) {
    userErrors { field message }
    webhookSubscription { id topic uri }
  }
}`;

async function listOrdersPaidWebhookSubscriptions(input: {
  shopDomain: string;
  accessToken: string;
  fetchImpl?: ShopifyFetch;
}): Promise<WebhookSubscriptionNode[]> {
  const data = await graphql<{
    webhookSubscriptions: { nodes: WebhookSubscriptionNode[] };
  }>({
    shopDomain: input.shopDomain,
    accessToken: input.accessToken,
    query: ORDERS_PAID_QUERY,
    fetchImpl: input.fetchImpl,
  });
  return data.webhookSubscriptions?.nodes ?? [];
}

/**
 * Ensure ORDERS_PAID delivers to the S3 provider-evidence inbox.
 * Query-first / reuse / retarget same-app stale URI / create if absent.
 */
export async function ensureShopifyOrdersPaidWebhook(input: {
  shopDomain: string;
  accessToken: string;
  callbackUrl: string;
  fetchImpl?: ShopifyFetch;
}): Promise<{ status: "REUSED" | "CREATED" | "UPDATED"; subscriptionId: string }> {
  const wanted = normalizeWebhookUri(input.callbackUrl);
  if (!wanted) throw new ShopifyRequestError("Shopify orders/paid webhook callback is required");

  const list = () =>
    listOrdersPaidWebhookSubscriptions({
      shopDomain: input.shopDomain,
      accessToken: input.accessToken,
      fetchImpl: input.fetchImpl,
    });

  const initial = classifyWebhookDestinations(await list(), wanted);
  if (initial.match && initial.stale.length === 0) {
    return { status: "REUSED", subscriptionId: initial.match.id };
  }
  if (initial.stale.length > 0) {
    return retargetStaleWebhookSubscriptions({
      shopDomain: input.shopDomain,
      accessToken: input.accessToken,
      callbackUrl: input.callbackUrl,
      topicLabel: "ORDERS_PAID",
      stale: initial.stale,
      list,
      fetchImpl: input.fetchImpl,
    });
  }

  type CreateOutcome =
    | { status: "created"; id: string }
    | { status: "already" }
    | { status: "unknown" };

  const attemptCreate = async (): Promise<CreateOutcome> => {
    try {
      const data = await graphql<{
        webhookSubscriptionCreate: {
          userErrors: { message: string }[];
          webhookSubscription: { id: string } | null;
        };
      }>({
        shopDomain: input.shopDomain,
        accessToken: input.accessToken,
        query: ORDERS_PAID_MUTATION,
        variables: { uri: input.callbackUrl },
        fetchImpl: input.fetchImpl,
      });
      const errors = data.webhookSubscriptionCreate?.userErrors ?? [];
      const already =
        errors.length > 0 &&
        errors.every((error) => /already been taken|already exists/i.test(error.message));
      if (already) return { status: "already" };
      if (errors.length > 0) {
        throw new ShopifyRequestError("Shopify ORDERS_PAID webhook registration failed");
      }
      const id = data.webhookSubscriptionCreate?.webhookSubscription?.id;
      if (!id) return { status: "unknown" };
      return { status: "created", id };
    } catch (error) {
      if (
        error instanceof ShopifyRequestError &&
        /ORDERS_PAID webhook registration failed/i.test(error.message)
      ) {
        throw error;
      }
      return { status: "unknown" };
    }
  };

  const first = await attemptCreate();
  if (first.status === "created") {
    const after = classifyWebhookDestinations(await list(), wanted);
    return { status: "CREATED", subscriptionId: after.match?.id ?? first.id };
  }
  if (first.status === "already") {
    const after = classifyWebhookDestinations(await list(), wanted);
    if (after.stale.length > 0) {
      return retargetStaleWebhookSubscriptions({
        shopDomain: input.shopDomain,
        accessToken: input.accessToken,
        callbackUrl: input.callbackUrl,
        topicLabel: "ORDERS_PAID",
        stale: after.stale,
        list,
        fetchImpl: input.fetchImpl,
      });
    }
    if (!after.match) {
      throw new ShopifyRequestError("Shopify ORDERS_PAID webhook registration failed");
    }
    return { status: "REUSED", subscriptionId: after.match.id };
  }

  const requery = classifyWebhookDestinations(await list(), wanted);
  if (requery.match && requery.stale.length === 0) {
    return { status: "REUSED", subscriptionId: requery.match.id };
  }
  if (requery.stale.length > 0) {
    return retargetStaleWebhookSubscriptions({
      shopDomain: input.shopDomain,
      accessToken: input.accessToken,
      callbackUrl: input.callbackUrl,
      topicLabel: "ORDERS_PAID",
      stale: requery.stale,
      list,
      fetchImpl: input.fetchImpl,
    });
  }

  const second = await attemptCreate();
  if (second.status === "created") {
    const after = classifyWebhookDestinations(await list(), wanted);
    return { status: "CREATED", subscriptionId: after.match?.id ?? second.id };
  }
  const final = classifyWebhookDestinations(await list(), wanted);
  if (final.stale.length > 0) {
    return retargetStaleWebhookSubscriptions({
      shopDomain: input.shopDomain,
      accessToken: input.accessToken,
      callbackUrl: input.callbackUrl,
      topicLabel: "ORDERS_PAID",
      stale: final.stale,
      list,
      fetchImpl: input.fetchImpl,
    });
  }
  if (!final.match) {
    throw new ShopifyRequestError("Shopify ORDERS_PAID webhook registration failed");
  }
  return { status: "REUSED", subscriptionId: final.match.id };
}
