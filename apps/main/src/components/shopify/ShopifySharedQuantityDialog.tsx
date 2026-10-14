"use client";

import { SHOPIFY_SHARED_QUANTITY_MESSAGE } from "@/lib/listing-variant-matrix";

export function ShopifySharedQuantityDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shopify-shared-quantity-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-[12px] border-2 bg-white p-5 shadow-lg"
        style={{ borderColor: "var(--color-primary)" }}
        onClick={(event) => event.stopPropagation()}
      >
        <h2
          id="shopify-shared-quantity-title"
          className="text-lg font-semibold"
          style={{ color: "var(--color-heading)" }}
        >
          Shared quantity pools
        </h2>
        <p className="mt-2 text-sm text-neutral-700">{SHOPIFY_SHARED_QUANTITY_MESSAGE}</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button type="button" className="btn" onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
