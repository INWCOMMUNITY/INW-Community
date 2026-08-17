import { redirect } from "next/navigation";

export default function DeliveriesRedirectPage() {
  redirect("/seller-hub/orders?tab=deliveries");
}
