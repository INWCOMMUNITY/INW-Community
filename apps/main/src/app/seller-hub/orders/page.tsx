"use client";

import { Suspense } from "react";
import { FulfillmentHubContent } from "@/components/FulfillmentHubContent";

function OrdersPageInner() {
  return (
    <FulfillmentHubContent
      backHref="/seller-hub"
      backLabel="Back to Seller Hub"
      title="Fulfillment"
      ordersBasePath="/seller-hub/orders"
      shippingSetupHref="/seller-hub/shipping-setup"
      loginCallbackUrl="/seller-hub/orders"
    />
  );
}

export default function StorefrontOrdersPage() {
  return (
    <Suspense fallback={<p className="p-8 text-gray-500">Loading…</p>}>
      <OrdersPageInner />
    </Suspense>
  );
}

