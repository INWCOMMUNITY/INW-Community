import { redirect } from "next/navigation";

/** Legacy route — combined Shipping page is at /seller-hub/shipping-setup. */
export default function ShippingOptionsLayout({
  children: _children,
}: {
  children: React.ReactNode;
}) {
  redirect("/seller-hub/shipping-setup");
}
