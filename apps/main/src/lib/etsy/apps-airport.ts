/** Apps Airport Etsy seller routes and display helpers. Isolated from Shopify modules. */

export const APPS_AIRPORT_PATH = "/seller-hub/apps";
export const APPS_AIRPORT_ETSY_PATH = `${APPS_AIRPORT_PATH}/etsy`;
export const APPS_AIRPORT_ETSY_SETTINGS_PATH = `${APPS_AIRPORT_ETSY_PATH}/settings`;
export const APPS_AIRPORT_ETSY_SYNC_PATH = `${APPS_AIRPORT_ETSY_PATH}/sync`;
export const APPS_AIRPORT_ETSY_LISTINGS_PATH = `${APPS_AIRPORT_ETSY_PATH}/listings`;
export const APPS_AIRPORT_ETSY_IMPORT_PATH = `${APPS_AIRPORT_ETSY_PATH}/import`;

export type EtsyConnectionUiStatus = "connected" | "disconnected";

export function classifyEtsyConnectionUi(input: {
  status?: string | null;
} | null): EtsyConnectionUiStatus {
  if (!input || input.status !== "ACTIVE") return "disconnected";
  return "connected";
}

export function etsyConnectionStatusLabel(status: EtsyConnectionUiStatus): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "disconnected":
      return "Not connected";
  }
}

export function appsAirportEtsyHubTitle(
  displayName: string,
  connectionStatusLabel: string
): string {
  return `${displayName} (${connectionStatusLabel})`;
}

export const APPS_AIRPORT_ETSY_HUB = {
  id: "etsy" as const,
  displayName: "Etsy",
  hubPath: APPS_AIRPORT_ETSY_PATH,
  importPath: APPS_AIRPORT_ETSY_IMPORT_PATH,
  listItemsPath: APPS_AIRPORT_ETSY_SYNC_PATH,
  settingsPath: APPS_AIRPORT_ETSY_SETTINGS_PATH,
  listingsPath: APPS_AIRPORT_ETSY_LISTINGS_PATH,
  importLabel: "Import Listings",
  listItemsLabel: "List Items on Etsy",
  settingsLabel: "Connection Settings",
  viewOnChannelLabel: "View on Etsy",
  openAdminLabel: "Open Etsy Shop Manager",
};

/** True once E4 import routes are live. */
export const ETSY_IMPORT_ENABLED = true;
