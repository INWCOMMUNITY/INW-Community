import { AppsAirportChrome } from "@/components/apps-airport/AppsAirportChrome";
import { EtsyConnectionPanel } from "@/components/etsy/EtsyConnectionPanel";
import { APPS_AIRPORT_ETSY_PATH } from "@/lib/etsy/apps-airport";

export default function AppsAirportEtsySettingsPage() {
  return (
    <AppsAirportChrome
      title="Etsy connection settings"
      subtitle="Connect your Etsy shop, set shipping/taxonomy defaults, then list items from Apps Airport."
      crumbs={[
        { href: APPS_AIRPORT_ETSY_PATH, label: "Etsy" },
        { href: `${APPS_AIRPORT_ETSY_PATH}/settings`, label: "Settings" },
      ]}
    >
      <EtsyConnectionPanel showHeading={false} />
    </AppsAirportChrome>
  );
}
