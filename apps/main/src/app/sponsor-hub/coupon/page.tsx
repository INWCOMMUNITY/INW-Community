import { redirect } from "next/navigation";

/** Coupon form is now a modal on the Sponsor Hub page. Redirect old links. */
export default function SponsorHubCouponPage() {
  redirect("/sponsor-hub");
}
