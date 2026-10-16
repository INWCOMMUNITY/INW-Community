"use client";

import { shopifyMetafieldListingWarning } from "@/lib/shopify/metafield-listing-warning";

export function ShopifyMetafieldListingDialog({
  open,
  itemCount = 1,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  itemCount?: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shopify-metafield-title"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-[12px] border-2 bg-white p-5 shadow-lg"
        style={{ borderColor: "var(--color-primary)" }}
        onClick={(event) => event.stopPropagation()}
      >
        <h2
          id="shopify-metafield-title"
          className="text-lg font-semibold"
          style={{ color: "var(--color-heading)" }}
        >
          Shopify metafields
        </h2>
        <p className="mt-2 text-sm text-neutral-700">{shopifyMetafieldListingWarning(itemCount)}</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button type="button" className="btn" onClick={onConfirm}>
            List on Shopify
          </button>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
