import { redirect } from "next/navigation";

/** Event form is now a modal on the Business Hub page. Redirect old links. */
export default function BusinessHubEventPage() {
  redirect("/business-hub");
}
