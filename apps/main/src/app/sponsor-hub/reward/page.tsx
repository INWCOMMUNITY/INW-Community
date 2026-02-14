import { redirect } from "next/navigation";

/** Reward form is now a modal on the Sponsor Hub page. Redirect old links. */
export default function SponsorHubRewardPage() {
  redirect("/sponsor-hub");
}
