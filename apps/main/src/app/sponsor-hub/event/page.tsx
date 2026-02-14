import { redirect } from "next/navigation";

/** Event form is now a modal on the Sponsor Hub page. Redirect old links. */
export default function SponsorHubEventPage() {
  redirect("/sponsor-hub");
}
