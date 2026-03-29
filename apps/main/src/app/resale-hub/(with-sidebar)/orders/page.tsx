import { redirectSellerFromResaleHubTo } from "@/lib/resale-hub-seller-redirect";
import { ResaleHubOrdersClient } from "./ResaleHubOrdersClient";

export default async function ResaleHubOrdersPage() {
  await redirectSellerFromResaleHubTo("/seller-hub/orders");
  return <ResaleHubOrdersClient />;
}
