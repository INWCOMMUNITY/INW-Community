"use client";

import { memo } from "react";
import { IonIcon } from "@/components/IonIcon";

export type StoreItemFulfillmentType = "ship" | "local_delivery" | "pickup";

const fulfillmentBtnBase =
  "inline-flex items-center gap-2 border rounded px-4 py-2.5 text-base transition min-h-[2.75rem]";
const fulfillmentBtnActive =
  "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]";
const fulfillmentBtnIdle = "border-gray-300 hover:border-gray-400 text-gray-800";

type FulfillmentPickerProps = {
  fulfillmentType: StoreItemFulfillmentType;
  onFulfillmentTypeChange: (type: StoreItemFulfillmentType) => void;
  shippingDisabled?: boolean;
  localDeliveryAvailable?: boolean;
  inStorePickupAvailable?: boolean;
  shippingCostCents?: number | null;
  localDeliveryFeeCents?: number | null;
  localDeliveryDetailsSaved?: boolean;
  pickupDetailsSaved?: boolean;
  /** App-style section title */
  sectionTitle?: string;
};

export const StoreItemFulfillmentPicker = memo(function StoreItemFulfillmentPicker({
  fulfillmentType,
  onFulfillmentTypeChange,
  shippingDisabled,
  localDeliveryAvailable,
  inStorePickupAvailable,
  shippingCostCents,
  localDeliveryFeeCents,
  localDeliveryDetailsSaved,
  pickupDetailsSaved,
  sectionTitle = "Receive Item",
}: FulfillmentPickerProps) {
  const showPicker =
    shippingDisabled || localDeliveryAvailable || inStorePickupAvailable;
  if (!showPicker) return null;

  return (
    <div className="mt-4 space-y-2">
      <label className="block text-base font-medium">{sectionTitle}</label>
      <div className="flex flex-wrap gap-2">
        {!shippingDisabled && (
          <button
            type="button"
            onClick={() => onFulfillmentTypeChange("ship")}
            className={`${fulfillmentBtnBase} ${
              fulfillmentType === "ship" ? fulfillmentBtnActive : fulfillmentBtnIdle
            }`}
          >
            <IonIcon
              name="cube-outline"
              size={20}
              className={
                fulfillmentType === "ship" ? "text-[var(--color-primary)]" : "text-gray-600"
              }
            />
            Shipping
            {shippingCostCents != null && shippingCostCents > 0
              ? ` ($${(shippingCostCents / 100).toFixed(2)})`
              : " (free)"}
          </button>
        )}
        {inStorePickupAvailable && (
          <button
            type="button"
            onClick={() => onFulfillmentTypeChange("pickup")}
            className={`${fulfillmentBtnBase} ${
              fulfillmentType === "pickup" ? fulfillmentBtnActive : fulfillmentBtnIdle
            }`}
          >
            <IonIcon
              name="storefront-outline"
              size={20}
              className={
                fulfillmentType === "pickup" ? "text-[var(--color-primary)]" : "text-gray-600"
              }
            />
            Pickup
          </button>
        )}
        {localDeliveryAvailable && (
          <button
            type="button"
            onClick={() => onFulfillmentTypeChange("local_delivery")}
            className={`${fulfillmentBtnBase} ${
              fulfillmentType === "local_delivery"
                ? fulfillmentBtnActive
                : fulfillmentBtnIdle
            }`}
          >
            <IonIcon
              name="car-outline"
              size={20}
              className={
                fulfillmentType === "local_delivery"
                  ? "text-[var(--color-primary)]"
                  : "text-gray-600"
              }
            />
            Delivery
            {localDeliveryFeeCents != null && localDeliveryFeeCents > 0
              ? ` ($${(localDeliveryFeeCents / 100).toFixed(2)})`
              : " (No Fee)"}
          </button>
        )}
      </div>
      {((fulfillmentType === "local_delivery" && !localDeliveryDetailsSaved) ||
        (fulfillmentType === "pickup" && !pickupDetailsSaved)) && (
        <p className="text-amber-600 text-sm">
          {fulfillmentType === "pickup"
            ? "Complete the pickup form when you add to cart."
            : "Complete delivery details when you add to cart."}
        </p>
      )}
    </div>
  );
});

type QuantityStepperProps = {
  quantity: number;
  maxQuantity: number;
  onChange: (q: number) => void;
};

export const StoreItemQuantityStepper = memo(function StoreItemQuantityStepper({
  quantity,
  maxQuantity,
  onChange,
}: QuantityStepperProps) {
  if (maxQuantity <= 1) return null;

  return (
    <div className="mt-6">
      <label className="block text-sm font-medium mb-1">Quantity *</label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(Math.max(1, quantity - 1))}
          disabled={quantity <= 1}
          className="w-10 h-10 border rounded flex items-center justify-center disabled:opacity-40"
          aria-label="Decrease quantity"
        >
          <IonIcon name="remove" size={20} className="text-[var(--color-primary)]" />
        </button>
        <input
          type="number"
          min={1}
          max={maxQuantity}
          value={quantity}
          onChange={(e) =>
            onChange(Math.max(1, Math.min(maxQuantity, parseInt(e.target.value, 10) || 1)))
          }
          className="border rounded px-3 py-2 w-20 text-center"
        />
        <button
          type="button"
          onClick={() => onChange(Math.min(maxQuantity, quantity + 1))}
          disabled={quantity >= maxQuantity}
          className="w-10 h-10 border rounded flex items-center justify-center disabled:opacity-40"
          aria-label="Increase quantity"
        >
          <IonIcon name="add" size={20} className="text-[var(--color-primary)]" />
        </button>
      </div>
      <p className="text-sm text-gray-500 mt-1">
        {maxQuantity < 10 ? `Only ${maxQuantity} left` : `${maxQuantity} in stock`}
      </p>
    </div>
  );
});

/** Resale / storefront secondary action with Ionicons (Message Seller, Send Offer). */
export const StoreItemIconActionButton = memo(function StoreItemIconActionButton({
  icon,
  label,
  onClick,
  className = "",
}: {
  icon: string;
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 flex-1 min-w-[8rem] border border-gray-300 bg-white hover:bg-gray-50 rounded px-3 py-2.5 text-sm font-medium text-[var(--color-primary)] ${className}`}
    >
      <IonIcon name={icon} size={18} className="text-[var(--color-primary)] shrink-0" />
      {label}
    </button>
  );
});

export const StoreItemAddToCartButton = memo(function StoreItemAddToCartButton({
  onClick,
  disabled,
  loading,
  needsFulfillmentForm,
}: {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  needsFulfillmentForm?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className="btn disabled:opacity-50 w-full py-2.5"
    >
      {loading
        ? "Adding…"
        : needsFulfillmentForm
          ? "Complete Form & Add to Cart"
          : "Add to Cart"}
    </button>
  );
});

export function MessageSentToast({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center pointer-events-none"
      role="status"
      aria-live="polite"
    >
      <div className="bg-black/75 text-white px-6 py-3 rounded-lg shadow-lg text-sm font-medium">
        Message Sent!
      </div>
    </div>
  );
}
