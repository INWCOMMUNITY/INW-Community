/**
 * Resale Hub "Ship an Item" uses the same in-app EasyPost flow as Seller Hub.
 * Same APIs (store-orders, shipping/status, rates, label); keep ship icon in menu.
 */
import ShipScreen from "@/app/seller-hub/ship";
export default function ResaleHubShipScreen() {
  return <ShipScreen />;
}
