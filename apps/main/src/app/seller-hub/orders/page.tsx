import { Suspense } from "react";
import { FulfillmentHubContent } from "@/components/FulfillmentHubContent";

export default function StorefrontOrdersPage() {
  return (
    <Suspense fallback={<p className="p-8 text-gray-500">Loading fulfillment…</p>}>
      <FulfillmentHubContent
        backHref="/seller-hub"
        backLabel="Back to Seller Hub"
        title="Fulfillment"
        ordersBasePath="/seller-hub/orders"
        shippingSetupHref="/seller-hub/shipping-setup"
        loginCallbackUrl="/seller-hub/orders"
      />
    </Suspense>
  );
}
