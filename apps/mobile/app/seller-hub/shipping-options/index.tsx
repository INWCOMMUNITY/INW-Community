import { Redirect } from "expo-router";

/** Legacy route — shipping options live on the combined Shipping screen. */
export default function ShippingOptionsRedirect() {
  return <Redirect href="/seller-hub/shipping-setup" />;
}
