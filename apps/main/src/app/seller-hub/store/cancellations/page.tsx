import { redirect } from "next/navigation";

/** Cash-order re-list is retired; storefront checkout is card-only. */
export default function CancellationsRedirectPage() {
  redirect("/seller-hub/orders?tab=history");
}
