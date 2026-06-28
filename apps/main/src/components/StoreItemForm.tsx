"use client";

import { useState, useEffect, useCallback, useMemo, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { getErrorMessage } from "@/lib/api-error";
import { useLockBodyScroll } from "@/lib/scroll-lock";
import { BadgeEarnedStackOverlay, type EarnedBadgeForOverlay } from "@/components/BadgeEarnedStackOverlay";
import { sumOptionQuantities } from "@/lib/store-item-variants";
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

interface Business {
  id: string;
  name: string;
  slug: string;
}

type EbayCategorySuggestion = {
  categoryId: string;
  categoryName: string;
  categoryPath?: string;
};

type EbayCategoryAspect = {
  name: string;
  required: boolean;
  mode: "FREE_TEXT" | "SELECTION_ONLY";
  cardinality: "SINGLE" | "MULTI";
  suggestedValues: string[];
};

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
    condition?: "new" | "used";
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
    ebayCategoryId?: number | null;
    aspects?: { name: string; value: string }[] | null;
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
  const [description, setDescription] = useState(existing?.description ?? "");
  const [photos, setPhotos] = useState<string[]>(existing?.photos ?? []);
  const [category, setCategory] = useState(existing?.category ?? "");
  const [subcategory, setSubcategory] = useState(existing?.subcategory ?? "");
  const [useCustomCategory, setUseCustomCategory] = useState(() => {
    const c = existing?.category ?? "";
    return !!c && !STORE_CATEGORIES.some((x) => x.label === c);
  });
  // eBay integration: live leaf-category picker + item specifics (Details).
  const [ebayConnected, setEbayConnected] = useState(false);
  const [ebayCategoryId, setEbayCategoryId] = useState<string>(
    existing?.ebayCategoryId != null ? String(existing.ebayCategoryId) : ""
  );
  const [ebayCategoryLabel, setEbayCategoryLabel] = useState<string>("");
  const [ebayCategorySearch, setEbayCategorySearch] = useState("");
  const [ebayCategoryResults, setEbayCategoryResults] = useState<EbayCategorySuggestion[]>([]);
  const [ebaySearching, setEbaySearching] = useState(false);
  const [categoryAspects, setCategoryAspects] = useState<EbayCategoryAspect[]>([]);
  const [aspects, setAspects] = useState<ListingAspect[]>(() =>
    Array.isArray(existing?.aspects)
      ? existing!.aspects!.map((a) => ({ name: String(a.name ?? ""), value: String(a.value ?? "") }))
      : []
  );
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
  /** Whole dollars, 0 = no minimum (accept any offer). Max follows list price when set. */
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
  }, [existing?.shippingPolicy, existing?.localDeliveryTerms, existing?.pickupTerms]);

  useLockBodyScroll(showSuccessModal || listingBadgePopupIndex >= 0);

  const minOfferSliderMax = useMemo(() => {
    const raw = priceDollars.replace(/,/g, "").trim();
    const n = parseFloat(raw);
    if (!Number.isFinite(n) || n <= 0) return 500;
    return Math.min(5000, Math.max(1, Math.ceil(n)));
  }, [priceDollars]);

  useEffect(() => {
    setMinOfferSliderDollars((v) => Math.min(v, minOfferSliderMax));
  }, [minOfferSliderMax]);

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

  // Detect whether the seller has an active eBay connection (enables the category + Details pickers).
  useEffect(() => {
    fetch("/api/channels", { credentials: "include" })
      .then((r) => r.json())
      .then((data: { provider?: string; status?: string }[]) => {
        if (Array.isArray(data)) {
          setEbayConnected(
            data.some((c) => c.provider === "ebay" && c.status !== "disconnected")
          );
        }
      })
      .catch(() => {});
  }, []);

  // Debounced live eBay category search.
  useEffect(() => {
    if (!ebayConnected) return;
    const q = ebayCategorySearch.trim();
    if (q.length < 2) {
      setEbayCategoryResults([]);
      return;
    }
    let cancelled = false;
    setEbaySearching(true);
    const t = setTimeout(() => {
      fetch(`/api/channels/ebay/categories?q=${encodeURIComponent(q)}`, {
        credentials: "include",
      })
        .then((r) => r.json())
        .then((data: { categories?: EbayCategorySuggestion[] }) => {
          if (!cancelled) setEbayCategoryResults(data.categories ?? []);
        })
        .catch(() => {
          if (!cancelled) setEbayCategoryResults([]);
        })
        .finally(() => {
          if (!cancelled) setEbaySearching(false);
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [ebayCategorySearch, ebayConnected]);

  // When an eBay category is chosen, load its required/recommended item specifics and pre-seed rows.
  const loadCategoryAspects = useCallback(
    async (categoryId: string) => {
      if (!categoryId) {
        setCategoryAspects([]);
        return;
      }
      try {
        const res = await fetch(
          `/api/channels/ebay/category-aspects?categoryId=${encodeURIComponent(categoryId)}`,
          { credentials: "include" }
        );
        const data: { aspects?: EbayCategoryAspect[] } = await res.json();
        const list = data.aspects ?? [];
        setCategoryAspects(list);
        // Pre-seed required aspects that the seller has not already filled in.
        setAspects((prev) => {
          const existingNames = new Set(prev.map((a) => a.name.trim().toLowerCase()));
          const seeded = list
            .filter((a) => a.required && !existingNames.has(a.name.trim().toLowerCase()))
            .map((a) => ({ name: a.name, value: "" }));
          return [...prev, ...seeded].slice(0, MAX_ASPECTS);
        });
      } catch {
        setCategoryAspects([]);
      }
    },
    []
  );

  // Load aspects for a previously-saved eBay category on edit.
  useEffect(() => {
    if (ebayConnected && ebayCategoryId) {
      void loadCategoryAspects(ebayCategoryId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ebayConnected]);

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
    if (!effectiveShippingDisabled && !effectiveShippingPolicy.trim()) {
      setError("Shipping policy is required when you offer shipping. Set it in Policies.");
      return;
    }
    const effectivePickupPolicy = useSellerProfilePickup ? sellerProfilePickupPolicy : pickupTerms;
    if (effectivePickup && !effectivePickupPolicy.trim()) {
      setError("Pickup terms are required when you offer local pickup. Set them in Policies or use Sync here.");
      return;
    }
    const cleanedAspects = aspects
      .map((a) => ({ name: a.name.trim(), value: a.value.trim() }))
      .filter((a) => a.name && a.value);
    if (ebayConnected && ebayCategoryId) {
      const missingRequired = categoryAspects
        .filter((a) => a.required)
        .filter(
          (a) =>
            !cleanedAspects.some(
              (c) => c.name.toLowerCase() === a.name.trim().toLowerCase() && c.value
            )
        )
        .map((a) => a.name);
      if (missingRequired.length > 0) {
        setError(
          `eBay requires these item details for this category: ${missingRequired.join(", ")}. Fill them in under "Item details".`
        );
        return;
      }
    }
    setSubmitting(true);
    try {
      const payload = {
        businessId: businessId || null,
        title: title.trim(),
        description: description.trim() || null,
        photos,
        category: category.trim() || null,
        subcategory: subcategory.trim() || null,
        ebayCategoryId: ebayConnected && ebayCategoryId ? Number(ebayCategoryId) : null,
        aspects: cleanedAspects,
        priceCents,
        status: "active",
        condition,
        quantity:
          optionsEnabled && variants.some((v) => v.name.trim() && v.options.some((o) => o.quantity > 0))
            ? sumOptionQuantities(variants.filter((v) => v.name.trim() && v.options.length > 0))
            : quantity,
        variants:
          optionsEnabled && variants.filter((v) => v.name.trim() && v.options.length > 0).length > 0
            ? variants.filter((v) => v.name.trim() && v.options.length > 0)
            : null,
        shippingCostCents: !effectiveShippingDisabled && shippingCostCents > 0 ? shippingCostCents : null,
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
    const redirectTo = successRedirect ?? "/seller-hub/store/items";
    router.push(redirectTo);
    router.refresh();
  }
  function handleListAnother() {
    setShowSuccessModal(false);
    router.push("/seller-hub/store/new");
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
  /** Suggested values for a Descriptor that matches a known eBay category aspect. */
  function suggestionsForAspect(name: string): string[] {
    const match = categoryAspects.find((a) => a.name.trim().toLowerCase() === name.trim().toLowerCase());
    return match?.suggestedValues ?? [];
  }
  function isRequiredAspect(name: string): boolean {
    return categoryAspects.some(
      (a) => a.required && a.name.trim().toLowerCase() === name.trim().toLowerCase()
    );
  }

  return (
    <>
    <BadgeEarnedStackOverlay badge={activeListingBadge} onDismiss={handleCloseListingBadgePopup} />
    <form onSubmit={handleSubmit} className="space-y-6 max-w-xl mx-auto text-center">
      {businesses.length > 1 && (
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

      <div className="flex flex-col items-center">
        <label className="block text-sm font-medium mb-2 text-center">Condition</label>
        <div className="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => setCondition("new")}
            className="py-2 px-4 rounded-lg border-2 font-semibold text-sm transition-colors"
            style={
              condition === "new"
                ? { backgroundColor: "var(--color-primary)", borderColor: "var(--color-primary)", color: "white" }
                : { backgroundColor: "white", borderColor: "#ccc", color: "#333" }
            }
          >
            New
          </button>
          <button
            type="button"
            onClick={() => setCondition("used")}
            className="py-2 px-4 rounded-lg border-2 font-semibold text-sm transition-colors"
            style={
              condition === "used"
                ? { backgroundColor: "var(--color-primary)", borderColor: "var(--color-primary)", color: "white" }
                : { backgroundColor: "white", borderColor: "#ccc", color: "#333" }
            }
          >
            Used
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2 text-center max-w-sm">
          Buyers can filter the storefront by New or Used. Used items can accept offers.
        </p>
      </div>

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
          maxLength={EBAY_TITLE_MAX}
          onChange={(e) => setTitle(e.target.value.slice(0, EBAY_TITLE_MAX))}
          className="w-full border rounded px-3 py-2"
          required
        />
        <p className={`text-xs mt-1 text-right ${title.length >= EBAY_TITLE_MAX ? "text-red-600" : "text-gray-500"}`}>
          {title.length}/{EBAY_TITLE_MAX}
        </p>
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

      {/* 4b. eBay category + item details (only when eBay is connected) */}
      {ebayConnected && (
        <div className="space-y-4 border-t border-gray-200 pt-6 text-left">
          <div>
            <h3 className="text-base font-bold text-gray-900 mb-1">eBay category &amp; details</h3>
            <p className="text-xs text-gray-500">
              Pick the eBay category so this listing publishes with the right item specifics. eBay
              requires certain details (Brand, Type, etc.) before a listing can go live.
            </p>
          </div>

          {ebayCategoryId ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {ebayCategoryLabel || `eBay category #${ebayCategoryId}`}
                </p>
                <p className="text-xs text-gray-500">eBay category #{ebayCategoryId}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEbayCategoryId("");
                  setEbayCategoryLabel("");
                  setEbayCategorySearch("");
                  setCategoryAspects([]);
                }}
                className="text-sm text-red-600 hover:underline shrink-0"
              >
                Change
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <input
                type="text"
                value={ebayCategorySearch}
                onChange={(e) => setEbayCategorySearch(e.target.value)}
                placeholder="Search eBay categories (e.g. US coins, sneakers)…"
                className="w-full border rounded px-3 py-2"
              />
              {ebaySearching && <p className="text-xs text-gray-500">Searching eBay…</p>}
              {ebayCategoryResults.length > 0 && (
                <ul className="max-h-56 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
                  {ebayCategoryResults.map((c) => (
                    <li key={c.categoryId}>
                      <button
                        type="button"
                        onClick={() => {
                          setEbayCategoryId(c.categoryId);
                          setEbayCategoryLabel(c.categoryPath || c.categoryName);
                          setEbayCategoryResults([]);
                          setEbayCategorySearch("");
                          void loadCategoryAspects(c.categoryId);
                        }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                      >
                        <span className="font-medium text-gray-900">{c.categoryName}</span>
                        {c.categoryPath && c.categoryPath !== c.categoryName && (
                          <span className="block text-xs text-gray-500 truncate">{c.categoryPath}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Item details (eBay item specifics) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-900">Item details</span>
              <span className="text-xs text-gray-500">
                {aspects.length}/{MAX_ASPECTS}
              </span>
            </div>
            <p className="text-xs text-gray-500">
              Add a detail (Descriptor + Value), e.g. Brand → Nike, Year → 1921. Required details are
              marked with *.
            </p>
            {aspects.map((a, i) => {
              const required = isRequiredAspect(a.name);
              const suggestions = suggestionsForAspect(a.name);
              const listId = `aspect-values-${i}`;
              return (
                <div key={i} className="flex flex-wrap gap-2 items-start">
                  <input
                    type="text"
                    value={a.name}
                    maxLength={EBAY_ASPECT_NAME_MAX}
                    onChange={(e) => setAspectName(i, e.target.value)}
                    placeholder="Descriptor (e.g. Brand)"
                    className="flex-1 min-w-[120px] border rounded px-2 py-1.5 text-sm"
                  />
                  <div className="flex-1 min-w-[120px]">
                    <input
                      type="text"
                      value={a.value}
                      maxLength={EBAY_ASPECT_VALUE_MAX}
                      list={suggestions.length > 0 ? listId : undefined}
                      onChange={(e) => setAspectValue(i, e.target.value)}
                      placeholder={required ? "Value (required)" : "Value"}
                      className={`w-full border rounded px-2 py-1.5 text-sm ${
                        required && !a.value.trim() ? "border-red-400" : ""
                      }`}
                    />
                    {suggestions.length > 0 && (
                      <datalist id={listId}>
                        {suggestions.map((s) => (
                          <option key={s} value={s} />
                        ))}
                      </datalist>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeAspectRow(i)}
                    className="text-red-500 hover:text-red-700 font-bold leading-none px-2 py-1.5"
                    aria-label="Remove detail"
                  >
                    ×
                  </button>
                </div>
              );
            })}
            {aspects.length < MAX_ASPECTS && (
              <button
                type="button"
                onClick={addAspectRow}
                className="py-2 px-4 border border-gray-300 rounded-lg bg-white text-gray-800 font-semibold text-sm hover:bg-gray-50"
              >
                + Add a detail
              </button>
            )}
          </div>
        </div>
      )}

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
