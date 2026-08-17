import type { StoreOrderSummary } from "@/lib/store-order-fulfillment";

export interface FulfillmentOrderItem {
  id: string;
  quantity: number;
  priceCentsAtPurchase?: number;
  fulfillmentType?: string | null;
  storeItem: { id: string; title: string; slug: string; photos: string[] };
}

export interface FulfillmentShipment {
  id: string;
  carrier: string;
  service?: string;
  trackingNumber: string | null;
  labelUrl: string | null;
  shippoOrderId?: string | null;
  createdAt?: string;
}

export interface FulfillmentStoreOrder extends StoreOrderSummary {
  buyer: { firstName: string; lastName: string; email: string };
  items: FulfillmentOrderItem[];
  shipment?: FulfillmentShipment | null;
  shippedWithOrderId?: string | null;
  pickupSellerConfirmedAt?: string | null;
  pickupBuyerConfirmedAt?: string | null;
  deliveryConfirmedAt?: string | null;
  deliveryBuyerConfirmedAt?: string | null;
  localDeliveryDetails?: LocalDeliveryDetails | null;
}

export interface LocalDeliveryDetails {
  firstName?: string;
  lastName?: string;
  phone?: string;
  deliveryAddress?: { street?: string; city?: string; state?: string; zip?: string };
  note?: string;
}

export interface SellerProfileForSlips {
  business: {
    name: string;
    phone: string | null;
    address: string | null;
    city?: string | null;
    logoUrl: string | null;
    website?: string | null;
    email?: string | null;
  } | null;
  returnAddressFormatted?: string | null;
  packingSlipNote?: string | null;
}

export type FulfillmentTabCounts = {
  ship: number;
  pickups: number;
  deliveries: number;
  shipped: number;
  canceled: number;
};
