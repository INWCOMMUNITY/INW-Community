/** Apps Airport Wix seller routes and display helpers. Isolated from Shopify and Etsy modules. */

export const APPS_AIRPORT_PATH = "/seller-hub/apps";
export const APPS_AIRPORT_WIX_PATH = `${APPS_AIRPORT_PATH}/wix`;

export type WixConnectionUiStatus = "connected" | "disconnected" | "needs_attention";

export function classifyWixConnectionUi(input: {
  connected: boolean;
  health?: "healthy" | "degraded" | "disconnected" | "not_configured";
} | null): WixConnectionUiStatus {
  if (!input?.connected) return "disconnected";
  if (input.health === "degraded") return "needs_attention";
  return "connected";
}

export function wixConnectionStatusLabel(status: WixConnectionUiStatus): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "needs_attention":
      return "Needs attention";
    case "disconnected":
      return "Not connected";
  }
}

export function appsAirportWixHubTitle(displayName: string, connectionStatusLabel: string): string {
  return `${displayName} (${connectionStatusLabel})`;
}
