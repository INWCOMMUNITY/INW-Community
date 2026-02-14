"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getErrorMessage } from "@/lib/api-error";
import { useLockBodyScroll } from "@/lib/scroll-lock";

interface Business {
  id: string;
  name: string;
  slug: string;
}

interface StoreItemFormProps {
  existing?: {
    id: string;
    businessId: string | null;
    title: string;
    description: string | null;
    photos: string[];
    category: string | null;
    priceCents: number;
    variants: unknown;
    quantity: number;
    status: string;
    listingType?: "new" | "resale";
    shippingCostCents: number | null;
    shippingPolicy: string | null;
    localDeliveryAvailable: boolean;
    localDeliveryFeeCents?: number | null;
    inStorePickupAvailable?: boolean;
    shippingDisabled?: boolean;
    localDeliveryTerms?: string | null;
    pickupTerms?: string | null;
    acceptOffers?: boolean;
    minOfferCents?: number | null;
  };
  /** When true, force resale listing and hide "Where to list" (e.g. Resale Hub). */
  resaleOnly?: boolean;
  /** Redirect after successful create/update (default: /seller-hub/store/items). */
  successRedirect?: string;
}

export function StoreItemForm({ existing, resaleOnly, successRedirect }: StoreItemFormProps) {
  const router = useRouter();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [businessId, setBusinessId] = useState(existing?.businessId ?? "");
  const [listingType, setListingType] = useState<"new" | "resale">(
    resaleOnly ? "resale" : (existing?.listingType ?? "new")
  );
  const [title, setTitle] = useState(existing?.title ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [photos, setPhotos] = useState<string[]>(existing?.photos ?? []);
  const [category, setCategory] = useState(existing?.category ?? "");
  const [priceDollars, setPriceDollars] = useState(
    existing ? (existing.priceCents / 100).toFixed(2) : ""
  );
  const [quantity, setQuantity] = useState(existing?.quantity ?? 1);
  const [shippingCostDollars, setShippingCostDollars] = useState(
    existing?.shippingCostCents ? (existing.shippingCostCents / 100).toFixed(2) : ""
  );
  const [shippingPolicy, setShippingPolicy] = useState(existing?.shippingPolicy ?? "");
  const [useSellerProfileShipping, setUseSellerProfileShipping] = useState(
    !existing?.shippingPolicy || existing.shippingPolicy === ""
  );
  const [sellerProfileShippingPolicy, setSellerProfileShippingPolicy] = useState("");
  const [variants, setVariants] = useState<{ name: string; options: string[] }[]>(() => {
    const v = existing?.variants;
    return Array.isArray(v) ? (v as { name: string; options: string[] }[]) : [];
  });
  const [localDeliveryAvailable, setLocalDeliveryAvailable] = useState(
    existing?.localDeliveryAvailable ?? false
  );
  const [localDeliveryFeeDollars, setLocalDeliveryFeeDollars] = useState(
    existing?.localDeliveryFeeCents != null ? (existing.localDeliveryFeeCents / 100).toFixed(2) : ""
  );
  const [inStorePickupAvailable, setInStorePickupAvailable] = useState(
    existing?.inStorePickupAvailable ?? false
  );
  const [shippingDisabled, setShippingDisabled] = useState(
    existing?.shippingDisabled ?? false
  );
  const [localDeliveryTerms, setLocalDeliveryTerms] = useState(
    existing?.localDeliveryTerms ?? ""
  );
  const [sellerProfilePickupPolicy, setSellerProfilePickupPolicy] = useState("");
  const [useSellerProfilePickup, setUseSellerProfilePickup] = useState(
    !existing?.pickupTerms || existing.pickupTerms === ""
  );
  const [pickupTerms, setPickupTerms] = useState(existing?.pickupTerms ?? "");
  const [acceptOffers, setAcceptOffers] = useState(
    existing?.acceptOffers ?? true
  );
  const [minOfferDollars, setMinOfferDollars] = useState(
    existing?.minOfferCents != null ? (existing.minOfferCents / 100).toFixed(2) : ""
  );
  const [acceptCashForPickupDelivery, setAcceptCashForPickupDelivery] = useState(true);
  const [offerShipping, setOfferShipping] = useState(true);
  const [offerLocalDelivery, setOfferLocalDelivery] = useState(true);
  const [offerLocalPickup, setOfferLocalPickup] = useState(true);
  const [offerFlagsLoaded, setOfferFlagsLoaded] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/me/policies")
      .then((r) => r.json())
      .then((data: {
        sellerShippingPolicy?: string | null;
        sellerLocalDeliveryPolicy?: string | null;
        sellerPickupPolicy?: string | null;
        offerShipping?: boolean;
        offerLocalDelivery?: boolean;
        offerLocalPickup?: boolean;
      }) => {
        if (data?.offerShipping !== undefined) setOfferShipping(data.offerShipping);
        if (data?.offerLocalDelivery !== undefined) setOfferLocalDelivery(data.offerLocalDelivery);
        if (data?.offerLocalPickup !== undefined) setOfferLocalPickup(data.offerLocalPickup);
        setOfferFlagsLoaded(true);
        if (data?.sellerShippingPolicy != null && !existing?.shippingPolicy) {
          setSellerProfileShippingPolicy(data.sellerShippingPolicy ?? "");
          if (useSellerProfileShipping) setShippingPolicy(data.sellerShippingPolicy ?? "");
        }
        if (data?.sellerLocalDeliveryPolicy != null && !existing?.localDeliveryTerms) {
          setLocalDeliveryTerms((prev) => prev || (data.sellerLocalDeliveryPolicy ?? ""));
        }
        if (data?.sellerPickupPolicy != null && !existing?.pickupTerms) {
          setSellerProfilePickupPolicy(data.sellerPickupPolicy ?? "");
          if (useSellerProfilePickup) setPickupTerms(data.sellerPickupPolicy ?? "");
        }
      })
      .catch(() => setOfferFlagsLoaded(true));
    fetch("/api/me")
      .then((r) => r.json())
      .then((data: { acceptCashForPickupDelivery?: boolean }) => {
        if (resaleOnly && data?.acceptCashForPickupDelivery !== undefined) {
          setAcceptCashForPickupDelivery(data.acceptCashForPickupDelivery);
        }
      })
      .catch(() => {});
  }, [resaleOnly, existing?.shippingPolicy, existing?.localDeliveryTerms, existing?.pickupTerms]);

  useLockBodyScroll(showSuccessModal);

  useEffect(() => {
    Promise.all([
      fetch("/api/businesses?mine=1").then((r) => r.json()),
      fetch("/api/businesses?list=meta").then((r) => r.json()),
      fetch("/api/seller-profile").then((r) => r.json()).catch(() => ({})),
    ]).then(([bizData, metaData, profileData]) => {
      if (Array.isArray(bizData)) {
        setBusinesses(bizData);
        if (!existing?.businessId && bizData[0]) {
          setBusinessId(bizData[0].id);
        }
      }
      if (metaData?.categories) {
        setCategories(metaData.categories);
      }
      if (profileData?.sellerShippingPolicy) {
        setSellerProfileShippingPolicy(profileData.sellerShippingPolicy);
        if (!existing?.shippingPolicy && !existing) {
          setShippingPolicy(profileData.sellerShippingPolicy);
        }
      }
    });
  }, [existing?.businessId, existing?.shippingPolicy, existing]);

  const effectiveShippingPolicy = useSellerProfileShipping
    ? sellerProfileShippingPolicy
    : shippingPolicy;

  useEffect(() => {
    if (!offerFlagsLoaded) return;
    if (!offerShipping) setShippingDisabled(true);
    if (!offerLocalDelivery) setLocalDeliveryAvailable(false);
    if (!offerLocalPickup) setInStorePickupAvailable(false);
  }, [offerFlagsLoaded, offerShipping, offerLocalDelivery, offerLocalPickup]);

  async function uploadFile(file: File): Promise<string> {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body: formData });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "Upload failed");
    const url = data.url;
    if (!url) throw new Error("No URL returned");
    if (url.startsWith("/")) return `${window.location.origin}${url}`;
    return url;
  }

  async function handlePhotosChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files?.length) return;
    setUploadingPhotos(true);
    setError("");
    try {
      for (let i = 0; i < files.length; i++) {
        const url = await uploadFile(files[i]);
        setPhotos((prev) => (prev.includes(url) ? prev : [...prev, url]));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadingPhotos(false);
      e.target.value = "";
    }
  }

  function removePhoto(i: number) {
    setPhotos((prev) => prev.filter((_, idx) => idx !== i));
  }

  const movePhoto = useCallback((from: number, to: number) => {
    setPhotos((prev) => {
      const next = [...prev];
      const [removed] = next.splice(from, 1);
      next.splice(to, 0, removed);
      return next;
    });
  }, []);

  function handleDragEnd() {
    setDragIndex(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const priceCents = Math.round(parseFloat(priceDollars) * 100);
    const shippingCostCents = shippingCostDollars
      ? Math.round(parseFloat(shippingCostDollars) * 100)
      : 0;
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    if (isNaN(priceCents) || priceCents < 1) {
      setError("Price must be at least $0.01");
      return;
    }
    if (quantity < 1) {
      setError("Quantity must be at least 1 to list this item.");
      return;
    }
    const effectiveShippingDisabled = !offerShipping || shippingDisabled;
    const effectiveLocalDelivery = offerLocalDelivery && localDeliveryAvailable;
    const effectivePickup = offerLocalPickup && inStorePickupAvailable;
    if (!effectiveShippingDisabled && !effectiveLocalDelivery && !effectivePickup) {
      setError("Enable at least one fulfillment method (shipping, local delivery, or pickup) in Policies.");
      return;
    }
    if (resaleOnly && !effectiveShippingDisabled && !shippingPolicy.trim()) {
      setError("Shipping policy is required when you offer shipping. Set it in Policies or use Sync here.");
      return;
    }
    const effectivePickupPolicy = useSellerProfilePickup ? sellerProfilePickupPolicy : pickupTerms;
    if (effectivePickup && !effectivePickupPolicy.trim()) {
      setError("Pickup terms are required when you offer local pickup. Set them in Policies or use Sync here.");
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        businessId: resaleOnly ? null : (businessId || null),
        title: title.trim(),
        description: description.trim() || null,
        photos,
        category: category.trim() || null,
        priceCents,
        quantity,
        status: "active",
        listingType: resaleOnly ? "resale" : listingType,
        variants:
          variants.filter((v) => v.name.trim() && v.options.length > 0).length > 0
            ? variants.filter((v) => v.name.trim() && v.options.length > 0)
            : null,
        shippingCostCents: !effectiveShippingDisabled && shippingCostCents > 0 ? shippingCostCents : null,
        shippingPolicy: resaleOnly
          ? (shippingPolicy.trim() || null)
          : (effectiveShippingDisabled || useSellerProfileShipping ? null : shippingPolicy.trim() || null),
        localDeliveryAvailable: effectiveLocalDelivery,
        localDeliveryFeeCents: effectiveLocalDelivery && localDeliveryFeeDollars
          ? Math.round(parseFloat(localDeliveryFeeDollars) * 100)
          : null,
        inStorePickupAvailable: effectivePickup,
        shippingDisabled: effectiveShippingDisabled,
        localDeliveryTerms: effectiveLocalDelivery ? (localDeliveryTerms.trim() || null) : null,
        pickupTerms:
          effectivePickup && !useSellerProfilePickup ? (pickupTerms.trim() || null) : null,
        ...(resaleOnly
          ? {
              acceptOffers,
              minOfferCents: (() => {
                if (!acceptOffers || !minOfferDollars.trim()) return null;
                const cents = Math.round(parseFloat(minOfferDollars) * 100);
                return Number.isInteger(cents) && cents >= 0 ? cents : null;
              })(),
            }
          : {}),
      };
      const url = existing ? `/api/store-items/${existing.id}` : "/api/store-items";
      const method = existing ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      let data: { error?: unknown; message?: string } = {};
      try {
        const text = await res.text();
        if (text) data = JSON.parse(text);
      } catch {
        data = { error: res.status === 500 ? "Server error. Check the terminal for details." : `Request failed (${res.status}).` };
      }
      if (!res.ok) {
        const message = getErrorMessage(data?.error, data?.message ?? "Failed to save");
        setError(message);
        return;
      }
      if (resaleOnly) {
        const mePayload: Record<string, string | null> = {};
        if (payload.shippingPolicy) mePayload.sellerShippingPolicy = payload.shippingPolicy;
        if (payload.localDeliveryTerms) mePayload.sellerLocalDeliveryPolicy = payload.localDeliveryTerms;
        if (Object.keys(mePayload).length > 0) {
          fetch("/api/me", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(mePayload),
          }).catch(() => {});
        }
      }
      if (resaleOnly) {
        setShowSuccessModal(true);
      } else {
        router.push(successRedirect ?? "/seller-hub/store/items");
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleSuccessModalClose() {
    setShowSuccessModal(false);
    router.push(successRedirect ?? "/resale-hub");
    router.refresh();
  }

  function addVariantOption(vi: number, value: string) {
    if (!value.trim()) return;
    setVariants((prev) => {
      const next = [...prev];
      next[vi] = { ...next[vi], options: [...next[vi].options, value.trim()] };
      return next;
    });
  }

  return (
    <>
    <form onSubmit={handleSubmit} className="space-y-6 max-w-xl mx-auto text-center">
      {!resaleOnly && (
        <div>
          <label className="block text-sm font-medium mb-1">Business (optional)</label>
          <select
            value={businessId}
            onChange={(e) => setBusinessId(e.target.value)}
            className="w-full border rounded px-3 py-2"
          >
            <option value="">None</option>
            {businesses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {!resaleOnly && (
        <div>
          <label className="block text-sm font-medium mb-1">Where to list</label>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="listingType"
                checked={listingType === "new"}
                onChange={() => setListingType("new")}
                className="rounded"
              />
              <span className="text-sm font-medium">New (NWC Storefront)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="listingType"
                checked={listingType === "resale"}
                onChange={() => setListingType("resale")}
                className="rounded"
              />
              <span className="text-sm font-medium">Resale (Community Resale)</span>
            </label>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            New items appear on the main storefront; resale items appear on Community Resale.
          </p>
        </div>
      )}

      {/* 1. Photos - eBay-style gallery */}
      <div>
        <label className="block text-sm font-medium mb-1">Photos</label>
        <input
          type="file"
          accept="image/*"
          multiple
          onChange={handlePhotosChange}
          disabled={uploadingPhotos}
          className="w-full border rounded px-3 py-2"
        />
        {photos.length > 0 && (
          <div className="mt-3">
            <div className="w-full aspect-square max-h-64 bg-gray-100 rounded-lg overflow-hidden mb-2">
              <img
                src={photos[0]}
                alt="Main"
                className="w-full h-full object-contain"
              />
            </div>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {photos.map((url, i) => (
                <div
                  key={url}
                  draggable
                  onDragStart={(e) => {
                    setDragIndex(i);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", String(i));
                    e.dataTransfer.setDragImage(e.currentTarget, 0, 0);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const fromIndex = parseInt(e.dataTransfer.getData("text/plain"), 10);
                    if (!isNaN(fromIndex) && fromIndex !== i) {
                      movePhoto(fromIndex, i);
                    }
                    setDragIndex(null);
                  }}
                  onDragEnd={handleDragEnd}
                  onDragLeave={() => {}}
                  className={`relative shrink-0 w-16 h-16 rounded border-2 cursor-grab active:cursor-grabbing select-none ${
                    dragIndex === i ? "border-primary-600 opacity-50" : "border-gray-300"
                  }`}
                >
                  <img
                    src={url}
                    alt=""
                    className="w-full h-full object-cover rounded pointer-events-none"
                    draggable={false}
                  />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removePhoto(i);
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs z-10"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-500">Drag thumbnails to reorder. First image is the main photo.</p>
          </div>
        )}
      </div>

      {/* 2. Title */}
      <div>
        <label className="block text-sm font-medium mb-1">Title *</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full border rounded px-3 py-2"
          required
        />
      </div>

      {/* 3. Item Description */}
      <div>
        <label className="block text-sm font-medium mb-1">Item Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full border rounded px-3 py-2"
          rows={4}
        />
      </div>

      {/* 4. Category */}
      <div>
        <label className="block text-sm font-medium mb-1">Category</label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="w-full border rounded px-3 py-2"
        >
          <option value="">Select or type below</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Or type category"
          className="w-full border rounded px-3 py-2 mt-1"
        />
      </div>

      {/* 5. Price & Quantity */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Price (USD) *</label>
          <input
            type="number"
            step="0.01"
            min="0.01"
            value={priceDollars}
            onChange={(e) => setPriceDollars(e.target.value)}
            className="w-full border rounded px-3 py-2"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Quantity in stock</label>
          <input
            type="number"
            min="0"
            value={quantity}
            onChange={(e) => setQuantity(parseInt(e.target.value, 10) || 0)}
            className="w-full border rounded px-3 py-2"
          />
        </div>
      </div>

      {resaleOnly && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Accept Offers</label>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="acceptOffers"
                  checked={acceptOffers}
                  onChange={() => setAcceptOffers(true)}
                  className="rounded"
                />
                <span className="text-sm font-medium">Yes</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="acceptOffers"
                  checked={!acceptOffers}
                  onChange={() => setAcceptOffers(false)}
                  className="rounded"
                />
                <span className="text-sm font-medium">No</span>
              </label>
            </div>
          </div>
          {acceptOffers && (
            <div>
              <label className="block text-sm font-medium mb-1">
                Automatically decline offers less than ($)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={minOfferDollars}
                onChange={(e) => setMinOfferDollars(e.target.value)}
                className="w-full border rounded px-3 py-2 max-w-xs"
                placeholder="e.g. 10.00"
              />
              <p className="text-xs text-gray-500 mt-0.5">
                Leave blank to accept any offer amount.
              </p>
            </div>
          )}
          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={acceptCashForPickupDelivery}
                onChange={(e) => {
                  const next = e.target.checked;
                  setAcceptCashForPickupDelivery(next);
                  fetch("/api/me", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ acceptCashForPickupDelivery: next }),
                  }).catch(() => {});
                }}
                className="rounded"
              />
              <span className="font-medium">Accept cash for pickup and local delivery</span>
            </label>
            <p className="text-xs text-gray-500 mt-0.5 pl-6">
              If checked, buyers can choose to pay in cash when they pick up or receive local delivery.
            </p>
          </div>
        </div>
      )}

      {/* 6. Delivery options - three toggles */}
      {offerFlagsLoaded && (offerShipping || offerLocalDelivery || offerLocalPickup) && (
      <div className="space-y-4 border-t pt-6">
        <h3 className="font-semibold text-gray-800">Delivery options</h3>

        {offerShipping && (
        <>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={!shippingDisabled}
            onChange={(e) => {
              const nextDisabled = !e.target.checked;
              if (nextDisabled && !localDeliveryAvailable && !inStorePickupAvailable) {
                setLocalDeliveryAvailable(true);
              }
              setShippingDisabled(nextDisabled);
            }}
            className="rounded"
          />
          <span className="text-sm font-medium">Offer Shipping</span>
        </label>
        {!shippingDisabled && (
          <>
            <div>
              <label className="block text-sm font-medium mb-1">Shipping price (USD)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={shippingCostDollars}
                onChange={(e) => setShippingCostDollars(e.target.value)}
                className="w-full border rounded px-3 py-2"
                placeholder="e.g. 5.99"
              />
              <p className="text-xs text-gray-500 mt-0.5">Price charged for shipping this item</p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Shipping Policy</label>
              <div className="flex gap-2 items-start">
                <textarea
                  value={resaleOnly ? shippingPolicy : (useSellerProfileShipping ? effectiveShippingPolicy : shippingPolicy)}
                  onChange={(e) => {
                    if (!resaleOnly && useSellerProfileShipping) return;
                    setShippingPolicy(e.target.value);
                  }}
                  readOnly={!resaleOnly && useSellerProfileShipping}
                  className={`w-full border rounded px-3 py-2 flex-1 min-w-0 ${!resaleOnly && useSellerProfileShipping ? "bg-gray-50" : ""}`}
                  rows={3}
                  placeholder="e.g. 2-5 business days via USPS. Free over $50."
                />
                {resaleOnly && (
                  <button
                    type="button"
                    onClick={() => {
                      fetch("/api/me")
                        .then((r) => r.json())
                        .then((data: { sellerShippingPolicy?: string | null }) => {
                          setShippingPolicy(data?.sellerShippingPolicy ?? "");
                        })
                        .catch(() => {});
                    }}
                    className="shrink-0 border border-gray-300 bg-white hover:bg-gray-50 rounded px-2 py-1 text-sm text-gray-700"
                  >
                    Sync
                  </button>
                )}
              </div>
              {!resaleOnly && (
                <>
                  <label className="flex items-center gap-2 cursor-pointer mt-2">
                    <input
                      type="checkbox"
                      checked={useSellerProfileShipping}
                      onChange={(e) => {
                        setUseSellerProfileShipping(e.target.checked);
                        if (e.target.checked) setShippingPolicy("");
                      }}
                      className="rounded"
                    />
                    <span className="text-sm font-medium">Use seller profile default</span>
                  </label>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {useSellerProfileShipping
                      ? "Synced from your seller profile. Uncheck to set item-specific policy."
                      : "Item-specific shipping policy (overrides profile default)."}
                  </p>
                </>
              )}
              {resaleOnly && (
                <p className="text-xs text-gray-500 mt-0.5">
                  Required. Sync loads your policy from Resale Hub (below the buttons).
                </p>
              )}
            </div>
          </>
        )}
        </>
        )}

        {offerLocalDelivery && (
        <label className="flex items-center gap-2 cursor-pointer mt-3">
          <input
            type="checkbox"
            checked={localDeliveryAvailable}
            onChange={(e) => setLocalDeliveryAvailable(e.target.checked)}
            className="rounded"
          />
          <span className="font-medium">Offer Local Delivery</span>
        </label>
        )}
        {offerLocalDelivery && localDeliveryAvailable && (
          <div className="space-y-2 pl-6">
            <div>
              <label className="block text-sm font-medium mb-1">Local Delivery fee (USD, optional)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={localDeliveryFeeDollars}
                onChange={(e) => setLocalDeliveryFeeDollars(e.target.value)}
                className="w-full border rounded px-3 py-2 max-w-xs"
                placeholder="e.g. 5.00 or leave blank for free"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Local Delivery terms</label>
              <div className="flex gap-2 items-start">
                <textarea
                  value={localDeliveryTerms}
                  onChange={(e) => setLocalDeliveryTerms(e.target.value)}
                  className="w-full border rounded px-3 py-2 flex-1 min-w-0"
                  rows={3}
                  placeholder="Describe terms of local delivery (e.g. areas served, contact method)"
                />
                {resaleOnly && (
                  <button
                    type="button"
                    onClick={() => {
                      fetch("/api/me")
                        .then((r) => r.json())
                        .then((data: { sellerLocalDeliveryPolicy?: string | null }) => {
                          setLocalDeliveryTerms(data?.sellerLocalDeliveryPolicy ?? "");
                        })
                        .catch(() => {});
                    }}
                    className="shrink-0 border border-gray-300 bg-white hover:bg-gray-50 rounded px-2 py-1 text-sm text-gray-700"
                  >
                    Sync
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {offerLocalPickup && (
        <>
        <label className="flex items-center gap-2 cursor-pointer mt-3">
          <input
            type="checkbox"
            checked={inStorePickupAvailable}
            onChange={(e) => setInStorePickupAvailable(e.target.checked)}
            className="rounded"
          />
          <span className="font-medium">Offer Local Pick Up</span>
        </label>
        {inStorePickupAvailable && (
          <>
            <div className="mt-2 pl-6">
              <label className="block text-sm font-medium mb-1">Pickup terms</label>
              <div className="flex gap-2 items-start">
                <textarea
                  value={useSellerProfilePickup ? sellerProfilePickupPolicy : pickupTerms}
                  onChange={(e) => {
                    if (!useSellerProfilePickup) setPickupTerms(e.target.value);
                  }}
                  readOnly={useSellerProfilePickup}
                  className={`w-full border rounded px-3 py-2 flex-1 min-w-0 ${useSellerProfilePickup ? "bg-gray-50" : ""}`}
                  rows={3}
                  placeholder="e.g. Location, contact method, hours."
                />
                <button
                  type="button"
                  onClick={() => {
                    fetch("/api/me/policies")
                      .then((r) => r.json())
                      .then((data: { sellerPickupPolicy?: string | null }) => {
                        const policy = data?.sellerPickupPolicy ?? "";
                        setSellerProfilePickupPolicy(policy);
                        setPickupTerms(policy);
                      })
                      .catch(() => {});
                  }}
                  className="shrink-0 border border-gray-300 bg-white hover:bg-gray-50 rounded px-2 py-1 text-sm text-gray-700"
                >
                  Sync
                </button>
              </div>
              <label className="flex items-center gap-2 cursor-pointer mt-2">
                <input
                  type="checkbox"
                  checked={useSellerProfilePickup}
                  onChange={(e) => {
                    setUseSellerProfilePickup(e.target.checked);
                    if (e.target.checked) setPickupTerms("");
                  }}
                  className="rounded"
                />
                <span className="text-sm font-medium">Use policies from settings</span>
              </label>
              <p className="text-xs text-gray-500 mt-0.5">
                {useSellerProfilePickup
                  ? "Synced from your Policies screen. Uncheck to set item-specific terms."
                  : "Item-specific pickup terms (overrides profile default)."}
              </p>
            </div>
          </>
        )}
        </>
        )}
      </div>
      )}

      {offerFlagsLoaded && !(offerShipping || offerLocalDelivery || offerLocalPickup) && (
        <div className="border-t pt-6">
          <p className="text-sm text-gray-600 mb-2">
            Set your fulfillment options in Policies (shipping, local delivery, pickup) to enable them here.
          </p>
          <a href="/my-community" className="text-primary-600 hover:underline text-sm">Open Policies</a>
        </div>
      )}

      {/* 8. Options */}
      <div className="space-y-4 border-t pt-6">
        <h3 className="font-semibold text-gray-800">Options (Size, Color, etc.)</h3>
        <p className="text-sm text-gray-500">
          Add option groups like Size - Small + Medium + Large. Use + to add each value.
        </p>
        {variants.map((v, vi) => (
          <div key={vi} className="border rounded p-3 bg-gray-50">
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                value={v.name}
                onChange={(e) =>
                  setVariants((prev) => {
                    const next = [...prev];
                    next[vi] = { ...next[vi], name: e.target.value };
                    return next;
                  })
                }
                placeholder="Option name (e.g. Size)"
                className="flex-1 border rounded px-2 py-1 text-sm"
              />
              <button
                type="button"
                onClick={() => setVariants((prev) => prev.filter((_, i) => i !== vi))}
                className="text-red-600 text-sm hover:underline"
              >
                Remove
              </button>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              {v.options.map((opt, oi) => (
                <span
                  key={oi}
                  className="inline-flex items-center gap-1 bg-white border rounded px-2 py-1 text-sm"
                >
                  {opt}
                  <button
                    type="button"
                    onClick={() =>
                      setVariants((prev) => {
                        const next = [...prev];
                        next[vi] = {
                          ...next[vi],
                          options: next[vi].options.filter((_, i) => i !== oi),
                        };
                        return next;
                      })
                    }
                    className="text-red-500 hover:text-red-700"
                  >
                    ×
                  </button>
                </span>
              ))}
              <AddOptionInput
                onAdd={(val) => addVariantOption(vi, val)}
                placeholder="+ Add (e.g. Small)"
              />
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setVariants((prev) => [...prev, { name: "", options: [] }])}
          className="btn text-sm"
        >
          + Add option group
        </button>
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}
      <button type="submit" disabled={submitting} className="btn">
        {submitting ? "Saving…" : existing ? "Update item" : "Create item"}
      </button>

    </form>
      {showSuccessModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 overflow-hidden">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 text-center">
            <p className="text-lg text-gray-800 mb-6">
              Your item is in review, thanks for selling in this community!
            </p>
            <button
              type="button"
              onClick={handleSuccessModalClose}
              className="btn w-full"
            >
              Return to Resale Hub
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function AddOptionInput({
  onAdd,
  placeholder,
}: {
  onAdd: (value: string) => void;
  placeholder: string;
}) {
  const [val, setVal] = useState("");
  return (
    <div className="inline-flex items-center gap-1">
      <input
        type="text"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder={placeholder}
        className="w-28 border rounded px-2 py-1 text-sm"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (val.trim()) {
              onAdd(val.trim());
              setVal("");
            }
          }
        }}
      />
      <button
        type="button"
        onClick={() => {
          if (val.trim()) {
            onAdd(val.trim());
            setVal("");
          }
        }}
        className="text-primary-600 font-bold text-lg leading-none px-1 hover:text-primary-700"
        title="Add option"
      >
        +
      </button>
    </div>
  );
}
