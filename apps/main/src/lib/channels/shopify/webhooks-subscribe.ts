import { getBaseUrl } from "@/lib/get-base-url";
import { shopifyGet, shopifyJson, ShopifyApiError } from "./client";
import type { ShopifyWebhookTopic } from "./webhook";

export const SHOPIFY_WEBHOOK_TOPICS: Exclude<ShopifyWebhookTopic, "unknown">[] = [
  "orders/paid",
  "inventory_levels/update",
  "products/update",
  "products/delete",
];

type ShopifyWebhookRow = {
  id?: number;
  topic?: string;
  address?: string;
};

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

  const have = new Set(
    existing
      .filter((w) => (w.address ?? "").replace(/\/+$/, "") === address)
      .map((w) => (w.topic ?? "").toLowerCase())
  );
  const created: string[] = [];

  for (const topic of SHOPIFY_WEBHOOK_TOPICS) {
    if (have.has(topic)) continue;
    const stale = existing.find((w) => (w.topic ?? "").toLowerCase() === topic && w.id != null);
    try {
      if (stale?.id != null && stale.address && stale.address.replace(/\/+$/, "") !== address) {
        await shopifyJson(
          args.accessToken,
          args.shop,
          args.apiVersion,
          `/webhooks/${stale.id}.json`,
          "PUT",
          { webhook: { id: stale.id, address } }
        );
        created.push(topic);
        continue;
      }
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
        topics: [...have, ...created],
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
