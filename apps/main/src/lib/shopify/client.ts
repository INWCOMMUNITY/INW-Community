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

const SHOP_QUERY = `query ShopifyShopIdentity { shop { id myshopifyDomain } }`;

const LOCATIONS_QUERY = `query ShopifyInventoryLocations($cursor: String) {
  locations(first: 50, after: $cursor) {
    nodes { id name isActive fulfillsOnlineOrders fulfillmentService { id } }
    pageInfo { hasNextPage endCursor }
  }
}`;

const WEBHOOK_MUTATION = `mutation ShopifyAppUninstalledWebhook($callbackUrl: URL!) {
  webhookSubscriptionCreate(
    topic: APP_UNINSTALLED
    webhookSubscription: { callbackUrl: $callbackUrl, format: JSON }
  ) {
    userErrors { field message }
    webhookSubscription { id }
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
  shopDomain: string;
  accessToken: string;
  fetchImpl?: ShopifyFetch;
}): Promise<{ shopId: string; shopDomain: string }> {
  const data = await graphql<{ shop: { id?: string; myshopifyDomain?: string } | null }>({
    shopDomain: input.shopDomain,
    accessToken: input.accessToken,
    query: SHOP_QUERY,
    fetchImpl: input.fetchImpl,
  });
  const shopId = data.shop?.id ?? "";
  const shopDomain = data.shop?.myshopifyDomain ? normalizeShopifyShopDomain(data.shop.myshopifyDomain) : null;
  if (!SHOPIFY_SHOP_GID_PATTERN.test(shopId) || !shopDomain) {
    throw new ShopifyRequestError("Shopify shop identity was incomplete");
  }
  const requested = normalizeShopifyShopDomain(input.shopDomain);
  if (shopDomain !== requested) {
    throw new ShopifyRequestError("Shopify shop identity did not match the authorized shop");
  }
  return { shopId, shopDomain };
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
    variables: { callbackUrl: input.callbackUrl },
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
