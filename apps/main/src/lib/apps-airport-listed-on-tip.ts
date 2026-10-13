import {
  APPS_AIRPORT_ETSY_SETTINGS_PATH,
  APPS_AIRPORT_ETSY_PATH,
} from "@/lib/etsy/apps-airport";
import {
  APPS_AIRPORT_SHOPIFY_SETTINGS_PATH,
  APPS_AIRPORT_SHOPIFY_PATH,
} from "@/lib/shopify/apps-airport";

export type ListedOnTipMode = "listed" | "list";

export type ListedOnChannelReady = {
  etsyReady: boolean;
  shopifyReady: boolean;
};

/** Tip title + primary CTA for a Listed On slot. */
export function listedOnTipCopy(input: {
  mode: ListedOnTipMode;
  label: string;
  channelReady: boolean;
}): { title: string; ctaLabel: string | null } {
  if (input.mode === "listed") {
    return { title: `Listed on ${input.label}`, ctaLabel: "Manage" };
  }
  return {
    title: `List on ${input.label}`,
    ctaLabel: input.channelReady ? "List" : "Connect",
  };
}

export function listedOnSettingsHref(channelId: "etsy" | "shopify"): string {
  return channelId === "etsy"
    ? APPS_AIRPORT_ETSY_SETTINGS_PATH
    : APPS_AIRPORT_SHOPIFY_SETTINGS_PATH;
}

export function listedOnManageHref(channelId: "etsy" | "shopify"): string {
  return channelId === "etsy" ? APPS_AIRPORT_ETSY_PATH : APPS_AIRPORT_SHOPIFY_PATH;
}
