import { redirect } from "next/navigation";

/** Synced Shopify listings live on My Items. Old bookmarks and menu links land there. */
export default function AppsAirportShopifyListingsPage() {
  redirect("/seller-hub/store/items");
}
