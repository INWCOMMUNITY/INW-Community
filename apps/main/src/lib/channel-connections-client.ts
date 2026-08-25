import type { ChannelProvider } from "@/lib/channels/types";

export type ChannelProviderId = ChannelProvider;

export type ChannelHealthKind = "ok" | "reconnect" | "delayed" | "platform_key";

export type ChannelConnectionSummary = {
  id: string;
  provider: ChannelProviderId;
  shopName: string | null;
  status: string;
  lastError?: string | null;
  readyToPublish: boolean | null;
  publishBlockReason?: string | null;
  healthKind?: ChannelHealthKind | null;
  healthMessage?: string | null;
  pauseReason?: string | null;
};

export function listOnConnectionHealth(c: {
  status: string;
  readyToPublish?: boolean | null;
  publishBlockReason?: string | null;
  healthKind?: ChannelHealthKind | null;
  healthMessage?: string | null;
}): { blocked: boolean; showReconnect: boolean; hint: string | null } {
  const kind = c.healthKind ?? (c.status === "error" ? "reconnect" : "ok");
  const errored = c.status === "error";
  const blocked = errored || c.readyToPublish === false;
  const showReconnect = kind === "reconnect";
  if (errored && c.healthMessage) {
    return { blocked, showReconnect, hint: c.healthMessage };
  }
  if (blocked) {
    return { blocked, showReconnect, hint: c.publishBlockReason ?? null };
  }
  return { blocked: false, showReconnect: false, hint: null };
}

export const LIST_ON_PROVIDER_ORDER: ChannelProviderId[] = ["ebay", "etsy", "wix", "shopify"];

/** Connected stores shown on List Item: live connections and ones that need reconnect. */
export function listOnConnections(
  connections: ChannelConnectionSummary[]
): ChannelConnectionSummary[] {
  return connections
    .filter((c) => c.status === "active" || c.status === "error")
    .slice()
    .sort(
      (a, b) => LIST_ON_PROVIDER_ORDER.indexOf(a.provider) - LIST_ON_PROVIDER_ORDER.indexOf(b.provider)
    );
}

/** Live Sync Stores connections only (ready or blocked by policies). */
export function activeListOnConnections(
  connections: ChannelConnectionSummary[]
): ChannelConnectionSummary[] {
  return listOnConnections(connections).filter((c) => c.status === "active");
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
