import { redirect } from "next/navigation";

export default function PickupsRedirectPage() {
  redirect("/seller-hub/orders?tab=pickups");
}

