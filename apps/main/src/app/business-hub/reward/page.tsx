import { redirect } from "next/navigation";

/** Reward form is now a modal on the Business Hub page. Redirect old links. */
export default function BusinessHubRewardPage() {
  redirect("/business-hub");
}
