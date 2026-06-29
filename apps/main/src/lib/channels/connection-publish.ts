import type { ChannelProvider } from "./types";

type ConnectionRow = {
  provider: string;
  status: string;
  etsyShippingProfileId: string | null;
  config: unknown;
};

/** Same rules as GET /api/channels readyToPublish. */
export function connectionReadyToPublish(c: ConnectionRow): boolean {
  const config = (c.config ?? {}) as Record<string, unknown>;
  if (c.provider === "etsy") return Boolean(c.etsyShippingProfileId);
  if (c.provider === "ebay") {
    // Use the stored canPublish flag if available (includes opt-in + location enabled checks)
    if (typeof config.canPublish === "boolean") return config.canPublish;
    // Fallback for older connections without canPublish flag
    return Boolean(
      config.fulfillmentPolicyId &&
        config.paymentPolicyId &&
        config.returnPolicyId &&
        config.merchantLocationKey
    );
  }
  if (c.provider === "shopify") {
    return Boolean(config.locationId && config.shop);
  }
  return true;
}

export function publishBlockReason(c: ConnectionRow): string | null {
  if (c.status === "disconnected") return "Store is disconnected. Reconnect in Sync Stores.";
  if (c.status === "error") {
    return "Connection needs attention. Open Sync Stores and reconnect.";
  }
  if (!connectionReadyToPublish(c)) {
    const config = (c.config ?? {}) as Record<string, unknown>;
    if (c.provider === "ebay") {
      // Use the detailed publishBlockReason if available
      if (typeof config.publishBlockReason === "string" && config.publishBlockReason) {
        return config.publishBlockReason;
      }
      return "Complete eBay business policies and a merchant location in Sync Stores first.";
    }
    if (c.provider === "etsy") {
      return "Add an Etsy shipping profile in Sync Stores first.";
    }
    if (c.provider === "shopify") {
      return "Finish Shopify location setup in Sync Stores first.";
    }
    return "This store is not ready to publish yet.";
  }
  return null;
}

export function validateProvidersForPublish(
  connections: ConnectionRow[],
  providers: ChannelProvider[]
): { ok: true } | { ok: false; error: string } {
  const byProvider = new Map(connections.map((c) => [c.provider, c]));
  for (const p of providers) {
    const conn = byProvider.get(p);
    if (!conn) {
      const label = p.charAt(0).toUpperCase() + p.slice(1);
      return { ok: false, error: `${label} is not connected. Connect it in Sync Stores first.` };
    }
    const reason = publishBlockReason(conn);
    if (reason) return { ok: false, error: reason };
  }
  return { ok: true };
}
