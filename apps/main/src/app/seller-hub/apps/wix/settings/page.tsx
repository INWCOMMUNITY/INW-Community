import { AppsAirportChrome } from "@/components/apps-airport/AppsAirportChrome";
import { WixConnectionPanel } from "@/components/wix/WixConnectionPanel";
import { APPS_AIRPORT_WIX_PATH } from "@/lib/wix/apps-airport";

export default function AppsAirportWixSettingsPage() {
  return (
    <AppsAirportChrome
      title="Wix Connection Settings"
      subtitle="Connect your Wix site, then import products or list INW items from Sync Airport."
      crumbs={[
        { href: APPS_AIRPORT_WIX_PATH, label: "Wix" },
        { href: `${APPS_AIRPORT_WIX_PATH}/settings`, label: "Settings" },
      ]}
    >
      <WixConnectionPanel showHeading={false} />
    </AppsAirportChrome>
  );
}
