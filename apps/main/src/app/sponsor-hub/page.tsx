import { redirect } from "next/navigation";

/** Redirect old Sponsor Hub URL to Business Hub. */
export default function SponsorHubRedirect() {
  redirect("/business-hub");
}
