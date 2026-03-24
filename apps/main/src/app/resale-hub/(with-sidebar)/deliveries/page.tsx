import { redirectSellerFromResaleHubTo } from "@/lib/resale-hub-seller-redirect";
import { ResaleHubDeliveriesClient } from "./ResaleHubDeliveriesClient";

export default async function ResaleHubDeliveriesPage() {
  await redirectSellerFromResaleHubTo("/seller-hub/deliveries");
  return <ResaleHubDeliveriesClient />;
}
