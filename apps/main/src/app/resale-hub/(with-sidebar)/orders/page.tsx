"use client";

import { StorefrontOrdersContent } from "@/components/StorefrontOrdersContent";

export default function ResaleHubOrdersPage() {
  return (
    <StorefrontOrdersContent
      backHref="/resale-hub"
      backLabel="Back to Resale Hub"
      title="Resale Orders"
      ordersBasePath="/resale-hub/orders"
      shippingSetupHref="/seller-hub/shipping-setup"
      loginCallbackUrl="/resale-hub/orders"
    />
  );
}
