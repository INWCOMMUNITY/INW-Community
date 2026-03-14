import { redirect } from "next/navigation";

export default function ShipPageRedirect() {
  redirect("/seller-hub/orders");
}
