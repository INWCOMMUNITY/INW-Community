import { Redirect } from "expo-router";

/** Redirect old Sponsor Hub route to Business Hub. */
export default function SponsorHubRedirect() {
  return <Redirect href={"/seller-hub/business-hub" as import("expo-router").Href} />;
}
