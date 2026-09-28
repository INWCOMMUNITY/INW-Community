import { AppsAirportChrome } from "@/components/apps-airport/AppsAirportChrome";
import { ShopifyConnectionPanel } from "@/components/shopify/ShopifyConnectionPanel";
import { APPS_AIRPORT_SHOPIFY_PATH } from "@/lib/shopify/apps-airport";

export default function AppsAirportShopifySettingsPage() {
  return (
    <AppsAirportChrome
      title="Shopify connection settings"
      subtitle="Connect your shop, choose a primary fulfillment location, or disconnect."
      crumbs={[
        { href: APPS_AIRPORT_SHOPIFY_PATH, label: "Shopify" },
        { href: `${APPS_AIRPORT_SHOPIFY_PATH}/settings`, label: "Settings" },
      ]}
    >
      <ShopifyConnectionPanel showHeading={false} />
    </AppsAirportChrome>
  );
}
