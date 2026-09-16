"use client";

import { useState, useEffect, useCallback, useMemo, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getErrorMessage } from "@/lib/api-error";
import { useLockBodyScroll } from "@/lib/scroll-lock";
import {
  INVENTORY_TRACKING_MADE_TO_ORDER,
  parseInventoryTracking,
  serializeVariantMatrix,
  sumMatrixQuantities,
  moneyInputToEditable,
  moneyInputToIdle,
  sanitizePriceDraftInput,
  type InventoryTracking,
  type VariantAxisDef,
} from "@/lib/listing-variant-matrix";
import {
  initEditorFromVariants,
  ListingVariantMatrixEditor,
  serializeEditorMatrix,
  type EditorSkuRow,
} from "@/components/listing/ListingVariantMatrixEditor";
import { buildProductHref } from "@/lib/product-referrer";
import { ListingEditorLayout } from "@/components/store-item/ListingEditorLayout";
import { ListingFormSection } from "@/components/store-item/ListingFormSection";
import { ListingConditionToggle } from "@/components/store-item/ListingConditionToggle";
import { ListingPhotoGallery } from "@/components/store-item/ListingPhotoGallery";
import { ListingSaveBar } from "@/components/store-item/ListingSaveBar";
import { LISTING_SKU_MAX } from "@/lib/listing-sku";
import {
  listingHintClass,
  listingInputClass,
  listingLabelClass,
  listingSelectClass,
} from "@/components/store-item/listing-form-styles";
import {
  STORE_CATEGORIES,
  getSubcategoriesForCategory,
} from "@/lib/store-categories";
import {
  EBAY_TITLE_MAX,
  EBAY_ASPECT_NAME_MAX,
  EBAY_ASPECT_VALUE_MAX,
  MAX_ASPECTS,
  type ListingAspect,
} from "@/lib/listing-limits";
import {
  formatShippingOptionPackageSummary,
  shippingOptionNeedsMeasurements,
} from "@/lib/package-weight";
import { listingPhotoEffectiveMime } from "@/lib/listing-photo-upload";
import {
  formatListingPhotoSizeLabel,
  MAX_LISTING_PHOTO_BYTES,
  uploadListingPhoto,
} from "@/lib/upload-listing-photo-browser";

interface Business {
  id: string;
  name: string;
  slug: string;
}

interface StoreItemFormProps {
  existing?: {
    id: string;
    slug?: string;
    businessId: string | null;
    title: string;
    description: string | null;
    photos: string[];
    category: string | null;
    subcategory: string | null;
    priceCents: number;
    variants: unknown;
    quantity: number;
    inventoryTracking?: string | null;
    status: string;
    condition?: "new" | "used";
    shippingCostCents: number | null;
    shippingOptionId?: string | null;
    shippingPolicy: string | null;
    localDeliveryAvailable: boolean;
    localDeliveryFeeCents?: number | null;
    inStorePickupAvailable?: boolean;
    shippingDisabled?: boolean;
    localDeliveryTerms?: string | null;
    pickupTerms?: string | null;
    acceptOffers?: boolean;
    minOfferCents?: number | null;
    sku?: string | null;
  };
  /** Redirect after successful create/update (default: /seller-hub/store/items). */
  successRedirect?: string;
}

export function StoreItemForm({ existing, successRedirect }: StoreItemFormProps) {
  const router = useRouter();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [businessId, setBusinessId] = useState(existing?.businessId ?? "");
  const [condition, setCondition] = useState<"new" | "used">(existing?.condition ?? "new");
  const [title, setTitle] = useState(existing?.title ?? "");
  const [sku, setSku] = useState(existing?.sku ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [photos, setPhotos] = useState<string[]>(existing?.photos ?? []);
  const [category, setCategory] = useState(existing?.category ?? "");
  const [subcategory, setSubcategory] = useState(existing?.subcategory ?? "");
  const [useCustomCategory, setUseCustomCategory] = useState(() => {
    const c = existing?.category ?? "";
    return !!c && !STORE_CATEGORIES.some((x) => x.label === c);
  });
  const [aspects, setAspects] = useState<ListingAspect[]>([]);
  const [priceDollars, setPriceDollars] = useState(
    existing ? (existing.priceCents / 100).toFixed(2) : ""
  );
  const [quantity, setQuantity] = useState(existing?.quantity ?? 1);
  const [shippingCostDollars, setShippingCostDollars] = useState(
    existing?.shippingCostCents ? (existing.shippingCostCents / 100).toFixed(2) : ""
  );
  const [shippingOptionId, setShippingOptionId] = useState(existing?.shippingOptionId ?? "");
  type ShippingOptionChoice = {
    id: string;
    name: string;
    source: string;
    complete: boolean;
    lengthIn: number | null;
    widthIn: number | null;
    heightIn: number | null;
    weightLbs: number;
    weightOzRemainder: number;
    shippingCostCents?: number | null;
  };
  const [shippingOptions, setShippingOptions] = useState<ShippingOptionChoice[]>([]);
  const [offerFreeShippingOnInw, setOfferFreeShippingOnInw] = useState(false);
  const [shippingPolicy, setShippingPolicy] = useState(existing?.shippingPolicy ?? "");
  const [useSellerProfileShipping, setUseSellerProfileShipping] = useState(
    !existing?.shippingPolicy || existing.shippingPolicy === ""
  );
  const [sellerProfileShippingPolicy, setSellerProfileShippingPolicy] = useState("");
  const [inventoryTracking, setInventoryTracking] = useState<InventoryTracking>(() =>
    parseInventoryTracking(existing?.inventoryTracking)
  );
  const initialMatrix = initEditorFromVariants(existing?.variants);
  const [optionsEnabled, setOptionsEnabled] = useState(initialMatrix.optionsEnabled);
  const [variantAxes, setVariantAxes] = useState<VariantAxisDef[]>(initialMatrix.axes);
  const [variantSkus, setVariantSkus] = useState<EditorSkuRow[]>(initialMatrix.skus);
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
  const [minOfferSliderDollars, setMinOfferSliderDollars] = useState(() =>
    existing?.minOfferCents != null && existing.minOfferCents > 0
      ? Math.round(existing.minOfferCents / 100)
      : 0
  );
  const [offerShipping, setOfferShipping] = useState(true);
  const [offerLocalDelivery, setOfferLocalDelivery] = useState(true);
  const [offerLocalPickup, setOfferLocalPickup] = useState(true);
  const [offerFlagsLoaded, setOfferFlagsLoaded] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [editSuccess, setEditSuccess] = useState(false);
  const [successItemId, setSuccessItemId] = useState<string | null>(existing?.id ?? null);
  const [successItemSlug, setSuccessItemSlug] = useState<string | null>(existing?.slug ?? null);
  const [feedShareBusy, setFeedShareBusy] = useState(false);
  const [feedShareDone, setFeedShareDone] = useState(false);
  const [feedShareError, setFeedShareError] = useState<string | null>(null);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [successDetail, setSuccessDetail] = useState("");

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
  }, [existing?.shippingPolicy, existing?.localDeliveryTerms, existing?.pickupTerms, useSellerProfileShipping, useSellerProfilePickup]);

  useEffect(() => {
    fetch("/api/shipping-options", { credentials: "include" })
      .then((r) => r.json())
      .then((data: { options?: ShippingOptionChoice[]; offerFreeShippingOnInw?: boolean }) => {
        const options = Array.isArray(data?.options) ? data.options : [];
        setShippingOptions(options);
        const offerFree = Boolean(data?.offerFreeShippingOnInw);
        setOfferFreeShippingOnInw(offerFree);
        if (!existing) {
          if (offerFree) {
            setShippingCostDollars((prev) => prev || "0.00");
          }
          if (options.length === 1 && options[0]) {
            setShippingOptionId(options[0].id);
            if (!offerFree && options[0].shippingCostCents != null) {
              setShippingCostDollars((options[0].shippingCostCents / 100).toFixed(2));
            }
          }
        }
      })
      .catch(() => {});
  }, [existing]);

  useLockBodyScroll(showSuccessModal);

  const minOfferSliderMax = useMemo(() => {
    const raw = priceDollars.replace(/,/g, "").trim();
    const n = parseFloat(raw);
    if (!Number.isFinite(n) || n <= 0) return 500;
    return Math.min(5000, Math.max(1, Math.ceil(n)));
  }, [priceDollars]);

  useEffect(() => {
    setMinOfferSliderDollars((v) => Math.min(v, minOfferSliderMax));
  }, [minOfferSliderMax]);

  useEffect(() => {
    Promise.all([
      fetch("/api/businesses?mine=1").then((r) => r.json()),
      fetch("/api/businesses?list=meta").then((r) => r.json()),
      fetch("/api/seller-profile").then((r) => r.json()).catch(() => ({})),
    ]).then(([bizData, , profileData]) => {
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

  async function handlePhotosUpload(files: File[]) {
    setPhotoError("");
    setError("");
    setUploadingPhotos(true);
    const uploaded: string[] = [];
    const issues: string[] = [];

    for (const file of files) {
      const mime = listingPhotoEffectiveMime(file.name, file.type);
      if (!mime) {
        issues.push(`${file.name}: unsupported format`);
        continue;
      }
      const ext = mime.split("/")[1];
      if (file.size > MAX_LISTING_PHOTO_BYTES) {
        issues.push(
          `${file.name} is too large (${formatListingPhotoSizeLabel(file.size)})`
        );
        continue;
      }
      try {
        const url = await uploadListingPhoto(file, ext);
        uploaded.push(url);
      } catch (err) {
        issues.push(err instanceof Error ? err.message : "Upload failed");
      }
    }

    if (issues.length) {
      const message =
        issues.length === 1
          ? issues[0]
          : `${issues[0]} (${issues.length} photos had issues)`;
      setPhotoError(message);
      setError(message);
    }
    if (uploaded.length) {
      setPhotos((prev) => [...prev, ...uploaded]);
    }
    setUploadingPhotos(false);
  }

  function buildPayload(): Record<string, unknown> | null {
    const priceCents = Math.round(parseFloat(priceDollars) * 100);
    const shippingCostCents = shippingCostDollars
      ? Math.round(parseFloat(shippingCostDollars) * 100)
      : 0;
    if (!title.trim()) {
      setError("Title is required");
      return null;
    }
    if (isNaN(priceCents) || priceCents < 1) {
      setError("Price must be at least $0.01");
      return null;
    }
    const madeToOrder = inventoryTracking === INVENTORY_TRACKING_MADE_TO_ORDER;
    const enabledSkus = serializeEditorMatrix(optionsEnabled, variantAxes, variantSkus);
    if (!madeToOrder && !optionsEnabled && quantity < 1) {
      setError("Quantity must be at least 1 to list this item.");
      return null;
    }
    if (!madeToOrder && optionsEnabled && (!enabledSkus || enabledSkus.every((s) => s.quantity < 1))) {
      setError("Add at least one combination with quantity greater than 0, or turn off options and set Quantity.");
      return null;
    }
    if (optionsEnabled && variantAxes.length > 0 && !enabledSkus) {
      setError("Enable at least one option combination, or turn off Enable options.");
      return null;
    }
    const effectiveShippingDisabled = !offerShipping || shippingDisabled;
    const effectiveLocalDelivery = offerLocalDelivery && localDeliveryAvailable;
    const effectivePickup = offerLocalPickup && inStorePickupAvailable;
    if (effectiveShippingDisabled && !effectiveLocalDelivery && !effectivePickup) {
      setError("Enable at least one fulfillment method (shipping, local delivery, or pickup) in Policies.");
      return null;
    }
    if (!effectiveShippingDisabled && !effectiveShippingPolicy.trim()) {
      setError("Shipping policy is required when you offer shipping. Set it in Policies.");
      return null;
    }
    if (!existing && !effectiveShippingDisabled && !shippingOptionId) {
      setError("Choose a shipping option, or create one in Shipping options.");
      return null;
    }
    const effectivePickupPolicy = useSellerProfilePickup ? sellerProfilePickupPolicy : pickupTerms;
    if (effectivePickup && !effectivePickupPolicy.trim()) {
      setError("Pickup terms are required when you offer local pickup. Set them in Policies or use Sync here.");
      return null;
    }
    const cleanedAspects = aspects
      .map((a) => ({ name: a.name.trim(), value: a.value.trim() }))
      .filter((a) => a.name && a.value);

    return {
      businessId: businessId || null,
      title: title.trim(),
      sku: sku.trim() || null,
      description: description.trim() || null,
      photos,
      category: category.trim() || null,
      subcategory: subcategory.trim() || null,
      aspects: cleanedAspects,
      priceCents,
      status: "active",
      condition,
      inventoryTracking,
      quantity: madeToOrder
        ? quantity
        : enabledSkus
          ? sumMatrixQuantities({ axes: variantAxes, skus: enabledSkus })
          : quantity,
      variants:
        optionsEnabled && enabledSkus
          ? serializeVariantMatrix({ axes: variantAxes, skus: enabledSkus })
          : null,
      shippingCostCents: !effectiveShippingDisabled && shippingCostCents > 0 ? shippingCostCents : null,
      shippingOptionId: shippingOptionId || null,
      shippingPolicy:
        effectiveShippingDisabled || useSellerProfileShipping ? null : shippingPolicy.trim() || null,
      localDeliveryAvailable: effectiveLocalDelivery,
      localDeliveryFeeCents: effectiveLocalDelivery && localDeliveryFeeDollars
        ? Math.round(parseFloat(localDeliveryFeeDollars) * 100)
        : null,
      inStorePickupAvailable: effectivePickup,
      shippingDisabled: effectiveShippingDisabled,
      localDeliveryTerms: effectiveLocalDelivery ? (localDeliveryTerms.trim() || null) : null,
      pickupTerms:
        effectivePickup && !useSellerProfilePickup ? (pickupTerms.trim() || null) : null,
      ...(condition === "used"
        ? {
            acceptOffers,
            minOfferCents: (() => {
              if (!acceptOffers || minOfferSliderDollars <= 0) return null;
              const capped = Math.min(minOfferSliderDollars, minOfferSliderMax);
              const cents = capped * 100;
              return cents >= 0 ? cents : null;
            })(),
          }
        : { acceptOffers: false }),
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const payload = buildPayload();
    if (!payload) return;

    setSubmitting(true);
    try {
      const url = existing ? `/api/store-items/${existing.id}` : "/api/store-items";
      const method = existing ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      let data: {
        error?: unknown;
        message?: string;
        id?: string;
        slug?: string;
        photos?: string[];
      } = {};
      try {
        const text = await res.text();
        if (text) data = JSON.parse(text);
      } catch {
        data = {
          error: res.status === 500 ? "Server error. Check the terminal for details." : `Request failed (${res.status}).`,
        };
      }
      if (!res.ok) {
        setError(getErrorMessage(data?.error, data?.message ?? "Failed to save"));
        return;
      }

      setEditSuccess(!!existing);
      setSuccessItemId(data.id ?? existing?.id ?? null);
      setSuccessItemSlug(data.slug ?? existing?.slug ?? null);
      setFeedShareDone(false);
      setFeedShareError(null);
      if (Array.isArray(data.photos) && data.photos.length > 0) {
        setPhotos(data.photos);
      }
      setSuccessDetail(
        existing
          ? "Your changes have been saved on INW."
          : "Your listing is now live on INW."
      );
      setShowSuccessModal(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleSuccessModalClose() {
    setShowSuccessModal(false);
    const redirectTo = successRedirect ?? "/seller-hub/store/items";
    router.push(redirectTo);
    router.refresh();
  }

  async function handleShareToFeed() {
    if (!successItemId || feedShareBusy || feedShareDone) return;
    setFeedShareBusy(true);
    setFeedShareError(null);
    try {
      const res = await fetch("/api/store-items/share-to-feed", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeItemIds: [successItemId] }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setFeedShareError(data.error ?? "Could not share to the feed.");
        return;
      }
      setFeedShareDone(true);
    } catch {
      setFeedShareError("Connection failed.");
    } finally {
      setFeedShareBusy(false);
    }
  }

  function handleSeeListing() {
    if (!successItemSlug) {
      handleSuccessModalClose();
      return;
    }
    setShowSuccessModal(false);
    router.push(buildProductHref(successItemSlug, { type: "my-items" }));
  }

  function handleEditListing() {
    setShowSuccessModal(false);
    if (successItemId && existing?.id !== successItemId) {
      router.push(`/seller-hub/store/${successItemId}`);
      return;
    }
    router.refresh();
  }

  function handleListAnother() {
    setShowSuccessModal(false);
    router.push("/seller-hub/store/new");
    router.refresh();
  }

  function addAspectRow() {
    setAspects((prev) => (prev.length >= MAX_ASPECTS ? prev : [...prev, { name: "", value: "" }]));
  }
  function setAspectName(i: number, name: string) {
    setAspects((prev) => prev.map((a, idx) => (idx === i ? { ...a, name: name.slice(0, EBAY_ASPECT_NAME_MAX) } : a)));
  }
  function setAspectValue(i: number, value: string) {
    setAspects((prev) => prev.map((a, idx) => (idx === i ? { ...a, value: value.slice(0, EBAY_ASPECT_VALUE_MAX) } : a)));
  }
  function removeAspectRow(i: number) {
    setAspects((prev) => prev.filter((_, idx) => idx !== i));
  }

  return (
    <>
      <form onSubmit={handleSubmit}>
        <ListingEditorLayout
          sidebar={
            <>
              <ListingFormSection title="Photos" description="First photo is your main listing image.">
                <ListingPhotoGallery
                  photos={photos}
                  onPhotosChange={setPhotos}
                  onUploadFiles={handlePhotosUpload}
                  uploadingPhotos={uploadingPhotos}
                  photoError={photoError}
                />
              </ListingFormSection>

              <ListingFormSection id="listing-condition" title="Condition">
                <ListingConditionToggle
                  value={condition}
                  onChange={setCondition}
                  hint="Buyers can filter the storefront by New or Used. Used items can accept offers."
                />
              </ListingFormSection>
            </>
          }
          main={
            <>
              {businesses.length > 1 ? (
                <ListingFormSection title="Business">
                  <label className={listingLabelClass}>Business (optional)</label>
                  <select
                    value={businessId}
                    onChange={(e) => setBusinessId(e.target.value)}
                    className={listingSelectClass}
                  >
                    <option value="">None</option>
                    {businesses.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </ListingFormSection>
              ) : null}

              <ListingFormSection title="Listing Details" description="Title, SKU, description, and category.">
                <div>
                  <label className={listingLabelClass}>Title *</label>
                  <input
                    type="text"
                    value={title}
                    maxLength={EBAY_TITLE_MAX}
                    onChange={(e) => setTitle(e.target.value.slice(0, EBAY_TITLE_MAX))}
                    className={listingInputClass}
                    required
                  />
                  <p className={`text-xs mt-1 text-right ${title.length >= EBAY_TITLE_MAX ? "text-red-600" : "text-gray-500"}`}>
                    {title.length}/{EBAY_TITLE_MAX}
                  </p>
                </div>

                <div>
                  <label className={listingLabelClass} htmlFor="listing-sku">
                    SKU
                  </label>
                  <input
                    id="listing-sku"
                    type="text"
                    value={sku}
                    maxLength={LISTING_SKU_MAX}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(e) => setSku(e.target.value.slice(0, LISTING_SKU_MAX))}
                    className={`${listingInputClass} max-w-md font-mono`}
                    placeholder="Optional — your stock keeping unit"
                  />
                  <p className={listingHintClass}>
                    Leave blank to auto-generate.
                  </p>
                </div>

                <div>
                  <label className={listingLabelClass}>Item Description</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className={listingInputClass}
                    rows={4}
                  />
                </div>

                <div className="space-y-3">
                  <div>
                    <span className={listingLabelClass}>Category</span>
                    <p className={listingHintClass}>
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
                        className={listingInputClass}
                      />
                      <input
                        type="text"
                        value={subcategory}
                        onChange={(e) => setSubcategory(e.target.value)}
                        placeholder="Subcategory (optional)"
                        className={listingInputClass}
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
              </ListingFormSection>

              <ListingFormSection
                title="Item Details"
                description="Add optional descriptors for your listing (Brand, Material, Year, etc.)."
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-gray-900">Descriptors</span>
                    <span className="text-xs text-gray-500">
                      {aspects.length}/{MAX_ASPECTS}
                    </span>
                  </div>
                  {aspects.map((a, i) => (
                    <div key={i} className="space-y-1">
                      <div className="flex flex-wrap gap-2 items-start">
                        <input
                          type="text"
                          value={a.name}
                          maxLength={EBAY_ASPECT_NAME_MAX}
                          onChange={(e) => setAspectName(i, e.target.value)}
                          placeholder="Descriptor (e.g. Brand)"
                          className="flex-1 min-w-[120px] border rounded px-2 py-1.5 text-sm"
                        />
                        <input
                          type="text"
                          value={a.value}
                          maxLength={EBAY_ASPECT_VALUE_MAX}
                          onChange={(e) => setAspectValue(i, e.target.value)}
                          placeholder="Value"
                          className="flex-1 min-w-[120px] border rounded px-2 py-1.5 text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => removeAspectRow(i)}
                          className="text-red-500 hover:text-red-700 font-bold leading-none px-2 py-1.5"
                          aria-label="Remove detail"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  ))}
                  {aspects.length < MAX_ASPECTS && (
                    <button
                      type="button"
                      onClick={addAspectRow}
                      className="action-pill action-pill-sm btn-pill-outline"
                    >
                      + Add a detail
                    </button>
                  )}
                </div>
              </ListingFormSection>

              <ListingFormSection title="Pricing & Inventory">
                <div>
                  <label className={listingLabelClass}>Price (USD) *</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={priceDollars}
                    onFocus={() => setPriceDollars((prev) => moneyInputToEditable(prev))}
                    onChange={(e) => {
                      const t = sanitizePriceDraftInput(e.target.value);
                      if (t != null) setPriceDollars(t);
                    }}
                    onBlur={() => setPriceDollars((prev) => moneyInputToIdle(prev))}
                    className={`${listingInputClass} max-w-xs`}
                    required
                  />
                </div>

                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-gray-900">Options (Size, Color, etc.)</h3>
                  <ListingVariantMatrixEditor
                    inventoryTracking={inventoryTracking}
                    onInventoryTrackingChange={setInventoryTracking}
                    optionsEnabled={optionsEnabled}
                    onOptionsEnabledChange={setOptionsEnabled}
                    simpleQuantity={quantity}
                    onSimpleQuantityChange={setQuantity}
                    axes={variantAxes}
                    skus={variantSkus}
                    onChange={(nextAxes, nextSkus) => {
                      setVariantAxes(nextAxes);
                      setVariantSkus(nextSkus);
                    }}
                    galleryPhotos={photos}
                  />
                </div>

                {condition === "used" && (
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
                        <label className="block text-sm font-medium mb-1" htmlFor="store-min-offer-range">
                          Automatically decline offers less than
                        </label>
                        <div className="w-full max-w-xs space-y-2 pt-1">
                          <input
                            id="store-min-offer-range"
                            type="range"
                            min={0}
                            max={minOfferSliderMax}
                            step={1}
                            value={Math.min(minOfferSliderDollars, minOfferSliderMax)}
                            onChange={(e) => setMinOfferSliderDollars(Number(e.target.value))}
                            className="store-min-offer-range w-full"
                            style={
                              {
                                ["--range-pct" as string]: `${
                                  minOfferSliderMax > 0
                                    ? (Math.min(minOfferSliderDollars, minOfferSliderMax) / minOfferSliderMax) * 100
                                    : 0
                                }%`,
                              } as CSSProperties
                            }
                          />
                          <p className="text-sm font-semibold text-gray-900">
                            {minOfferSliderDollars <= 0
                              ? "$0 — accept any offer"
                              : `Minimum offer: $${Math.min(minOfferSliderDollars, minOfferSliderMax).toFixed(2)}`}
                          </p>
                          <p className="text-xs text-gray-500">
                            Slide to set a floor, or leave at $0 to accept any amount. Upper end matches your list price
                            (or up to $500 until a price is set).
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </ListingFormSection>

              {offerFlagsLoaded && (offerShipping || offerLocalDelivery || offerLocalPickup) && (
                <ListingFormSection title="Delivery options">
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
                              className={listingInputClass}
                              placeholder="e.g. 5.99"
                            />
                            <p className="text-xs text-gray-500 mt-0.5">Price charged for shipping this item</p>
                          </div>
                          <div>
                            <label className="block text-sm font-medium mb-1">Shipping option (package)</label>
                            <select
                              className={listingSelectClass}
                              value={shippingOptionId}
                              onChange={(e) => {
                                const id = e.target.value;
                                setShippingOptionId(id);
                                if (offerFreeShippingOnInw) {
                                  setShippingCostDollars((prev) => prev || "0.00");
                                  return;
                                }
                                const selected = shippingOptions.find((o) => o.id === id);
                                if (selected?.shippingCostCents != null) {
                                  setShippingCostDollars((selected.shippingCostCents / 100).toFixed(2));
                                }
                              }}
                              required={!existing}
                            >
                              <option value="">{existing ? "None (INW defaults)" : "Select a package"}</option>
                              {shippingOptions.map((opt) => (
                                <option key={opt.id} value={opt.id}>
                                  {opt.name}
                                  {opt.shippingCostCents != null
                                    ? opt.shippingCostCents === 0
                                      ? " · Free"
                                      : ` · $${(opt.shippingCostCents / 100).toFixed(2)}`
                                    : ""}
                                  {shippingOptionNeedsMeasurements(opt) ? " — needs weight and size" : ""}
                                </option>
                              ))}
                            </select>
                            {(() => {
                              const selected = shippingOptions.find((o) => o.id === shippingOptionId);
                              if (!selected) return null;
                              const pkg = formatShippingOptionPackageSummary(
                                selected,
                                "Needs weight and size — Shippo will use defaults until you add measurements."
                              );
                              const price =
                                selected.shippingCostCents != null
                                  ? selected.shippingCostCents === 0
                                    ? "Free"
                                    : `$${(selected.shippingCostCents / 100).toFixed(2)}`
                                  : "";
                              const line = [pkg, price].filter(Boolean).join(" · ");
                              if (!line) return null;
                              return <p className="text-xs text-gray-500 mt-0.5">{line}</p>;
                            })()}
                            <p className="text-xs text-gray-500 mt-0.5">
                              Used for Shippo labels.{" "}
                              <Link href="/seller-hub/shipping-options" className="underline">
                                Manage shipping options
                              </Link>
                            </p>
                          </div>
                          <div>
                            <label className="block text-sm font-medium mb-1">Shipping Policy</label>
                            <div className="flex gap-2 items-start">
                              <textarea
                                value={useSellerProfileShipping ? effectiveShippingPolicy : shippingPolicy}
                                onChange={(e) => {
                                  if (useSellerProfileShipping) return;
                                  setShippingPolicy(e.target.value);
                                }}
                                readOnly={useSellerProfileShipping}
                                className={`w-full border rounded px-3 py-2 flex-1 min-w-0 ${useSellerProfileShipping ? "bg-gray-50" : ""}`}
                                rows={3}
                                placeholder="e.g. 2-5 business days via USPS. Free over $50."
                              />
                            </div>
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
                </ListingFormSection>
              )}

              {offerFlagsLoaded && !(offerShipping || offerLocalDelivery || offerLocalPickup) && (
                <ListingFormSection>
                  <p className="text-sm text-gray-600 mb-2">
                    Set your fulfillment options in Policies (shipping, local delivery, pickup) to enable them here.
                  </p>
                  <a href="/my-community" className="text-[var(--color-primary)] hover:underline text-sm">Open Policies</a>
                </ListingFormSection>
              )}
            </>
          }
          footer={
            <ListingSaveBar
              isEdit={!!existing}
              submitting={submitting}
              error={error}
              backHref={successRedirect ?? "/seller-hub/store/items"}
              createHint="List on INW."
            />
          }
        />
      </form>

      {showSuccessModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 overflow-hidden">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 text-center">
            <SuccessPhotoCollage urls={photos} />
            <p className="text-lg font-bold text-gray-900 mb-2">
              {editSuccess ? "Item Updated" : "Item listed successfully"}
            </p>
            <p className="text-gray-700 mb-6">{successDetail}</p>
            {!editSuccess && successItemId ? (
              <div className="mb-5 text-left rounded-xl border-2 p-4" style={{ borderColor: "var(--color-primary)" }}>
                <p className="font-semibold mb-1" style={{ color: "var(--color-heading)" }}>
                  Share your item on the Community Feed?
                </p>
                <p className="text-sm mb-3" style={{ color: "var(--color-text)" }}>
                  Neighbors who follow you will see this listing in the feed.
                </p>
                {feedShareError ? <p className="text-sm text-red-700 mb-2">{feedShareError}</p> : null}
                {feedShareDone ? (
                  <p className="text-sm font-semibold" style={{ color: "var(--color-primary)" }}>
                    Shared to the Community Feed.
                  </p>
                ) : (
                  <button
                    type="button"
                    disabled={feedShareBusy}
                    className="btn w-full disabled:opacity-50"
                    onClick={() => void handleShareToFeed()}
                  >
                    {feedShareBusy ? "Sharing…" : "Share"}
                  </button>
                )}
              </div>
            ) : null}
            <button
              type="button"
              onClick={handleSeeListing}
              className="btn w-full mb-3"
            >
              See Listing
            </button>
            <button
              type="button"
              onClick={handleEditListing}
              className="w-full py-3 px-4 rounded-lg border-2 font-semibold text-gray-700 hover:bg-gray-50 transition-colors mb-3"
              style={{ borderColor: "var(--color-primary)" }}
            >
              Edit Listing
            </button>
            {!editSuccess && (
              <button
                type="button"
                onClick={handleListAnother}
                className="w-full py-3 px-4 rounded-lg border-2 font-semibold text-gray-700 hover:bg-gray-50 transition-colors mb-3"
                style={{ borderColor: "var(--color-primary)" }}
              >
                List Another Item
              </button>
            )}
            <button
              type="button"
              onClick={handleSuccessModalClose}
              className="text-sm text-gray-600 hover:underline"
            >
              Back to My Items
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function SuccessPhotoCollage({ urls }: { urls: string[] }) {
  const shown = urls.filter(Boolean).slice(0, 4);
  if (shown.length === 0) return null;
  if (shown.length === 1) {
    return (
      <div className="mb-4 overflow-hidden rounded-lg">
        <img src={shown[0]} alt="" className="w-full h-40 object-cover" />
      </div>
    );
  }
  if (shown.length === 2) {
    return (
      <div className="mb-4 grid grid-cols-2 gap-1 overflow-hidden rounded-lg h-36">
        {shown.map((src, i) => (
          <img key={`${src}-${i}`} src={src} alt="" className="w-full h-full object-cover" />
        ))}
      </div>
    );
  }
  if (shown.length === 3) {
    return (
      <div className="mb-4 grid grid-cols-2 grid-rows-2 gap-1 overflow-hidden rounded-lg h-40">
        <img src={shown[0]} alt="" className="row-span-2 w-full h-full object-cover" />
        <img src={shown[1]} alt="" className="w-full h-full object-cover" />
        <img src={shown[2]} alt="" className="w-full h-full object-cover" />
      </div>
    );
  }
  return (
    <div className="mb-4 grid grid-cols-2 grid-rows-2 gap-1 overflow-hidden rounded-lg h-44">
      {shown.map((src, i) => (
        <img key={`${src}-${i}`} src={src} alt="" className="w-full h-full object-cover" />
      ))}
    </div>
  );
}
