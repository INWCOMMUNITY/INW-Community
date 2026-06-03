import { apiGet } from "@/lib/api";

export type ChannelProviderId = "etsy" | "ebay" | "shopify" | "wix";

export type ChannelConnectionSummary = {
  id: string;
  provider: ChannelProviderId;
  shopName: string | null;
  status: string;
  readyToPublish: boolean | null;
};

export const CHANNEL_PROVIDER_LABEL: Record<ChannelProviderId, string> = {
  wix: "Wix",
  etsy: "Etsy",
  ebay: "eBay",
  shopify: "Shopify",
};

const NOT_READY_HINT: Record<ChannelProviderId, string> = {
  ebay: "Complete business policies and a merchant location in Sync Stores.",
  etsy: "Add a shipping profile in Sync Stores.",
  shopify: "Finish location setup in Sync Stores.",
  wix: "Reconnect in Sync Stores.",
};

export function channelNotReadyHint(provider: ChannelProviderId): string {
  return NOT_READY_HINT[provider];
}

/** Active Sync Stores connections (not disconnected). */
export async function fetchChannelConnections(): Promise<ChannelConnectionSummary[]> {
  const data = await apiGet<ChannelConnectionSummary[]>("/api/channels");
  if (!Array.isArray(data)) return [];
  return data.filter((c) => c.status !== "disconnected");
}

/** Connections the seller can opt into on create (shown in modal; may include not-ready rows). */
export function connectionsForPublishModal(
  connections: ChannelConnectionSummary[]
): ChannelConnectionSummary[] {
  return connections.filter((c) => c.status === "active" || c.status === "error");
}

export function defaultSelectedProviders(
  connections: ChannelConnectionSummary[]
): ChannelProviderId[] {
  return connections
    .filter((c) => c.status === "active" && c.readyToPublish !== false)
    .map((c) => c.provider);
}

export function publishReadyConnections(
  connections: ChannelConnectionSummary[]
): ChannelConnectionSummary[] {
  return connections.filter(
    (c) => c.status === "active" && c.readyToPublish !== false
  );
}
