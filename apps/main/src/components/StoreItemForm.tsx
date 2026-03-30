"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getErrorMessage } from "@/lib/api-error";
import { useLockBodyScroll } from "@/lib/scroll-lock";
import { BadgeEarnedStackOverlay, type EarnedBadgeForOverlay } from "@/components/BadgeEarnedStackOverlay";
import { sumOptionQuantities } from "@/lib/store-item-variants";
import {
  STORE_CATEGORIES,
  getSubcategoriesForCategory,
} from "@/lib/store-categories";

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
    subcategory: string | null;
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
  const [businessId, setBusinessId] = useState(existing?.businessId ?? "");
  const [listingType, setListingType] = useState<"new" | "resale">(
    resaleOnly ? "resale" : (existing?.listingType ?? "new")
  );
  const [title, setTitle] = useState(existing?.title ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [photos, setPhotos] = useState<string[]>(existing?.photos ?? []);
  const [category, setCategory] = useState(existing?.category ?? "");
  const [subcategory, setSubcategory] = useState(existing?.subcategory ?? "");
  const [useCustomCategory, setUseCustomCategory] = useState(() => {
    const c = existing?.category ?? "";
    return !!c && !STORE_CATEGORIES.some((x) => x.label === c);
  });
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
  type VariantOption = { value: string; quantity: number };
  const normalizeOptions = (opts: unknown): VariantOption[] => {
    if (!Array.isArray(opts)) return [];
    return opts.map((o) => {
      if (typeof o === "object" && o != null && "value" in o && "quantity" in o) {
        return { value: String((o as VariantOption).value), quantity: Number((o as VariantOption).quantity) || 0 };
      }
      return { value: String(o ?? ""), quantity: 1 };
    });
  };
  const [variants, setVariants] = useState<{ name: string; options: VariantOption[] }[]>(() => {
    const v = existing?.variants;
    if (!Array.isArray(v)) return [];
    return (v as { name?: string; options?: unknown[] }[]).map((item) => ({
      name: item?.name ?? "",
      options: normalizeOptions(item?.options),
    }));
  });
  const [optionsEnabled, setOptionsEnabled] = useState(() => {
    const v = existing?.variants;
    if (!Array.isArray(v) || v.length === 0) return false;
    return (v as { options?: unknown[] }[]).some((item) => Array.isArray(item?.options) && item.options.length > 0);
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
  const [editSuccess, setEditSuccess] = useState(false);
  const [listingEarnedBadges, setListingEarnedBadges] = useState<EarnedBadgeForOverlay[]>([]);
  const [listingBadgePopupIndex, setListingBadgePopupIndex] = useState(-1);
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

  useLockBodyScroll(showSuccessModal || listingBadgePopupIndex >= 0);

  const activeListingBadge =
    listingBadgePopupIndex >= 0 && listingBadgePopupIndex < listingEarnedBadges.length
      ? listingEarnedBadges[listingBadgePopupIndex]
      : null;

  function handleCloseListingBadgePopup() {
    if (listingBadgePopupIndex >= 0 && listingBadgePopupIndex < listingEarnedBadges.length - 1) {
      setListingBadgePopupIndex((i) => i + 1);
      return;
    }
    setListingEarnedBadges([]);
    setListingBadgePopupIndex(-1);
    setShowSuccessModal(true);
  }

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

  function mergeUploadedUrls(prev: string[], urls: string[]) {
    const next = [...prev];
    for (const url of urls) {
      if (!next.includes(url)) next.push(url);
    }
    return next;
  }

  async function handlePhotosChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files?.length) return;
    const fileArray = Array.from(files);
    setUploadingPhotos(true);
    setError("");
    const urls: string[] = [];
    try {
      for (const file of fileArray) {
        urls.push(await uploadFile(file));
      }
      setPhotos((prev) => mergeUploadedUrls(prev, urls));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      if (urls.length > 0) {
        setPhotos((prev) => mergeUploadedUrls(prev, urls));
      }
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
    const hasVariantsWithQty =
      optionsEnabled && variants.some((v) => v.name.trim() && v.options.some((o) => o.quantity > 0));
    if (!optionsEnabled && quantity < 1) {
      setError("Quantity must be at least 1 to list this item.");
      return;
    }
    if (optionsEnabled && !hasVariantsWithQty) {
      setError("Add at least one option with quantity greater than 0, or turn off Enable Options and set Quantity.");
      return;
    }
    const effectiveShippingDisabled = !offerShipping || shippingDisabled;
    const effectiveLocalDelivery = offerLocalDelivery && localDeliveryAvailable;
    const effectivePickup = offerLocalPickup && inStorePickupAvailable;
    if (effectiveShippingDisabled && !effectiveLocalDelivery && !effectivePickup) {
      setError("Enable at least one fulfillment method (shipping, local delivery, or pickup) in Policies.");
      return;
    }
    if (resaleOnly && !effectiveShippingDisabled && !effectiveShippingPolicy.trim()) {
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
        subcategory: subcategory.trim() || null,
        priceCents,
        status: "active",
        listingType: resaleOnly ? "resale" : listingType,
        quantity:
          optionsEnabled && variants.some((v) => v.name.trim() && v.options.some((o) => o.quantity > 0))
            ? sumOptionQuantities(variants.filter((v) => v.name.trim() && v.options.length > 0))
            : quantity,
        variants:
          optionsEnabled && variants.filter((v) => v.name.trim() && v.options.length > 0).length > 0
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
      let data: { error?: unknown; message?: string; earnedBadges?: unknown } = {};
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
      setEditSuccess(!!existing);
      if (!existing) {
        const earnedRaw = data.earnedBadges;
        const badges = Array.isArray(earnedRaw)
          ? (earnedRaw as EarnedBadgeForOverlay[]).filter((b) => b?.slug && b?.name)
          : [];
        if (badges.length > 0) {
          setListingEarnedBadges(badges);
          setListingBadgePopupIndex(0);
        } else {
          setShowSuccessModal(true);
        }
      } else {
        setShowSuccessModal(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleSuccessModalClose() {
    setShowSuccessModal(false);
    const redirectTo = successRedirect ?? (resaleOnly ? "/resale-hub" : "/seller-hub/store/items");
    router.push(redirectTo);
    router.refresh();
  }
  function handleListAnother() {
    setShowSuccessModal(false);
    router.push(resaleOnly ? "/resale-hub" : "/seller-hub/store/new");
    router.refresh();
  }

  function addVariantOption(vi: number, value: string) {
    if (!value.trim()) return;
    setVariants((prev) => {
      const next = prev.map((v) => ({ ...v, options: [...v.options] }));
      if (!next[vi]) return prev;
      next[vi] = { ...next[vi], options: [...next[vi].options, { value: value.trim(), quantity: 1 }] };
      return next;
    });
  }
  function setVariantOptionQuantity(vi: number, oi: number, quantity: number) {
    setVariants((prev) => {
      const next = prev.map((v) => ({ ...v, options: v.options.map((o) => ({ ...o })) }));
      if (next[vi]?.options[oi] != null) next[vi].options[oi].quantity = Math.max(0, quantity);
      return next;
    });
  }
  function removeVariantOption(vi: number, oi: number) {
    setVariants((prev) => {
      const next = prev.map((v) => ({ ...v, options: [...v.options] }));
      if (next[vi]) next[vi].options = next[vi].options.filter((_, i) => i !== oi);
      return next;
    });
  }

  return (
    <>
    <BadgeEarnedStackOverlay badge={activeListingBadge} onDismiss={handleCloseListingBadgePopup} />
    <form onSubmit={handleSubmit} className="space-y-6 max-w-xl mx-auto text-center">
      {!resaleOnly && businesses.length > 1 && (
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
        <div className="flex flex-col items-center">
          <label className="block text-sm font-medium mb-2 text-center">Where to list</label>
          <div className="flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => setListingType("new")}
              className="py-2 px-4 rounded-lg border-2 font-semibold text-sm transition-colors"
              style={
                listingType === "new"
                  ? { backgroundColor: "var(--color-primary)", borderColor: "var(--color-primary)", color: "white" }
                  : { backgroundColor: "white", borderColor: "#ccc", color: "#333" }
              }
            >
              New (NWC Storefront)
            </button>
            <button
              type="button"
              onClick={() => setListingType("resale")}
              className="py-2 px-4 rounded-lg border-2 font-semibold text-sm transition-colors"
              style={
                listingType === "resale"
                  ? { backgroundColor: "var(--color-primary)", borderColor: "var(--color-primary)", color: "white" }
                  : { backgroundColor: "white", borderColor: "#ccc", color: "#333" }
              }
            >
              Resale (NWC Resale)
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-2 text-center max-w-sm">
            New items appear on the main storefront; resale items appear on NWC Resale.
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

      {/* 4. Category & Subcategory */}
      <div className="space-y-3">
        <div>
          <span className="block text-sm font-medium mb-1">Category</span>
          <p className="text-xs text-gray-500 mb-2">
            Choose a main category, then optionally narrow with a subcategory.
          </p>
        </div>
        {useCustomCategory ? (
          <div className="space-y-2">
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Enter your category"
              className="w-full border rounded px-3 py-2"
            />
            <input
              type="text"
              value={subcategory}
              onChange={(e) => setSubcategory(e.target.value)}
              placeholder="Subcategory (optional)"
              className="w-full border rounded px-3 py-2"
            />
            <button
              type="button"
              onClick={() => {
                setUseCustomCategory(false);
                setCategory("");
                setSubcategory("");
              }}
              className="text-sm underline"
              style={{ color: "var(--color-primary)" }}
            >
              Choose from list instead
            </button>
          </div>
        ) : (
          <>
            <div>
              <label htmlFor="store-item-category" className="block text-xs font-medium text-gray-700 mb-1">
                Main category
              </label>
              <select
                id="store-item-category"
                value={category}
                onChange={(e) => {
                  const v = e.target.value;
                  setCategory(v);
                  setSubcategory("");
                }}
                className="w-full border rounded px-3 py-2 bg-white"
              >
                <option value="">Select a category…</option>
                {STORE_CATEGORIES.map((c) => (
                  <option key={c.label} value={c.label}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            {category ? (
              <div>
                <label htmlFor="store-item-subcategory" className="block text-xs font-medium text-gray-700 mb-1">
                  Subcategory (optional)
                </label>
                <select
                  id="store-item-subcategory"
                  value={subcategory}
                  onChange={(e) => setSubcategory(e.target.value)}
                  className="w-full border rounded px-3 py-2 bg-white"
                >
                  <option value="">— None —</option>
                  {getSubcategoriesForCategory(category).map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                  {subcategory && !getSubcategoriesForCategory(category).includes(subcategory) ? (
                    <option value={subcategory}>{subcategory}</option>
                  ) : null}
                </select>
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => setUseCustomCategory(true)}
              className="text-sm underline mt-1 block"
              style={{ color: "var(--color-primary)" }}
            >
              Can&apos;t find your category? Add your own
            </button>
          </>
        )}
      </div>

      {/* 5. Price */}
      <div>
        <label className="block text-sm font-medium mb-1">Price (USD) *</label>
        <input
          type="number"
          step="0.01"
          min="0.01"
          value={priceDollars}
          onChange={(e) => setPriceDollars(e.target.value)}
          className="w-full border rounded px-3 py-2 max-w-xs"
          required
        />
      </div>

      {/* 6. Options (Enable options + Quantity) — under Price */}
      <div className="space-y-4 border-t border-gray-200 pt-6 text-left">
        <h3 className="text-base font-bold text-gray-900 mb-3">Options (Size, Color, etc.)</h3>
        <div className="flex items-center gap-2.5 mb-4">
          <button
            type="button"
            role="checkbox"
            aria-checked={optionsEnabled}
            onClick={() => setOptionsEnabled((prev) => !prev)}
            className="w-[22px] h-[22px] rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors"
            style={
              optionsEnabled
                ? { backgroundColor: "var(--color-primary)", borderColor: "var(--color-primary)" }
                : { borderColor: "#ccc" }
            }
          >
            {optionsEnabled && <span className="text-white text-sm font-bold">✓</span>}
          </button>
          <span className="text-sm text-gray-900 font-medium">Enable Options</span>
        </div>
        {!optionsEnabled ? (
          <>
            <label className="block text-sm font-medium mb-1">Quantity *</label>
            <input
              type="number"
              min="0"
              value={quantity}
              onChange={(e) => setQuantity(parseInt(e.target.value, 10) || 0)}
              className="w-full border border-gray-300 rounded px-3 py-2 max-w-xs"
              placeholder="1"
            />
          </>
        ) : (
          <>
            <p className="text-sm text-gray-500 mb-3">
              Add option groups like Size with values and quantity per option (e.g. Small: 2, Medium: 5).
            </p>
            {variants.map((v, vi) => (
              <div key={vi} className="rounded-lg p-3 mb-3 bg-gray-50 border border-gray-100">
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={v.name}
                    onChange={(e) =>
                      setVariants((prev) => {
                        const next = prev.map((x) => ({ ...x }));
                        if (next[vi]) next[vi].name = e.target.value;
                        return next;
                      })
                    }
                    placeholder="Option name (e.g. Size)"
                    className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setVariants((prev) => prev.filter((_, i) => i !== vi))}
                    className="text-red-600 text-sm hover:underline shrink-0"
                  >
                    Remove
                  </button>
                </div>
                <p className="text-xs text-gray-500 mb-2">Option value and Quantity (e.g. Small: 3, Medium: 5)</p>
                <div className="flex flex-wrap gap-2 items-center">
                  {v.options.map((opt, oi) => (
                    <span
                      key={oi}
                      className="inline-flex items-center gap-1 bg-white border border-gray-300 rounded px-2 py-1 text-sm"
                    >
                      <span>{opt.value}</span>
                      <input
                        type="number"
                        min="0"
                        className="w-12 border border-gray-300 rounded px-1 py-0.5 text-sm text-center"
                        placeholder="0"
                        value={opt.quantity === 0 ? "" : opt.quantity}
                        onChange={(e) => {
                          const n = parseInt(e.target.value.replace(/\D/g, ""), 10);
                          setVariantOptionQuantity(vi, oi, Number.isNaN(n) ? 0 : n);
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => removeVariantOption(vi, oi)}
                        className="text-red-500 hover:text-red-700 font-bold leading-none"
                        aria-label="Remove"
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
              className="py-2 px-4 border border-gray-300 rounded-lg bg-white text-gray-800 font-semibold text-sm hover:bg-gray-50"
            >
              + Add option group
            </button>
          </>
        )}
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

      {error && <p className="text-red-600 text-sm">{error}</p>}
      <button type="submit" disabled={submitting} className="btn">
        {submitting
          ? "Saving…"
          : existing
            ? "Update item"
            : "List Item"}
      </button>

    </form>
      {showSuccessModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 overflow-hidden">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 text-center">
            <p className="text-lg font-bold text-gray-900 mb-2">
              {editSuccess ? "Item updated" : "Item listed successfully"}
            </p>
            <p className="text-gray-700 mb-6">
              {editSuccess ? "Your changes have been saved." : "Your listing is now live."}
            </p>
            <button
              type="button"
              onClick={handleSuccessModalClose}
              className="btn w-full mb-3"
            >
              {editSuccess ? "Back to My Items" : "See Listing"}
            </button>
            {!editSuccess && (
              <button
                type="button"
                onClick={handleListAnother}
                className="w-full py-3 px-4 rounded-lg border-2 font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                style={{ borderColor: "var(--color-primary)" }}
              >
                List Another Item
              </button>
            )}
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
