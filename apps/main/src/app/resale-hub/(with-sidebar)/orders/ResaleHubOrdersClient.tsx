"use client";

import { StorefrontOrdersContent } from "@/components/StorefrontOrdersContent";

export function ResaleHubOrdersClient() {
  return (
    <StorefrontOrdersContent
      backHref="/resale-hub"
      backLabel="Back to Resale Hub"
      title="Your orders"
      ordersBasePath="/resale-hub/orders"
      shippingSetupHref="/seller-hub/shipping-setup"
      loginCallbackUrl="/resale-hub/orders"
    />
  );
}
