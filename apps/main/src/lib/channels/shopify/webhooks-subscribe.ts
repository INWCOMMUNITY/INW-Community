import { getBaseUrl } from "@/lib/get-base-url";
import { shopifyDelete, shopifyGet, shopifyJson, ShopifyApiError } from "./client";
import type { ShopifyWebhookTopic } from "./webhook";

export const SHOPIFY_WEBHOOK_TOPICS: Exclude<ShopifyWebhookTopic, "unknown">[] = [
  "orders/paid",
  "inventory_levels/update",
  "products/update",
  "products/delete",
  "app/uninstalled",
];

export type ShopifyWebhookRow = {
  id?: number;
  topic?: string;
  address?: string;
};

export function normalizeShopifyWebhookAddress(address: string | null | undefined): string {
  return (address ?? "").trim().replace(/\/+$/, "");
}

export function shopifyWebhookAddressSet(
  addresses: Array<string | null | undefined>
): Set<string> {
  return new Set(addresses.map(normalizeShopifyWebhookAddress).filter(Boolean));
}

export function isInwShopifyWebhookAddress(
  address: string | null | undefined,
  ownedAddresses: Iterable<string | null | undefined>
): boolean {
  const n = normalizeShopifyWebhookAddress(address);
  if (!n) return false;
  return shopifyWebhookAddressSet([...ownedAddresses]).has(n);
}

/** Topics we still need to POST at our callback — never rewrite another app's URL. */
export function shopifyWebhookTopicsToCreate(
  existing: ShopifyWebhookRow[],
  address: string,
  topics: readonly string[] = SHOPIFY_WEBHOOK_TOPICS
): string[] {
  const ours = normalizeShopifyWebhookAddress(address);
  const have = new Set(
    existing
      .filter((w) => normalizeShopifyWebhookAddress(w.address) === ours)
      .map((w) => (w.topic ?? "").toLowerCase())
  );
  return topics.filter((topic) => !have.has(topic.toLowerCase()));
}

export function shopifyWebhookIdsToDelete(
  existing: ShopifyWebhookRow[],
  ownedAddresses: Array<string | null | undefined>
): number[] {
  return existing
    .filter((w) => w.id != null && isInwShopifyWebhookAddress(w.address, ownedAddresses))
    .map((w) => w.id as number);
}

export function shopifyWebhookCallbackUrl(): string | null {
  const explicit = process.env.SHOPIFY_WEBHOOK_URL?.trim();
  const url = (explicit || `${getBaseUrl()}/api/channels/shopify/webhook`).replace(/\/+$/, "");
  if (!/^https:\/\//i.test(url)) return null;
  if (/localhost|127\.0\.0\.1/i.test(url)) return null;
  return url;
}

export type EnsureShopifyWebhooksResult = {
  address: string | null;
  topics: string[];
  created: string[];
  error: string | null;
};

export async function ensureShopifyWebhooks(args: {
  accessToken: string;
  shop: string;
  apiVersion: string;
}): Promise<EnsureShopifyWebhooksResult> {
  const address = shopifyWebhookCallbackUrl();
  if (!address) {
    return {
      address: null,
      topics: [],
      created: [],
      error: "Shopify webhooks need a public HTTPS URL (set NEXTAUTH_URL or SHOPIFY_WEBHOOK_URL).",
    };
  }

  let existing: ShopifyWebhookRow[] = [];
  try {
    const res = await shopifyGet<{ webhooks?: ShopifyWebhookRow[] }>(
      args.accessToken,
      args.shop,
      args.apiVersion,
      "/webhooks.json?limit=250"
    );
    existing = res.webhooks ?? [];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { address, topics: [], created: [], error: msg };
  }

  const missing = shopifyWebhookTopicsToCreate(existing, address, SHOPIFY_WEBHOOK_TOPICS);
  const created: string[] = [];

  for (const topic of missing) {
    try {
      await shopifyJson(args.accessToken, args.shop, args.apiVersion, "/webhooks.json", "POST", {
        webhook: { topic, address, format: "json" },
      });
      created.push(topic);
    } catch (e) {
      if (e instanceof ShopifyApiError && /already been taken|has already been taken/i.test(e.message)) {
        continue;
      }
      const msg = e instanceof Error ? e.message : String(e);
      return {
        address,
        topics: SHOPIFY_WEBHOOK_TOPICS.filter((t) => !missing.includes(t) || created.includes(t)),
        created,
        error: `${topic}: ${msg}`,
      };
    }
  }

  return {
    address,
    topics: [...SHOPIFY_WEBHOOK_TOPICS],
    created,
    error: null,
  };
}

/** Delete this app's Shopify webhooks so disconnect does not keep ingesting the shop. */
export async function removeShopifyWebhooks(args: {
  accessToken: string;
  shop: string;
  apiVersion: string;
  extraAddresses?: Array<string | null | undefined>;
}): Promise<{ deleted: number; error: string | null }> {
  let existing: ShopifyWebhookRow[] = [];
  try {
    const res = await shopifyGet<{ webhooks?: ShopifyWebhookRow[] }>(
      args.accessToken,
      args.shop,
      args.apiVersion,
      "/webhooks.json?limit=250"
    );
    existing = res.webhooks ?? [];
  } catch (e) {
    return { deleted: 0, error: e instanceof Error ? e.message : String(e) };
  }

  const owned = [shopifyWebhookCallbackUrl(), ...(args.extraAddresses ?? [])];
  const ids = shopifyWebhookIdsToDelete(existing, owned);

  let deleted = 0;
  for (const id of ids) {
    try {
      await shopifyDelete(args.accessToken, args.shop, args.apiVersion, `/webhooks/${id}.json`);
      deleted += 1;
    } catch (e) {
      return {
        deleted,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }
  return { deleted, error: null };
}
