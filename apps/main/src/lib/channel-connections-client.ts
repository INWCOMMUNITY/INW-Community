import type { ChannelProvider } from "@/lib/channels/types";

export type ChannelProviderId = ChannelProvider;

export type ChannelConnectionSummary = {
  id: string;
  provider: ChannelProviderId;
  shopName: string | null;
  status: string;
  lastError?: string | null;
  readyToPublish: boolean | null;
  publishBlockReason?: string | null;
};

export const LIST_ON_PROVIDER_ORDER: ChannelProviderId[] = ["ebay", "etsy", "wix", "shopify"];

/** Connected stores the seller can opt into on List Item (active Sync Stores only). */
export function activeListOnConnections(
  connections: ChannelConnectionSummary[]
): ChannelConnectionSummary[] {
  return connections
    .filter((c) => c.status === "active")
    .slice()
    .sort(
      (a, b) => LIST_ON_PROVIDER_ORDER.indexOf(a.provider) - LIST_ON_PROVIDER_ORDER.indexOf(b.provider)
    );
}

const NOT_READY_HINT: Record<ChannelProviderId, string> = {
  ebay: "Complete business policies and a merchant location in Sync Stores.",
  etsy: "Reconnect in Sync Stores.",
  shopify: "Finish location setup in Sync Stores.",
  wix: "Reconnect in Sync Stores.",
};

export function channelNotReadyHint(provider: ChannelProviderId): string {
  return NOT_READY_HINT[provider];
}

export async function fetchChannelConnections(): Promise<ChannelConnectionSummary[]> {
  const res = await fetch("/api/channels", { credentials: "include" });
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  return data.filter((c: ChannelConnectionSummary) => c.status !== "disconnected");
}

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
