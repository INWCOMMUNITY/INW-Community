import { redirectSellerFromResaleHubTo } from "@/lib/resale-hub-seller-redirect";
import { ResaleHubPickupsClient } from "./ResaleHubPickupsClient";

export default async function ResaleHubPickupsPage() {
  await redirectSellerFromResaleHubTo("/seller-hub/pickups");
  return <ResaleHubPickupsClient />;
}
