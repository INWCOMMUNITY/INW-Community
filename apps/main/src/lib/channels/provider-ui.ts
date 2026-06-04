import type { ChannelProvider } from "./types";

export type ChannelConnectionSummary = {
  id: string;
  provider: string;
  shopName: string | null;
  shopId: string | null;
  status: string;
  lastError: string | null;
  hasShippingProfile: boolean;
  readyToPublish: boolean | null;
  linkedListings: number;
};

export type ChannelProviderUi = {
  provider: ChannelProvider;
  name: string;
  icon: string;
  blurb: string;
};

export const CHANNEL_PROVIDERS_UI: ChannelProviderUi[] = [
  {
    provider: "etsy",
    name: "Etsy",
    icon: "storefront-outline",
    blurb: "Sync listings and inventory with your Etsy shop.",
  },
  {
    provider: "ebay",
    name: "eBay",
    icon: "pricetags-outline",
    blurb: "Sync listings and inventory with eBay.",
  },
  {
    provider: "wix",
    name: "Wix",
    icon: "globe-outline",
    blurb: "Sync listings and inventory with your Wix store.",
  },
  {
    provider: "shopify",
    name: "Shopify",
    icon: "bag-handle-outline",
    blurb: "Sync listings and inventory with your Shopify store.",
  },
];

export const CHANNEL_PROVIDER_LABELS: Record<string, string> = Object.fromEntries(
  CHANNEL_PROVIDERS_UI.map((p) => [p.provider, p.name])
);

export function formatChannelQueryError(raw: string): string {
  if (raw === "seller_plan_required") {
    return "Seller plan required to connect stores. Subscribe on Support NWC to unlock Sync Stores.";
  }
  try {
    return decodeURIComponent(raw.replace(/\+/g, " "));
  } catch {
    return raw;
  }
}
