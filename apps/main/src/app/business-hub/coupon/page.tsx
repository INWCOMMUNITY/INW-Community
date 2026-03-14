import { redirect } from "next/navigation";

/** Coupon form is now a modal on the Business Hub page. Redirect old links. */
export default function BusinessHubCouponPage() {
  redirect("/business-hub");
}
