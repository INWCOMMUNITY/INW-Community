/** Shared validation for cart → order snapshot (pickup + local delivery JSON). */

export type PickupDetailsJson = {
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  preferredPickupTime?: string;
  preferredPickupDate?: string;
  note?: string;
  termsAcceptedAt?: string;
};

export type LocalDeliveryDetailsJson = {
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  deliveryAddress?: { street?: string; city?: string; state?: string; zip?: string };
  note?: string;
  termsAcceptedAt?: string;
  availableDropOffTimes?: string;
};

export type FulfillmentType = "ship" | "local_delivery" | "pickup";

/** Listing flags needed to validate cart/checkout fulfillment choice. */
export type StoreItemForFulfillment = {
  title?: string;
  shippingDisabled?: boolean;
  localDeliveryAvailable?: boolean;
  inStorePickupAvailable?: boolean;
};

export function validateRequestedFulfillment(
  storeItem: StoreItemForFulfillment,
  fulfillmentType: string | undefined
): { ok: true } | { ok: false; error: string } {
  const ft = (fulfillmentType ?? "ship") as FulfillmentType;
  const title = storeItem.title?.trim() || "This item";
  if (ft === "ship") {
    if (storeItem.shippingDisabled) {
      return { ok: false, error: `${title} does not offer shipping.` };
    }
    return { ok: true };
  }
  if (ft === "local_delivery") {
    if (!storeItem.localDeliveryAvailable) {
      return { ok: false, error: `${title} does not offer local delivery.` };
    }
    return { ok: true };
  }
  if (ft === "pickup") {
    if (!storeItem.inStorePickupAvailable) {
      return { ok: false, error: `${title} does not offer in-store pickup.` };
    }
    return { ok: true };
  }
  return { ok: false, error: "Invalid fulfillment type." };
}

export function storeItemHasLocalDeliveryPolicy(storeItem: {
  localDeliveryTerms?: string | null;
  member?: { sellerLocalDeliveryPolicy?: string | null } | null;
}): boolean {
  const t = storeItem.localDeliveryTerms ?? storeItem.member?.sellerLocalDeliveryPolicy;
  return !!(t && String(t).trim());
}

export function storeItemHasPickupPolicy(storeItem: {
  pickupTerms?: string | null;
  member?: { sellerPickupPolicy?: string | null } | null;
}): boolean {
  const t = storeItem.pickupTerms ?? storeItem.member?.sellerPickupPolicy;
  return !!(t && String(t).trim());
}

export function validatePickupLine(
  cart: { pickupDetails?: unknown } | null | undefined,
  storeItem: {
    pickupTerms?: string | null;
    member?: { sellerPickupPolicy?: string | null } | null;
  }
): { ok: true; pickupDetails: PickupDetailsJson } | { ok: false; error: string } {
  const pd = (cart?.pickupDetails ?? null) as PickupDetailsJson | null;
  if (!pd?.firstName?.trim() || !pd?.lastName?.trim() || !pd?.phone?.trim()) {
    return { ok: false, error: "Pickup requires first name, last name, and phone." };
  }
  if (!pd.preferredPickupDate?.trim() || !pd.preferredPickupTime?.trim()) {
    return { ok: false, error: "Pickup requires an estimated pickup date and time." };
  }
  if (storeItemHasPickupPolicy(storeItem) && !pd.termsAcceptedAt) {
    return { ok: false, error: "Pickup requires accepting the pickup policy." };
  }
  return { ok: true, pickupDetails: pd };
}

export function validateLocalDeliveryDetails(
  d: LocalDeliveryDetailsJson | null | undefined,
  options?: { requirePolicyAcceptance?: boolean }
): { ok: true; details: LocalDeliveryDetailsJson } | { ok: false; error: string } {
  if (
    !d ||
    !d.firstName?.trim() ||
    !d.lastName?.trim() ||
    !d.phone?.trim() ||
    !d.email?.trim() ||
    !d.deliveryAddress ||
    !d.deliveryAddress.street?.trim() ||
    !d.deliveryAddress.city?.trim() ||
    !d.deliveryAddress.state?.trim() ||
    !d.deliveryAddress.zip?.trim()
  ) {
    return {
      ok: false,
      error: "Local delivery requires name, phone, email, and a complete delivery address.",
    };
  }
  if (!d.availableDropOffTimes?.trim()) {
    return { ok: false, error: "Local delivery requires available drop-off times." };
  }
  if (options?.requirePolicyAcceptance && !d.termsAcceptedAt?.trim()) {
    return { ok: false, error: "Local delivery requires accepting the delivery policy." };
  }
  return { ok: true, details: d };
}
