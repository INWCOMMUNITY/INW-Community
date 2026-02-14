"use client";

import { useState, useEffect } from "react";
import { getErrorMessage } from "@/lib/api-error";
import Link from "next/link";
import Image from "next/image";
import { useSession } from "next-auth/react";
import { useCart } from "@/contexts/CartContext";
import { LocalDeliveryModal, type LocalDeliveryDetails } from "@/components/LocalDeliveryModal";
import { PickupTermsModal, type PickupDetails } from "@/components/PickupTermsModal";

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
    acceptCashForPickupDelivery?: boolean;
    sellerLocalDeliveryPolicy?: string | null;
    sellerPickupPolicy?: string | null;
  } | null;
}

interface CartItem {
  id: string;
  storeItemId: string;
  quantity: number;
  variant: unknown;
  fulfillmentType?: string | null;
  localDeliveryDetails?: LocalDeliveryDetails | null;
  pickupDetails?: PickupDetails & { termsAcceptedAt?: string } | null;
  storeItem: CartItemStoreItem;
}

type FulfillmentType = "ship" | "local_delivery" | "pickup";

const emptyShippingAddress = { street: "", aptOrSuite: "", city: "", state: "", zip: "" };

type ListingCategory = "new" | "resale";
const CATEGORY_LABELS: Record<ListingCategory, string> = {
  new: "Main Store",
  resale: "Community Resale",
};
function getItemProductUrl(item: CartItem): string {
  const base = item.storeItem.listingType === "resale" ? "/resale" : "/storefront";
  return `${base}/${item.storeItem.slug}`;
}
function groupItemsByCategory(items: CartItem[]): { category: ListingCategory; items: CartItem[] }[] {
  const groups: { category: ListingCategory; items: CartItem[] }[] = [];
  const newItems = items.filter((i) => (i.storeItem.listingType ?? "new") === "new");
  const resaleItems = items.filter((i) => i.storeItem.listingType === "resale");
  if (newItems.length > 0) groups.push({ category: "new", items: newItems });
  if (resaleItems.length > 0) groups.push({ category: "resale", items: resaleItems });
  return groups;
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
  const [paymentMethod, setPaymentMethod] = useState<"card" | "cash">("card");
  /** Per-item payment for pickup/local: only those items are charged at checkout when "card"; "cash" items are not charged. */
  const [paymentMethodByItemId, setPaymentMethodByItemId] = useState<Record<string, "card" | "cash">>({});
  const [localDeliveryModalItemId, setLocalDeliveryModalItemId] = useState<string | null>(null);
  const [pickupTermsModalItemId, setPickupTermsModalItemId] = useState<string | null>(null);
  const [shippingAddress, setShippingAddress] = useState(emptyShippingAddress);

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
  const localDeliveryDetailsForCheckout = hasLocalDelivery
    ? items.find((i) => i.fulfillmentType === "local_delivery" && i.localDeliveryDetails)?.localDeliveryDetails
    : undefined;
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
        i.pickupDetails?.phone?.trim()
    );
  const allPickupTermsAgreed =
    pickupItemsWithPolicy.length === 0 ||
    pickupItemsWithPolicy.every((i) => i.pickupDetails?.termsAcceptedAt);
  const hasShippedItem = items.some((i) => (i.fulfillmentType ?? "ship") === "ship");
  const shippingValid =
    !hasShippedItem ||
    (shippingAddress.street.trim() &&
      shippingAddress.city.trim() &&
      shippingAddress.state.trim() &&
      shippingAddress.zip.trim());
  const canCheckout =
    (!hasLocalDelivery || (hasLocalDelivery && localDeliveryDetailsForCheckout)) &&
    allPickupDetailsFilled &&
    allPickupTermsAgreed &&
    shippingValid;

  const allPickupOrLocalDelivery =
    items.length > 0 &&
    items.every(
      (i) => i.fulfillmentType === "pickup" || i.fulfillmentType === "local_delivery"
    );
  const allSellersAcceptCash =
    items.length > 0 &&
    items.every((i) => i.storeItem.member?.acceptCashForPickupDelivery !== false);
  const showPayInCash = allPickupOrLocalDelivery && allSellersAcceptCash;

  /** Items paid in cash: no charge at checkout; they pay at pickup/delivery. */
  const cashItems = items.filter(
    (i) =>
      (i.fulfillmentType === "pickup" || i.fulfillmentType === "local_delivery") &&
      (paymentMethodByItemId[i.id] ?? "cash") === "cash" &&
      i.storeItem.member?.acceptCashForPickupDelivery !== false
  );
  const cardItems = items.filter((i) => !cashItems.includes(i));

  async function handleCheckout() {
    if (items.length === 0) return;
    if (hasLocalDelivery && !localDeliveryDetailsForCheckout) {
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
    if (hasShippedItem && !shippingValid) {
      setError("Please enter your full shipping address.");
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
        })),
        localDeliveryDetails: localDeliveryDetailsForCheckout ?? undefined,
      });

      // Only cash items: create orders, no payment collected at checkout.
      if (cardItems.length === 0 && cashItems.length > 0) {
        const res = await fetch("/api/store-orders/cash-checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(makePayload(cashItems)),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(getErrorMessage(data.error, "Checkout failed"));
          return;
        }
        if (data.url) {
          window.location.href = data.url;
        }
        return;
      }

      let cashOrderIds: string[] | undefined;
      if (cashItems.length > 0) {
        const res = await fetch("/api/store-orders/cash-checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(makePayload(cashItems)),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(getErrorMessage(data.error, "Checkout failed"));
          return;
        }
        cashOrderIds = data.orderIds ?? [];
        for (const item of cashItems) {
          await fetch(`/api/cart/${item.id}`, { method: "DELETE" });
        }
        refresh();
      }

      if (cardItems.length === 0) {
        setCheckingOut(false);
        return;
      }

      const shippingCostCents = cardItems.reduce((sum, i) => {
        if (i.fulfillmentType === "ship" && i.storeItem?.shippingCostCents != null) {
          return sum + i.storeItem.shippingCostCents * i.quantity;
        }
        return sum;
      }, 0);
      const stripeBody: Record<string, unknown> = {
        ...makePayload(cardItems),
        shippingCostCents,
      };
      if (cashOrderIds?.length) stripeBody.cashOrderIds = cashOrderIds;
      if (cardItems.some((i) => (i.fulfillmentType ?? "ship") === "ship")) {
        stripeBody.shippingAddress = shippingAddress;
      }

      const useEmbeddedCheckout = !!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim();
      if (!useEmbeddedCheckout) {
        // Publishable key not set: use Stripe Checkout redirect so payment still works
        const res = await fetch("/api/stripe/storefront-checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(stripeBody),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(getErrorMessage(data.error, "Checkout failed"));
          return;
        }
        if (data.url) {
          window.location.href = data.url;
        } else {
          setError("Checkout could not be started.");
        }
        return;
      }

      const res = await fetch("/api/stripe/storefront-checkout-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(stripeBody),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(getErrorMessage(data.error, "Checkout failed"));
        return;
      }
      if (data.clientSecret && data.summary && data.orderIds?.length) {
        try {
          sessionStorage.setItem(
            "storefront_checkout",
            JSON.stringify({
              clientSecret: data.clientSecret,
              orderIds: data.orderIds,
              summary: data.summary,
              successUrl: data.successUrl,
            })
          );
        } catch {
          setError("Could not start checkout.");
          return;
        }
        window.location.href = "/storefront/checkout";
      }
    } finally {
      setCheckingOut(false);
    }
  }

  const subtotalCents = items.reduce(
    (sum, i) => sum + i.storeItem.priceCents * i.quantity,
    0
  );
  const shippingCostCents = items.reduce((sum, i) => {
    if (i.fulfillmentType === "ship" && i.storeItem?.shippingCostCents != null) {
      return sum + i.storeItem.shippingCostCents * i.quantity;
    }
    return sum;
  }, 0);
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

  const cardSubtotalCents = cardItems.reduce((sum, i) => sum + i.storeItem.priceCents * i.quantity, 0);
  const cardShippingCents = cardItems.reduce((sum, i) => {
    if (i.fulfillmentType === "ship" && i.storeItem?.shippingCostCents != null) {
      return sum + i.storeItem.shippingCostCents * i.quantity;
    }
    return sum;
  }, 0);
  const cardLocalDeliveryCents = cardItems.reduce((sum, i) => {
    if (i.fulfillmentType === "local_delivery" && i.storeItem?.localDeliveryFeeCents != null && i.storeItem.localDeliveryFeeCents > 0) {
      return sum + i.storeItem.localDeliveryFeeCents * i.quantity;
    }
    return sum;
  }, 0);
  const cardTotalCents = cardSubtotalCents + cardShippingCents + cardLocalDeliveryCents;
  const cashTotalCents = cashItems.reduce((sum, i) => {
    let s = i.storeItem.priceCents * i.quantity;
    if (i.fulfillmentType === "local_delivery" && i.storeItem?.localDeliveryFeeCents != null && i.storeItem.localDeliveryFeeCents > 0) {
      s += i.storeItem.localDeliveryFeeCents * i.quantity;
    }
    return sum + s;
  }, 0);
  const hasMixedPayment = cashItems.length > 0 && cardItems.length > 0;

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
              <h2
                className="text-xl font-semibold mb-4"
                style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
              >
                Items in your cart
              </h2>
              <div className="space-y-6">
                {groupItemsByCategory(items).map(({ category, items: groupItems }) => (
                  <div key={category}>
                    <div
                      className="flex items-center gap-3 mb-3"
                      style={{ color: "var(--color-heading)" }}
                    >
                      <span
                        className="text-sm font-semibold uppercase tracking-wide"
                        style={{ color: "var(--color-primary)" }}
                      >
                        {CATEGORY_LABELS[category]}
                      </span>
                      <span
                        className="flex-1 h-px shrink-0"
                        style={{ backgroundColor: "var(--color-section-alt)" }}
                      />
                    </div>
                    <div className="space-y-4">
                      {groupItems.map((item) => (
                        <div
                          key={item.id}
                          className="rounded-lg border p-4"
                          style={{
                            borderColor: "var(--color-primary)",
                            backgroundColor: "var(--color-background)",
                          }}
                        >
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
                        <p
                          className="text-base font-bold mt-0.5"
                          style={{ color: "var(--color-heading)" }}
                        >
                          ${((item.storeItem.priceCents * item.quantity) / 100).toFixed(2)}
                          {(item.fulfillmentType === "ship" &&
                            item.storeItem.shippingCostCents != null &&
                            item.storeItem.shippingCostCents > 0) && (
                            <span className="text-sm font-normal ml-1" style={{ color: "var(--color-text)" }}>
                              + ${((item.storeItem.shippingCostCents * item.quantity) / 100).toFixed(2)} shipping
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
                          max={item.storeItem.quantity}
                          value={item.quantity}
                          onChange={(e) => {
                            const q = parseInt(e.target.value, 10) || 1;
                            updateQuantity(item.id, Math.min(q, item.storeItem.quantity));
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
                    {/* Fulfillment options: only show options this item actually offers (product page can show all) */}
                    {(() => {
                      // Use truthy checks so we show options when API returns true, 1, etc.
                      const offersShipping = item.storeItem.shippingDisabled !== true;
                      const offersLocalDelivery = !!item.storeItem.localDeliveryAvailable;
                      const offersPickup = !!item.storeItem.inStorePickupAvailable;
                      const hasAnyOption = offersShipping || offersLocalDelivery || offersPickup;
                      // If no option detected (e.g. missing data), show all so user can still select
                      const showShipping = hasAnyOption ? offersShipping : true;
                      const showLocalDelivery = hasAnyOption ? offersLocalDelivery : true;
                      const showPickup = hasAnyOption ? offersPickup : true;
                      return (
                    <div className="mt-3 pt-3 border-t" style={{ borderColor: "var(--color-section-alt)", pointerEvents: "auto" }}>
                      <p className="text-sm font-medium mb-2" style={{ color: "var(--color-text)" }}>
                        How do you want to receive this item?
                      </p>
                      <div className="flex flex-wrap gap-2" role="group" aria-label="Fulfillment option">
                        {showShipping && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              updateFulfillment(item.id, "ship");
                            }}
                            className="border rounded px-3 py-1.5 text-sm cursor-pointer"
                            style={{
                              opacity: 1,
                              ...((item.fulfillmentType ?? "ship") === "ship"
                                ? {
                                    borderColor: "var(--color-primary)",
                                    backgroundColor: "var(--color-section-alt)",
                                    color: "var(--color-primary)",
                                  }
                                : { borderColor: "var(--color-primary)" }),
                            }}
                          >
                            Ship
                            {item.storeItem.shippingCostCents != null && item.storeItem.shippingCostCents > 0
                              ? ` ($${(item.storeItem.shippingCostCents / 100).toFixed(2)})`
                              : " (free)"}
                          </button>
                        )}
                        {showLocalDelivery && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setLocalDeliveryModalItemId(item.id);
                            }}
                            className="border rounded px-3 py-1.5 text-sm cursor-pointer"
                            style={{
                              opacity: 1,
                              ...(item.fulfillmentType === "local_delivery"
                                ? {
                                    borderColor: "var(--color-primary)",
                                    backgroundColor: "var(--color-section-alt)",
                                    color: "var(--color-primary)",
                                  }
                                : { borderColor: "var(--color-primary)" }),
                            }}
                          >
                            Deliver locally
                            {item.storeItem.localDeliveryFeeCents != null && item.storeItem.localDeliveryFeeCents > 0
                              ? ` ($${(item.storeItem.localDeliveryFeeCents / 100).toFixed(2)})`
                              : " (no fee)"}
                          </button>
                        )}
                        {showPickup && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setPickupTermsModalItemId(item.id);
                            }}
                            className="border rounded px-3 py-1.5 text-sm cursor-pointer"
                            style={{
                              opacity: 1,
                              ...(item.fulfillmentType === "pickup"
                                ? {
                                    borderColor: "var(--color-primary)",
                                    backgroundColor: "var(--color-section-alt)",
                                    color: "var(--color-primary)",
                                  }
                                : { borderColor: "var(--color-primary)" }),
                            }}
                          >
                            Pickup
                          </button>
                        )}
                      </div>
                      {item.fulfillmentType === "local_delivery" && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setLocalDeliveryModalItemId(item.id);
                          }}
                          className="text-sm mt-1 hover:underline block cursor-pointer"
                          style={{ color: "var(--color-link)", opacity: 1 }}
                        >
                          {item.localDeliveryDetails ? "Edit delivery details" : "Add delivery details"}
                        </button>
                      )}
                      {item.fulfillmentType === "pickup" && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setPickupTermsModalItemId(item.id);
                          }}
                          className="text-sm mt-1 hover:underline block cursor-pointer"
                          style={{ color: "var(--color-link)", opacity: 1 }}
                        >
                          {item.pickupDetails?.firstName ? "Edit pickup details" : "Add pickup details"}
                        </button>
                      )}
                      {/* Payment options for pickup / local delivery — cash = no charge at checkout */}
                      {(item.fulfillmentType === "pickup" || item.fulfillmentType === "local_delivery") &&
                        item.storeItem.member?.acceptCashForPickupDelivery !== false && (
                          <div className="mt-3 pt-3 border-t" style={{ borderColor: "var(--color-section-alt)" }}>
                            <p className="text-sm font-medium mb-2" style={{ color: "var(--color-text)" }}>
                              Payment for this item
                            </p>
                            <div className="flex flex-wrap gap-4">
                              <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                  type="radio"
                                  name={`payment-${item.id}`}
                                  checked={(paymentMethodByItemId[item.id] ?? "cash") === "card"}
                                  onChange={() => setPaymentMethodByItemId((prev) => ({ ...prev, [item.id]: "card" }))}
                                  className="rounded"
                                  style={{ accentColor: "var(--color-primary)" }}
                                />
                                <span className="text-sm" style={{ color: "var(--color-text)" }}>
                                  Card (charged now)
                                </span>
                              </label>
                              <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                  type="radio"
                                  name={`payment-${item.id}`}
                                  checked={(paymentMethodByItemId[item.id] ?? "cash") === "cash"}
                                  onChange={() => setPaymentMethodByItemId((prev) => ({ ...prev, [item.id]: "cash" }))}
                                  className="rounded"
                                  style={{ accentColor: "var(--color-primary)" }}
                                />
                                <span className="text-sm" style={{ color: "var(--color-text)" }}>
                                  Pay in cash (no charge at checkout)
                                </span>
                              </label>
                            </div>
                            <p className="text-xs mt-1" style={{ color: "var(--color-text)" }}>
                              Cash: pay when you pick up or receive delivery. No charge at checkout.
                            </p>
                          </div>
                        )}
                    </div>
                      );
                    })()}
                  </div>
                        ))}
                    </div>
                  </div>
                ))}
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
                  Order summary
                </h2>
                <div className="space-y-2 mb-4" style={{ color: "var(--color-text)" }}>
                  {hasMixedPayment ? (
                    <>
                      <p className="text-sm font-medium mb-1" style={{ color: "var(--color-heading)" }}>
                        Amount to pay now (card)
                      </p>
                      <div className="flex justify-between text-sm">
                        <span>Subtotal</span>
                        <span>${(cardSubtotalCents / 100).toFixed(2)}</span>
                      </div>
                      {cardShippingCents > 0 && (
                        <div className="flex justify-between text-sm">
                          <span>Shipping</span>
                          <span>${(cardShippingCents / 100).toFixed(2)}</span>
                        </div>
                      )}
                      {cardLocalDeliveryCents > 0 && (
                        <div className="flex justify-between text-sm">
                          <span>Local delivery</span>
                          <span>${(cardLocalDeliveryCents / 100).toFixed(2)}</span>
                        </div>
                      )}
                      <div className="flex justify-between font-bold pt-2 border-t" style={{ borderColor: "var(--color-section-alt)" }}>
                        <span>Pay now</span>
                        <span>${(cardTotalCents / 100).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-sm pt-1">
                        <span>Pay in cash at pickup/delivery</span>
                        <span>${(cashTotalCents / 100).toFixed(2)}</span>
                      </div>
                    </>
                  ) : (
                    <>
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
                    </>
                  )}
                </div>

                {hasShippedItem && (
                  <div className="mb-4">
                    <h3
                      className="text-sm font-semibold mb-2"
                      style={{ color: "var(--color-heading)" }}
                    >
                      Shipping address
                    </h3>
                    <p className="text-xs mb-2" style={{ color: "var(--color-text)" }}>
                      This address is sent to the seller for shipping.
                    </p>
                    <div className="space-y-2">
                      <input
                        type="text"
                        placeholder="Street"
                        value={shippingAddress.street}
                        onChange={(e) =>
                          setShippingAddress((s) => ({ ...s, street: e.target.value }))
                        }
                        className="w-full border rounded px-3 py-2 text-sm"
                        style={{ borderColor: "var(--color-primary)" }}
                      />
                      <input
                        type="text"
                        placeholder="Apartment, suite, etc. (optional)"
                        value={shippingAddress.aptOrSuite}
                        onChange={(e) =>
                          setShippingAddress((s) => ({ ...s, aptOrSuite: e.target.value }))
                        }
                        className="w-full border rounded px-3 py-2 text-sm"
                        style={{ borderColor: "var(--color-primary)" }}
                      />
                      <div className="grid grid-cols-3 gap-2">
                        <input
                          type="text"
                          placeholder="City"
                          value={shippingAddress.city}
                          onChange={(e) =>
                            setShippingAddress((s) => ({ ...s, city: e.target.value }))
                          }
                          className="border rounded px-3 py-2 text-sm"
                          style={{ borderColor: "var(--color-primary)" }}
                        />
                        <input
                          type="text"
                          placeholder="State"
                          value={shippingAddress.state}
                          onChange={(e) =>
                            setShippingAddress((s) => ({ ...s, state: e.target.value }))
                          }
                          className="border rounded px-3 py-2 text-sm"
                          style={{ borderColor: "var(--color-primary)" }}
                        />
                        <input
                          type="text"
                          placeholder="ZIP"
                          value={shippingAddress.zip}
                          onChange={(e) =>
                            setShippingAddress((s) => ({ ...s, zip: e.target.value }))
                          }
                          className="border rounded px-3 py-2 text-sm"
                          style={{ borderColor: "var(--color-primary)" }}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {!showPayInCash && (
                  <p className="text-xs mb-4" style={{ color: "var(--color-text)" }}>
                    Pay with Card, Google Pay, or Apple Pay on the next screen.
                  </p>
                )}
                {showPayInCash && !hasMixedPayment && (
                  <p className="text-xs mb-4" style={{ color: "var(--color-text)" }}>
                    Choose payment (card or cash) for each pickup or local delivery item above.
                  </p>
                )}
                {hasMixedPayment && (
                  <p className="text-xs mb-4" style={{ color: "var(--color-text)" }}>
                    Only the &quot;Pay now&quot; amount is charged at checkout. Cash items are paid when you pick up or receive delivery.
                  </p>
                )}

                {error && (
                  <p className="text-sm mb-2" style={{ color: "var(--color-primary)" }}>
                    {error}
                  </p>
                )}
                {hasLocalDelivery && !localDeliveryDetailsForCheckout && (
                  <p className="text-sm mb-2" style={{ color: "var(--color-primary)" }}>
                    Complete delivery details for local delivery items before checkout.
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
                    {checkingOut
                      ? cardItems.length === 0 && cashItems.length > 0
                        ? "Processing orders…"
                        : "Redirecting…"
                      : cardItems.length === 0 && cashItems.length > 0
                        ? "Process orders"
                        : "Proceed to checkout"}
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
                deliveryAddress: {
                  street: itemForModal.localDeliveryDetails.deliveryAddress?.street ?? "",
                  city: itemForModal.localDeliveryDetails.deliveryAddress?.city ?? "",
                  state: itemForModal.localDeliveryDetails.deliveryAddress?.state ?? "",
                  zip: itemForModal.localDeliveryDetails.deliveryAddress?.zip ?? "",
                },
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
                preferredPickupTime: itemForPickupModal.pickupDetails.preferredPickupTime ?? "",
                note: itemForPickupModal.pickupDetails.note ?? "",
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
