"use client";

import { StorefrontOrdersContent } from "@/components/StorefrontOrdersContent";

export default function StorefrontOrdersPage() {
  return (
    <StorefrontOrdersContent
      backHref="/seller-hub"
      backLabel="Back to Seller Hub"
      title="Storefront Orders"
      ordersBasePath="/seller-hub/orders"
      shippingSetupHref="/seller-hub/shipping-setup"
      loginCallbackUrl="/seller-hub/orders"
    />
  );
}
