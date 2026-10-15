"use client";

import { useState, useEffect } from "react";
import { getErrorMessage } from "@/lib/api-error";
import Link from "next/link";
import Image from "next/image";
import { useSession } from "next-auth/react";
import { useCart } from "@/contexts/CartContext";
import { LocalDeliveryModal, type LocalDeliveryDetails } from "@/components/LocalDeliveryModal";
import { PickupTermsModal, type PickupDetails } from "@/components/PickupTermsModal";
import { getAvailableQuantity } from "@/lib/store-item-variants";
import { formatCartVariantLabel } from "@/lib/cart-line-identity";
import { buildProductHref } from "@/lib/product-referrer";
import { IonIcon } from "@/components/IonIcon";
import { sellerOrderShippingCents, sellerOrderShippingQuote } from "@/lib/checkout-shipping-cost";

interface CartItemStoreItem {
  id: string;
  title: string;
  slug: string;
  photos: string[];
  priceCents: number;
  quantity: number;
  status: string;
  variants: unknown;
  memberId?: string;
  listingType?: "new" | "resale";
  shippingCostCents?: number | null;
  localDeliveryFeeCents?: number | null;
  localDeliveryAvailable?: boolean;
  inStorePickupAvailable?: boolean;
  shippingDisabled?: boolean;
  pickupTerms?: string | null;
  member?: {
    sellerLocalDeliveryPolicy?: string | null;
    sellerPickupPolicy?: string | null;
    combineShipping?: boolean;
    combinedShippingMaxCents?: number | null;
    freeShippingMinimumCents?: number | null;
  } | null;
}

interface CartItem {
  id: string;
  storeItemId: string;
  quantity: number;
  variant: unknown;
  buyerResponses?: unknown;
  fulfillmentType?: string | null;
  localDeliveryDetails?: LocalDeliveryDetails | null;
  pickupDetails?: PickupDetails & { termsAcceptedAt?: string } | null;
  storeItem: CartItemStoreItem;
  /** Server-resolved unit price (SKU or accepted resale offer); falls back to storeItem.priceCents when absent. */
  unitPriceCents?: number;
  resaleOfferId?: string | null;
  availableQuantity?: number;
  unavailableReason?: string;
}

function cartLineUnitPriceCents(item: CartItem): number {
  return typeof item.unitPriceCents === "number" ? item.unitPriceCents : item.storeItem.priceCents;
}

function cartShippingCents(list: CartItem[]): number {
  const groups = new Map<string, CartItem[]>();
  for (const item of list) {
    const sellerId = item.storeItem.memberId ?? item.storeItemId;
    const group = groups.get(sellerId) ?? [];
    group.push(item);
    groups.set(sellerId, group);
  }
  let cents = 0;
  for (const group of groups.values()) {
    const member = group[0]?.storeItem.member;
    cents += sellerOrderShippingCents({
      lines: group.map((item) => ({
        quantity: item.quantity,
        fulfillmentType: item.fulfillmentType,
        shippingCostCents: item.storeItem.shippingCostCents,
      })),
      merchandiseCents: group.reduce((sum, item) => sum + cartLineUnitPriceCents(item) * item.quantity, 0),
      rules: {
        combineShipping: Boolean(member?.combineShipping),
        combinedShippingMaxCents: member?.combinedShippingMaxCents ?? null,
        freeShippingMinimumCents: member?.freeShippingMinimumCents ?? null,
      },
    });
  }
  return cents;
}

function sellerShippingArgs(group: CartItem[]) {
  const member = group[0]?.storeItem.member;
  return {
    lines: group.map((item) => ({
      quantity: item.quantity,
      fulfillmentType: item.fulfillmentType,
      shippingCostCents: item.storeItem.shippingCostCents,
    })),
    merchandiseCents: group.reduce((sum, item) => sum + cartLineUnitPriceCents(item) * item.quantity, 0),
    rules: {
      combineShipping: Boolean(member?.combineShipping),
      combinedShippingMaxCents: member?.combinedShippingMaxCents ?? null,
      freeShippingMinimumCents: member?.freeShippingMinimumCents ?? null,
    },
  };
}

function cartLineMaxQty(item: CartItem): number {
  if (typeof item.availableQuantity === "number") return Math.max(0, item.availableQuantity);
  return getAvailableQuantity(item.storeItem, item.variant ?? undefined);
}

type FulfillmentType = "ship" | "local_delivery" | "pickup";

function getItemProductUrl(item: CartItem): string {
  return buildProductHref(item.storeItem.slug, { type: "cart" });
}

function refetchCart(): Promise<CartItem[]> {
  return fetch("/api/cart")
    .then((r) => r.json())
    .then((d) => (Array.isArray(d) ? d : []));
}

export default function CartPage() {
  const { data: session, status } = useSession();
  const { refresh } = useCart();
  const [items, setItems] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkingOut, setCheckingOut] = useState(false);
  const [error, setError] = useState("");
  const [localDeliveryModalItemId, setLocalDeliveryModalItemId] = useState<string | null>(null);
  const [pickupTermsModalItemId, setPickupTermsModalItemId] = useState<string | null>(null);

  function loadCart() {
    refetchCart().then((arr) => {
      setItems(arr);
      refresh();
    });
  }

  useEffect(() => {
    if (status === "unauthenticated") {
      setLoading(false);
      return;
    }
    refetchCart()
      .then((arr) => {
        setItems(arr);
        refresh();
      })
      .catch(() => {
        setItems([]);
        refresh();
      })
      .finally(() => setLoading(false));
  }, [status]);

  async function removeItem(itemId: string) {
    const res = await fetch(`/api/cart/${itemId}`, { method: "DELETE" });
    if (res.ok) {
      setItems((prev) => prev.filter((i) => i.id !== itemId));
      refresh();
    }
  }

  async function updateQuantity(itemId: string, quantity: number) {
    const res = await fetch(`/api/cart/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantity }),
    });
    if (res.ok) {
      setItems((prev) =>
        prev.map((i) => (i.id === itemId ? { ...i, quantity } : i))
      );
      refresh();
    }
  }

  async function updateFulfillment(
    itemId: string,
    fulfillmentType: FulfillmentType,
    localDeliveryDetails?: LocalDeliveryDetails & { termsAcceptedAt?: string },
    pickupDetails?: PickupDetails & { termsAcceptedAt?: string }
  ) {
    const body: { fulfillmentType: FulfillmentType; localDeliveryDetails?: object; pickupDetails?: object } = {
      fulfillmentType,
    };
    if (fulfillmentType === "local_delivery" && localDeliveryDetails) {
      body.localDeliveryDetails = localDeliveryDetails;
    }
    if (fulfillmentType === "pickup" && pickupDetails) {
      body.pickupDetails = pickupDetails;
    }
    const res = await fetch(`/api/cart/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      loadCart();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(getErrorMessage((data as { error?: string }).error, "Could not update fulfillment"));
    }
  }

  async function updatePickupDetails(
    itemId: string,
    pickupDetails: PickupDetails & { termsAcceptedAt?: string }
  ) {
    const res = await fetch(`/api/cart/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pickupDetails, fulfillmentType: "pickup" }),
    });
    if (res.ok) {
      loadCart();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(getErrorMessage((data as { error?: string }).error, "Could not save pickup details"));
    }
  }

  const hasLocalDelivery = items.some((i) => i.fulfillmentType === "local_delivery");
  const localDeliveryItems = items.filter((i) => i.fulfillmentType === "local_delivery");
  const localDeliveryDetailsForCheckout = hasLocalDelivery
    ? items.find((i) => i.fulfillmentType === "local_delivery" && i.localDeliveryDetails)?.localDeliveryDetails
    : undefined;
  const localDeliveryFormComplete =
    localDeliveryItems.length === 0 ||
    localDeliveryItems.every(
      (i) =>
        i.localDeliveryDetails?.firstName?.trim() &&
        i.localDeliveryDetails?.lastName?.trim() &&
        i.localDeliveryDetails?.phone?.trim() &&
        i.localDeliveryDetails?.email?.trim() &&
        i.localDeliveryDetails?.deliveryAddress?.street?.trim() &&
        i.localDeliveryDetails?.deliveryAddress?.city?.trim() &&
        i.localDeliveryDetails?.deliveryAddress?.state?.trim() &&
        i.localDeliveryDetails?.deliveryAddress?.zip?.trim() &&
        i.localDeliveryDetails?.availableDropOffTimes?.trim()
    );
  const pickupItems = items.filter((i) => i.fulfillmentType === "pickup");
  const pickupItemsWithPolicy = pickupItems.filter(
    (i) =>
      (i.storeItem.pickupTerms ?? i.storeItem.member?.sellerPickupPolicy) &&
      String(i.storeItem.pickupTerms ?? i.storeItem.member?.sellerPickupPolicy).trim()
  );
  const allPickupDetailsFilled =
    pickupItems.length === 0 ||
    pickupItems.every(
      (i) =>
        i.pickupDetails?.firstName?.trim() &&
        i.pickupDetails?.lastName?.trim() &&
        i.pickupDetails?.phone?.trim() &&
        i.pickupDetails?.preferredPickupDate?.trim() &&
        i.pickupDetails?.preferredPickupTime?.trim()
    );
  const allPickupTermsAgreed =
    pickupItemsWithPolicy.length === 0 ||
    pickupItemsWithPolicy.every((i) => i.pickupDetails?.termsAcceptedAt);
  const hasShippedItem = items.some((i) => (i.fulfillmentType ?? "ship") === "ship");
  const hasUnavailableItems = items.some((i) => i.unavailableReason);
  const canCheckout =
    !hasUnavailableItems &&
    localDeliveryFormComplete &&
    allPickupDetailsFilled &&
    allPickupTermsAgreed;

  /** All items are charged through Stripe at checkout. */
  const cardItems = items;

  async function handleCheckout() {
    if (items.length === 0) return;
    if (hasLocalDelivery && !localDeliveryFormComplete) {
      setError(
        "Complete delivery details for local delivery items (use “Edit delivery” on each item)."
      );
      return;
    }
    if (!allPickupDetailsFilled || !allPickupTermsAgreed) {
      setError(
        "Complete the Pick Up Form for pickup items (use “Add pickup details” or “Edit pickup details” on each item)."
      );
      return;
    }
    setError("");
    setCheckingOut(true);
    try {
      const makePayload = (list: CartItem[]) => ({
        items: list.map((i) => ({
          storeItemId: i.storeItemId,
          quantity: i.quantity,
          variant: i.variant ?? undefined,
          fulfillmentType: i.fulfillmentType ?? "ship",
          buyerResponses: i.buyerResponses ?? undefined,
        })),
        localDeliveryDetails: localDeliveryDetailsForCheckout ?? undefined,
      });

      const hasShippedCardItem = cardItems.some((i) => (i.fulfillmentType ?? "ship") === "ship");
      const shippingCostCents = cartShippingCents(cardItems);
      const stripeBody: Record<string, unknown> = {
        ...makePayload(cardItems),
        shippingCostCents,
      };
      if (hasShippedCardItem) {
        stripeBody.shippingCollectedByStripe = true;
      }
      if (typeof window !== "undefined") stripeBody.returnBaseUrl = window.location.origin;

      const res = await fetch("/api/stripe/storefront-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(stripeBody),
        credentials: "include",
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok) {
        const msg = res.status === 401
          ? "Your session has expired. Please sign in again to complete checkout."
          : getErrorMessage(data.error, "Checkout failed");
        setError(msg);
        return;
      }
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError(getErrorMessage(data.error, "Checkout could not be started."));
      }
    } finally {
      setCheckingOut(false);
    }
  }

  const subtotalCents = items.reduce((sum, i) => sum + cartLineUnitPriceCents(i) * i.quantity, 0);
  const shippingCostCents = cartShippingCents(items);
  const localDeliveryFeeCents = items.reduce((sum, i) => {
    if (
      i.fulfillmentType === "local_delivery" &&
      i.storeItem?.localDeliveryFeeCents != null &&
      i.storeItem.localDeliveryFeeCents > 0
    ) {
      return sum + i.storeItem.localDeliveryFeeCents * i.quantity;
    }
    return sum;
  }, 0);
  const totalCents = subtotalCents + shippingCostCents + localDeliveryFeeCents;

  const itemForModal = localDeliveryModalItemId
    ? items.find((i) => i.id === localDeliveryModalItemId)
    : null;
  const itemForPickupModal = pickupTermsModalItemId
    ? items.find((i) => i.id === pickupTermsModalItemId)
    : null;

  if (status === "loading" || loading) {
    return (
      <section style={{ padding: "var(--section-padding)" }}>
        <div className="max-w-[var(--max-width)] mx-auto">
          <p style={{ color: "var(--color-text)" }}>Loading…</p>
        </div>
      </section>
    );
  }

  if (status === "unauthenticated") {
    return (
      <section style={{ padding: "var(--section-padding)" }}>
        <div className="max-w-[var(--max-width)] mx-auto text-center">
          <h1
            className="text-2xl font-bold mb-4"
            style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
          >
            Your Cart
          </h1>
          <p className="mb-6" style={{ color: "var(--color-text)" }}>
            Sign in to view your cart and checkout.
          </p>
          <Link href="/login?callbackUrl=/cart" className="btn">
            Sign in
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section style={{ padding: "var(--section-padding)" }} className="overflow-x-hidden">
      <div className="max-w-[var(--max-width)] mx-auto min-w-0">
        {items.length === 0 ? (
          <div className="text-center">
            <h1
              className="text-2xl font-bold mb-4"
              style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
            >
              Your Cart
            </h1>
            <p className="mb-6" style={{ color: "var(--color-text)" }}>
              Your cart is empty.
            </p>
            <Link href="/storefront" className="btn">
              Continue Shopping
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-[1fr,400px] gap-4 sm:gap-6 md:gap-8 lg:gap-12">
            {/* Left column: logo + items */}
            <div className="min-w-0">
              <div className="flex justify-center mb-4 sm:mb-8">
                <Image
                  src="/nwc-logo-circle.png"
                  alt="Northwest Community"
                  width={160}
                  height={160}
                  className="object-contain w-20 h-20 sm:w-28 sm:h-28 md:w-40 md:h-40"
                />
              </div>
              {hasUnavailableItems && (
                <div
                  className="rounded-lg border p-4 mb-4"
                  style={{ borderColor: "var(--color-primary)", backgroundColor: "var(--color-section-alt)" }}
                >
                  <p className="text-sm font-medium" style={{ color: "var(--color-heading)" }}>
                    Some items can&apos;t be purchased right now. Remove them or fix the issue to checkout.
                  </p>
                </div>
              )}
              <h2
                className="text-xl font-semibold mb-4"
                style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
              >
                Items in your cart
              </h2>
              <div className="space-y-6">
                <div className="space-y-4">
                  {items.map((item) => {
                    const variantLabel = formatCartVariantLabel(item.variant);
                    const sellerId = item.storeItem.memberId ?? item.storeItemId;
                    const sellerGroup = items.filter(
                      (row) => (row.storeItem.memberId ?? row.storeItemId) === sellerId
                    );
                    const shippingArgs = sellerShippingArgs(sellerGroup);
                    const shippingQuote = sellerOrderShippingQuote(shippingArgs);
                    const isSellerLead = sellerGroup[0]?.id === item.id;
                    const freeShippingMinimumCents = shippingArgs.rules.freeShippingMinimumCents ?? 0;
                    const freeShippingReached =
                      freeShippingMinimumCents > 0 &&
                      shippingArgs.merchandiseCents >= freeShippingMinimumCents;
                    const shippedLines = sellerGroup.filter(
                      (row) => (row.fulfillmentType ?? "ship") === "ship"
                    );
                    return (
                        <div
                          key={item.id}
                          className="rounded-lg border p-4"
                          style={{
                            borderColor: "var(--color-primary)",
                            backgroundColor: "var(--color-background)",
                          }}
                        >
                          {item.unavailableReason && (
                            <p className="text-sm font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mb-2">
                              {item.unavailableReason}
                            </p>
                          )}
                          <div className="flex gap-3">
                            {item.storeItem.photos[0] ? (
                              <img
                                src={item.storeItem.photos[0]}
                                alt=""
                                className="w-20 h-20 object-cover rounded shrink-0"
                                style={{ borderColor: "var(--color-primary)" }}
                              />
                            ) : (
                              <div
                                className="w-20 h-20 rounded flex items-center justify-center text-xs shrink-0"
                                style={{
                                  backgroundColor: "var(--color-section-alt)",
                                  color: "var(--color-text)",
                                }}
                              >
                                No image
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <Link
                                href={getItemProductUrl(item)}
                                className="font-medium hover:underline text-sm"
                                style={{ color: "var(--color-link)" }}
                              >
                                {item.storeItem.title}
                              </Link>
                              {variantLabel ? (
                                <p className="text-xs text-gray-500 mt-0.5">
                                  {variantLabel}
                                </p>
                              ) : null}
                        <p
                          className="text-base font-bold mt-0.5"
                          style={{ color: "var(--color-heading)" }}
                        >
                          ${((cartLineUnitPriceCents(item) * item.quantity) / 100).toFixed(2)}
                          {item.resaleOfferId ? (
                            <span className="block text-xs font-normal text-gray-500 mt-0.5">
                              Agreed offer (list ${(item.storeItem.priceCents / 100).toFixed(2)})
                            </span>
                          ) : null}
                          {item.fulfillmentType === "ship" &&
                            shippingQuote.cents > 0 &&
                            (shippedLines.length === 1
                              ? shippedLines[0]?.id === item.id
                              : isSellerLead && shippingQuote.combinedCapApplied) && (
                              <span className="text-sm font-normal ml-1" style={{ color: "var(--color-text)" }}>
                                + ${(shippingQuote.cents / 100).toFixed(2)}{" "}
                                {shippingQuote.combinedCapApplied ? "combined shipping" : "shipping"}
                              </span>
                            )}
                          {item.fulfillmentType === "local_delivery" &&
                            item.storeItem.localDeliveryFeeCents != null &&
                            item.storeItem.localDeliveryFeeCents > 0 && (
                              <span className="text-sm font-normal ml-1" style={{ color: "var(--color-text)" }}>
                                + ${((item.storeItem.localDeliveryFeeCents * item.quantity) / 100).toFixed(2)} delivery
                              </span>
                            )}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <label className="sr-only">Quantity</label>
                        <input
                          type="number"
                          min={1}
                          max={cartLineMaxQty(item)}
                          value={item.quantity}
                          onChange={(e) => {
                            const q = parseInt(e.target.value, 10) || 1;
                            const max = cartLineMaxQty(item);
                            updateQuantity(item.id, Math.min(q, max));
                          }}
                          className="w-12 border rounded px-1 py-1 text-center text-sm"
                          style={{ borderColor: "var(--color-primary)" }}
                        />
                        <button
                          type="button"
                          onClick={() => removeItem(item.id)}
                          className="text-sm hover:underline"
                          style={{ color: "var(--color-primary)" }}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                    {isSellerLead && freeShippingMinimumCents > 0 && (
                      <div
                        className="mt-3 inline-flex w-fit max-w-[260px] items-center gap-1.5 rounded px-2 py-1 text-white"
                        style={{ backgroundColor: "var(--color-earth)" }}
                      >
                        <IonIcon name="gift-outline" size={13} className="shrink-0 text-white" />
                        <p className="text-[11px] font-medium leading-tight">
                          {freeShippingReached
                            ? "Free Shipping Enabled!"
                            : `If you order $${(freeShippingMinimumCents / 100).toFixed(2)} from this store, you will receive free shipping.`}
                        </p>
                        <IonIcon name="gift-outline" size={13} className="shrink-0 text-white" />
                      </div>
                    )}
                  </div>
                  );
                  })}
                </div>
              </div>
            </div>

            {/* Right column: summary, shipping, payment */}
            <div>
              <div
                className="rounded-lg border p-6 sticky top-4"
                style={{
                  borderColor: "var(--color-primary)",
                  backgroundColor: "var(--color-background)",
                }}
              >
                <h2
                  className="text-xl font-semibold mb-4"
                  style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
                >
                  Order Summary
                </h2>
                <div className="space-y-2 mb-4" style={{ color: "var(--color-text)" }}>
                  <div className="flex justify-between text-sm">
                    <span>Subtotal</span>
                    <span>${(subtotalCents / 100).toFixed(2)}</span>
                  </div>
                  {shippingCostCents > 0 && (
                    <div className="flex justify-between text-sm">
                      <span>Shipping</span>
                      <span>${(shippingCostCents / 100).toFixed(2)}</span>
                    </div>
                  )}
                  {localDeliveryFeeCents > 0 && (
                    <div className="flex justify-between text-sm">
                      <span>Local delivery</span>
                      <span>${(localDeliveryFeeCents / 100).toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold pt-2 border-t" style={{ borderColor: "var(--color-section-alt)" }}>
                    <span>Total</span>
                    <span>${(totalCents / 100).toFixed(2)}</span>
                  </div>
                  <p className="text-xs" style={{ color: "var(--color-text)" }}>
                    Tax is calculated at checkout.
                  </p>
                </div>

                <p className="text-xs mb-4" style={{ color: "var(--color-text)" }}>
                  Pay with Card, Google Pay, or Apple Pay on the next screen.
                  {hasShippedItem ? " You’ll enter your shipping address there." : ""}
                </p>

                {error && (
                  <div className="mb-2">
                    <p className="text-sm mb-2" style={{ color: "var(--color-primary)" }}>
                      {error}
                    </p>
                    {(error.toLowerCase().includes("session") || error.toLowerCase().includes("sign in")) && (
                      <Link
                        href="/login?callbackUrl=/cart"
                        className="text-sm font-medium underline"
                        style={{ color: "var(--color-primary)" }}
                      >
                        Sign in to continue
                      </Link>
                    )}
                  </div>
                )}
                {hasLocalDelivery && !localDeliveryFormComplete && (
                  <p className="text-sm mb-2" style={{ color: "var(--color-primary)" }}>
                    Complete delivery details for local delivery items before checkout.
                  </p>
                )}
                {hasUnavailableItems && (
                  <p className="text-sm mb-2" style={{ color: "var(--color-primary)" }}>
                    Remove unavailable items or fix issues above to checkout.
                  </p>
                )}

                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={handleCheckout}
                    disabled={checkingOut || !canCheckout}
                    className="btn disabled:cursor-not-allowed"
                    style={{ opacity: 1 }}
                  >
                    {checkingOut ? "Redirecting…" : "Proceed to Checkout"}
                  </button>
                  <Link
                    href="/storefront"
                    className="border rounded px-4 py-2 text-center text-sm"
                    style={{
                      opacity: 1,
                      borderColor: "var(--color-primary)",
                      color: "var(--color-text)",
                      backgroundColor: "var(--color-background)",
                    }}
                  >
                    Continue Shopping
                  </Link>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <LocalDeliveryModal
        open={!!localDeliveryModalItemId && !!itemForModal}
        onClose={() => setLocalDeliveryModalItemId(null)}
        policyText={itemForModal?.storeItem.member?.sellerLocalDeliveryPolicy ?? undefined}
        initialForm={
          itemForModal?.localDeliveryDetails
            ? {
                firstName: itemForModal.localDeliveryDetails.firstName ?? "",
                lastName: itemForModal.localDeliveryDetails.lastName ?? "",
                phone: itemForModal.localDeliveryDetails.phone ?? "",
                email: itemForModal.localDeliveryDetails.email ?? "",
                deliveryAddress: {
                  street: itemForModal.localDeliveryDetails.deliveryAddress?.street ?? "",
                  city: itemForModal.localDeliveryDetails.deliveryAddress?.city ?? "",
                  state: itemForModal.localDeliveryDetails.deliveryAddress?.state ?? "",
                  zip: itemForModal.localDeliveryDetails.deliveryAddress?.zip ?? "",
                },
                availableDropOffTimes: itemForModal.localDeliveryDetails.availableDropOffTimes ?? "",
                note: itemForModal.localDeliveryDetails.note ?? "",
              }
            : undefined
        }
        onSave={(form) => {
          if (!localDeliveryModalItemId) return;
          updateFulfillment(localDeliveryModalItemId, "local_delivery", form);
          setLocalDeliveryModalItemId(null);
        }}
      />
      <PickupTermsModal
        open={!!pickupTermsModalItemId && !!itemForPickupModal}
        onClose={() => setPickupTermsModalItemId(null)}
        policyText={itemForPickupModal?.storeItem.pickupTerms ?? itemForPickupModal?.storeItem.member?.sellerPickupPolicy ?? undefined}
        initialForm={
          itemForPickupModal?.pickupDetails
            ? {
                firstName: itemForPickupModal.pickupDetails.firstName ?? "",
                lastName: itemForPickupModal.pickupDetails.lastName ?? "",
                phone: itemForPickupModal.pickupDetails.phone ?? "",
                email: itemForPickupModal.pickupDetails.email ?? "",
                preferredPickupDate: itemForPickupModal.pickupDetails.preferredPickupDate ?? "",
                preferredPickupTime: itemForPickupModal.pickupDetails.preferredPickupTime ?? "",
                note: itemForPickupModal.pickupDetails.note ?? "",
                termsAcceptedAt: itemForPickupModal.pickupDetails.termsAcceptedAt,
              }
            : undefined
        }
        onSave={(form) => {
          if (!pickupTermsModalItemId) return;
          updatePickupDetails(pickupTermsModalItemId, form);
          setPickupTermsModalItemId(null);
        }}
      />
    </section>
  );
}
