import { redirect } from "next/navigation";

/** Legacy URL — shipping options live on the combined Shipping page. */
export default function ShippingOptionsRedirectPage() {
  redirect("/seller-hub/shipping-setup");
}
