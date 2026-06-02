import type { ChannelAdapter, ChannelProvider } from "./types";
import { etsyAdapter } from "./etsy/adapter";
import { ebayAdapter } from "./ebay/adapter";
import { wixAdapter } from "./wix/adapter";
import { shopifyAdapter } from "./shopify/adapter";

const ADAPTERS: Partial<Record<ChannelProvider, ChannelAdapter>> = {
  etsy: etsyAdapter,
  ebay: ebayAdapter,
  wix: wixAdapter,
  shopify: shopifyAdapter,
};

export function getAdapter(provider: ChannelProvider): ChannelAdapter {
  const adapter = ADAPTERS[provider];
  if (!adapter) {
    throw new Error(`No sync adapter implemented for provider "${provider}".`);
  }
  return adapter;
}

export function hasAdapter(provider: ChannelProvider): boolean {
  return Boolean(ADAPTERS[provider]);
}
