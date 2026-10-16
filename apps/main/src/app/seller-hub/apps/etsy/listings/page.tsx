import { redirect } from "next/navigation";

/** Linked Etsy listings live on My Items. Old bookmarks and menu links land there. */
export default function AppsAirportEtsyListingsPage() {
  redirect("/seller-hub/store/items");
}
