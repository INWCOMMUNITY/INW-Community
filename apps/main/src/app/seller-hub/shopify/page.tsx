import { redirect } from "next/navigation";
import { APPS_AIRPORT_SHOPIFY_SETTINGS_PATH } from "@/lib/shopify/apps-airport";

/**
 * Legacy Shopify connection route.
 * Apps Airport is now the seller management surface; preserve OAuth query params.
 */
export default function LegacySellerShopifyPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const params = new URLSearchParams();
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (typeof value === "string") params.set(key, value);
      else if (Array.isArray(value) && value[0]) params.set(key, value[0]);
    }
  }
  const qs = params.toString();
  redirect(`${APPS_AIRPORT_SHOPIFY_SETTINGS_PATH}${qs ? `?${qs}` : ""}`);
}
