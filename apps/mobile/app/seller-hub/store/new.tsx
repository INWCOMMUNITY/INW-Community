import React, { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  Image,
  ActivityIndicator,
  Switch,
  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  Linking,
} from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useNavigation, usePreventRemove } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import {
  theme as defaultTheme,
  switchIosBackgroundColor,
  switchThumbColor,
  switchTrackColor,
} from "@/lib/theme";
import { useTheme } from "@/contexts/ThemeContext";
import { apiGet, apiPost, apiPatch, getToken } from "@/lib/api";
import {
  formatListingPhotoSizeLabel,
  MAX_LISTING_PHOTO_BYTES,
  uploadListingPhotoFile,
} from "@/lib/upload-listing-photo";
import {
  formatShippingOptionPackageSummary,
  shippingOptionNeedsMeasurements,
} from "@/lib/shipping-option-display";
import { getDraft, saveDraft, deleteDraft } from "@/lib/drafts";
import {
  ListingOptionsEditor,
  buildVariantsPayload,
  parseVariantsToEditor,
  sumEnabledSkus,
  type InventoryMode,
  type EditorSkuRow,
} from "@/components/listing/ListingOptionsEditor";
import { ListingBuyerFieldsEditor } from "@/components/listing/ListingBuyerFieldsEditor";
import {
  buyerFieldsFromExisting,
  buyerFieldsToPayload,
  type BuyerFieldDraft,
} from "@/lib/listing-buyer-fields";
import {
  parseInventoryTracking,
  rebuildMatrixFromAxes,
  moneyInputToEditable,
  moneyInputToIdle,
  sanitizePriceDraftInput,
  type InventoryTracking,
  type VariantAxisDef,
} from "@/lib/listing-variant-matrix";
import { TemplateSelector, type ListingTemplate } from "@/components/listing/TemplateSelector";
import { SelectField } from "@/components/listing/SelectField";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

const TITLE_MAX = 80;

const ETSY_WHO = [
  { id: "i_did", label: "I did" },
  { id: "collective", label: "A member of my shop" },
  { id: "someone_else", label: "Another company or person" },
] as const;

const ETSY_WHEN = [
  { id: "2020_2026", label: "2020–2026" },
  { id: "2010_2019", label: "2010–2019" },
  { id: "2007_2009", label: "2007–2009" },
  { id: "before_2007", label: "Before 2007" },
  { id: "2000_2006", label: "2000–2006" },
  { id: "1990s", label: "1990s" },
  { id: "1980s", label: "1980s" },
  { id: "1970s", label: "1970s" },
  { id: "1960s", label: "1960s" },
  { id: "1950s", label: "1950s" },
  { id: "1940s", label: "1940s" },
  { id: "1930s", label: "1930s" },
  { id: "1920s", label: "1920s" },
  { id: "1910s", label: "1910s" },
  { id: "1900s", label: "1900s" },
  { id: "1800s", label: "1800s" },
  { id: "1700s", label: "1700s" },
  { id: "before_1700", label: "Before 1700" },
] as const;

function toFullUrl(url: string): string {
  return url.startsWith("http") ? url : `${siteBase}${url.startsWith("/") ? "" : "/"}${url}`;
}

interface Business {
  id: string;
  name: string;
  slug: string;
}

interface StoreCategoryOption {
  label: string;
  subcategories: string[];
}

interface PoliciesResponse {
  sellerShippingPolicy?: string;
  sellerLocalDeliveryPolicy?: string;
  sellerPickupPolicy?: string;
  offerShipping?: boolean;
  offerLocalDelivery?: boolean;
  offerLocalPickup?: boolean;
}

type ShippingOptionChoice = {
  id: string;
  name: string;
  complete: boolean;
  lengthIn: number | null;
  widthIn: number | null;
  heightIn: number | null;
  weightLbs: number;
  weightOzRemainder: number;
  shippingCostCents?: number | null;
};

const PLACEHOLDER_COLOR = "#888888";

export default function ListItemScreen() {
  const theme = useTheme();
  const router = useRouter();
  const navigation = useNavigation();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const params = useLocalSearchParams<{
    draftId?: string;
    edit?: string;
    similar?: string;
    condition?: string;
    listingType?: string;
  }>();
  const draftId = params.draftId;
  const editId = params.edit?.trim() || undefined;
  const similarId = !editId ? params.similar?.trim() || undefined : undefined;
  const conditionParam =
    params.condition === "used" || params.listingType === "resale" ? "used" : "new";
  const placeholderColor = PLACEHOLDER_COLOR;

  useLayoutEffect(() => {
    navigation.setOptions({
      title: editId ? "Edit Item" : similarId ? "Sell Similar" : "List an Item",
      contentStyle: { backgroundColor: "#fff" },
    });
  }, [navigation, editId, similarId]);

  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [storeCategories, setStoreCategories] = useState<StoreCategoryOption[]>([]);
  const [sellerProfileShippingPolicy, setSellerProfileShippingPolicy] = useState("");
  const [sellerProfileLocalDeliveryPolicy, setSellerProfileLocalDeliveryPolicy] = useState("");
  const [sellerProfilePickupPolicy, setSellerProfilePickupPolicy] = useState("");
  const [offerShipping, setOfferShipping] = useState(true);
  const [offerLocalDelivery, setOfferLocalDelivery] = useState(true);
  const [offerLocalPickup, setOfferLocalPickup] = useState(true);
  const [useSellerProfilePickup, setUseSellerProfilePickup] = useState(true);
  const [useSellerProfileLocalDelivery, setUseSellerProfileLocalDelivery] = useState(true);
  const [pickupTerms, setPickupTerms] = useState("");
  const [policiesLoaded, setPoliciesLoaded] = useState(false);

  const [title, setTitle] = useState("");
  const [sku, setSku] = useState("");
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [category, setCategory] = useState("");
  const [secondaryCategory, setSecondaryCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [useCustomCategory, setUseCustomCategory] = useState(false);
  const [categorySearch, setCategorySearch] = useState("");
  const [priceCents, setPriceCents] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [condition, setCondition] = useState<"new" | "used">(conditionParam);
  const [shippingDisabled, setShippingDisabled] = useState(false);
  const [shippingCostDollars, setShippingCostDollars] = useState("");
  const [shippingFree, setShippingFree] = useState(false);
  const [shippingOptionId, setShippingOptionId] = useState("");
  const [shippingOptions, setShippingOptions] = useState<ShippingOptionChoice[]>([]);
  const [offerFreeShippingOnInw, setOfferFreeShippingOnInw] = useState(false);
  const [shippingPolicy, setShippingPolicy] = useState("");
  const [useSellerProfileShipping, setUseSellerProfileShipping] = useState(true);
  const [localDeliveryAvailable, setLocalDeliveryAvailable] = useState(false);
  const [localDeliveryFeeDollars, setLocalDeliveryFeeDollars] = useState("");
  const [localDeliveryTerms, setLocalDeliveryTerms] = useState("");
  const [inStorePickupAvailable, setInStorePickupAvailable] = useState(false);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [inventoryMode, setInventoryMode] = useState<InventoryMode>("simple");
  const [pricesVary, setPricesVary] = useState(false);
  const [quantitiesVary, setQuantitiesVary] = useState(true);
  const [buyerFields, setBuyerFields] = useState<BuyerFieldDraft[]>([]);
  const [inventoryTracking, setInventoryTracking] = useState<InventoryTracking>("tracked");
  const [variantAxes, setVariantAxes] = useState<VariantAxisDef[]>([]);
  const [variantSkus, setVariantSkus] = useState<EditorSkuRow[]>([]);
  const [acceptOffers, setAcceptOffers] = useState(true);

  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [loadedDraft, setLoadedDraft] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [showListingSuccessModal, setShowListingSuccessModal] = useState(false);
  const [createdItemId, setCreatedItemId] = useState<string | null>(null);
  const [feedShareBusy, setFeedShareBusy] = useState(false);
  const [feedShareDone, setFeedShareDone] = useState(false);
  const [editSuccess, setEditSuccess] = useState(false);
  const [shopifyConn, setShopifyConn] = useState<{
    status: string;
    inventoryReady: boolean;
    locationSelectionRequired: boolean;
    shopDomain?: string | null;
  } | null>(null);
  const [shopifyBusy, setShopifyBusy] = useState(false);
  const [shopifyMessage, setShopifyMessage] = useState<string | null>(null);
  const [shopifyMappedProductId, setShopifyMappedProductId] = useState<string | null>(null);
  const [listOnShopifyAfterSave, setListOnShopifyAfterSave] = useState(false);
  const [etsyConnected, setEtsyConnected] = useState(false);
  const [etsyShippingReady, setEtsyShippingReady] = useState(false);
  const [etsyMappedListingId, setEtsyMappedListingId] = useState<string | null>(null);
  const [etsyMappedLive, setEtsyMappedLive] = useState(false);
  const [listOnEtsy, setListOnEtsy] = useState(false);
  const [etsyWhoMade, setEtsyWhoMade] = useState("");
  const [etsyWhenMade, setEtsyWhenMade] = useState("");
  const [etsyIsSupply, setEtsyIsSupply] = useState<boolean | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [allowLeave, setAllowLeave] = useState(false);
  const pendingLeaveRef = useRef<(() => void) | null>(null);
  const submittedRef = useRef(false);

  const effectiveStoreItemId = editId ?? createdItemId ?? null;
  const shopifyConnected = shopifyConn?.status === "ACTIVE";

  const refreshShopifyReadiness = useCallback(async (storeItemId: string | null) => {
    if (!storeItemId) {
      setShopifyMappedProductId(null);
      return;
    }
    try {
      const readiness = await apiGet<{
        alreadyMapped?: boolean;
        shopifyProductId?: string | null;
        blockers?: Array<{ code: string; message: string }>;
      }>(`/api/shopify/listings/${storeItemId}/export-readiness`);
      setShopifyMappedProductId(
        readiness.alreadyMapped ? readiness.shopifyProductId ?? "mapped" : null
      );
    } catch {
      /* keep prior mapped state */
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      apiGet<{
        connections?: Array<{
          status: string;
          inventoryReady?: boolean;
          locationSelectionRequired?: boolean;
          shopDomain?: string | null;
          primaryLocationId?: string | null;
        }>;
      }>("/api/shopify/connection")
        .then((res) => {
          if (cancelled) return;
          const conn =
            res.connections?.find((c) => c.status === "ACTIVE") ?? res.connections?.[0] ?? null;
          if (!conn) {
            setShopifyConn(null);
            return;
          }
          setShopifyConn({
            status: conn.status,
            inventoryReady: Boolean(conn.inventoryReady ?? conn.primaryLocationId),
            locationSelectionRequired: Boolean(
              conn.locationSelectionRequired ?? !conn.primaryLocationId
            ),
            shopDomain: conn.shopDomain ?? null,
          });
        })
        .catch(() => {
          if (!cancelled) setShopifyConn(null);
        });
      apiGet<{ connections?: Array<{ status?: string }> }>("/api/etsy/connection")
        .then((res) => {
          if (cancelled) return;
          setEtsyConnected(Boolean(res.connections?.some((c) => c.status === "ACTIVE")));
        })
        .catch(() => {
          if (!cancelled) setEtsyConnected(false);
        });
      return () => {
        cancelled = true;
      };
    }, [])
  );

  useEffect(() => {
    if (!etsyConnected) {
      setEtsyShippingReady(false);
      return;
    }
    let cancelled = false;
    apiGet<{ defaultShippingProfileId?: string | null }>("/api/etsy/shipping-profiles")
      .then((data) => {
        if (!cancelled) setEtsyShippingReady(Boolean(data?.defaultShippingProfileId?.trim()));
      })
      .catch(() => {
        if (!cancelled) setEtsyShippingReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, [etsyConnected]);

  useEffect(() => {
    if (!editId || !etsyConnected) {
      setEtsyMappedListingId(null);
      setEtsyMappedLive(false);
      return;
    }
    let cancelled = false;
    apiGet<{
      listing?: { etsyListingId?: string | null; remoteListingState?: string | null } | null;
    }>(`/api/etsy/listings/create-status?storeItemId=${encodeURIComponent(editId)}`)
      .then((data) => {
        if (cancelled) return;
        const mappedId = data.listing?.etsyListingId?.trim() || null;
        const live = String(data.listing?.remoteListingState ?? "").toLowerCase() === "active";
        setEtsyMappedListingId(mappedId);
        setEtsyMappedLive(Boolean(mappedId && live));
        if (mappedId && live) setListOnEtsy(false);
      })
      .catch(() => {
        if (!cancelled) {
          setEtsyMappedListingId(null);
          setEtsyMappedLive(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [editId, etsyConnected]);

  useEffect(() => {
    if (!shopifyConnected) return;
    void refreshShopifyReadiness(effectiveStoreItemId);
  }, [shopifyConnected, effectiveStoreItemId, refreshShopifyReadiness]);

  const handleListOnShopify = useCallback(async () => {
    if (!effectiveStoreItemId) {
      setShopifyMessage("Save the listing first");
      return;
    }
    if (shopifyConn?.locationSelectionRequired || !shopifyConn?.inventoryReady) {
      setShopifyMessage("Select a primary Shopify location in Seller Hub → Shopify");
      return;
    }
    setShopifyBusy(true);
    setShopifyMessage(null);
    try {
      const res = await apiPost<{
        status?: string;
        shopifyProductId?: string;
        jobId?: string;
        error?: string;
        code?: string;
      }>("/api/shopify/listings/create", { storeItemId: effectiveStoreItemId });
      if (res.status === "already_mapped") {
        setShopifyMappedProductId(res.shopifyProductId ?? "mapped");
        setShopifyMessage("Already on Shopify");
      } else if (res.status === "queued") {
        setShopifyMessage("Listing queued for Shopify — sync usually finishes within a minute");
        await refreshShopifyReadiness(effectiveStoreItemId);
      } else {
        setShopifyMessage("Listing queued for Shopify");
      }
    } catch (e) {
      setShopifyMessage((e as { error?: string })?.error ?? "Could not list on Shopify");
    } finally {
      setShopifyBusy(false);
    }
  }, [effectiveStoreItemId, shopifyConn, refreshShopifyReadiness]);

  const handleViewOnShopify = useCallback(async () => {
    if (!effectiveStoreItemId) return;
    setShopifyBusy(true);
    setShopifyMessage(null);
    try {
      const body = await apiGet<{
        primaryUrl?: string | null;
        adminUrl?: string | null;
      }>(`/api/shopify/listings/${effectiveStoreItemId}/view-url`);
      const url = body.primaryUrl || body.adminUrl;
      if (url) await Linking.openURL(url);
      else setShopifyMessage("Could not open Shopify product");
    } catch (e) {
      setShopifyMessage((e as { error?: string })?.error ?? "Could not open Shopify product");
    } finally {
      setShopifyBusy(false);
    }
  }, [effectiveStoreItemId]);

  const filteredStoreCategories = useMemo(() => {
    const q = categorySearch.trim().toLowerCase();
    if (!q) return storeCategories;
    return storeCategories.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.subcategories.some((s) => s.toLowerCase().includes(q))
    );
  }, [storeCategories, categorySearch]);

  const filteredSubcategoriesForCategory = useMemo(() => {
    const sel = storeCategories.find((c) => c.label === category);
    if (!sel?.subcategories?.length) return [];
    const q = categorySearch.trim().toLowerCase();
    if (!q) return sel.subcategories;
    return sel.subcategories.filter((s) => s.toLowerCase().includes(q));
  }, [storeCategories, category, categorySearch]);

  const filteredSecondaryStoreCategories = useMemo(
    () => filteredStoreCategories.filter((c) => c.label !== category),
    [filteredStoreCategories, category]
  );

  const hasVariantsWithOptions =
    inventoryMode === "options" &&
    variantAxes.some((a) => a.name.trim() && a.values.length > 0) &&
    variantSkus.some((s) => s.enabled);

  const hasContent =
    !!title.trim() ||
    !!description.trim() ||
    photos.length > 0 ||
    !!category.trim() ||
    !!priceCents;

  const finishLeave = useCallback((go: () => void) => {
    pendingLeaveRef.current = go;
    setAllowLeave(true);
  }, []);

  useEffect(() => {
    if (!allowLeave || !pendingLeaveRef.current) return;
    const go = pendingLeaveRef.current;
    pendingLeaveRef.current = null;
    go();
  }, [allowLeave]);

  const saveDraftAndExit = useCallback(async (exitAction?: Parameters<typeof navigation.dispatch>[0]) => {
    await saveDraft({
      title,
      sku,
      description,
      photos,
      category,
      secondaryCategory,
      subcategory,
      priceCents,
      quantity,
      condition,
      shippingDisabled,
      shippingCostDollars,
      shippingFree,
      shippingOptionId,
      shippingPolicy,
      useSellerProfileShipping,
      localDeliveryAvailable,
      localDeliveryFeeDollars,
      localDeliveryTerms,
      useSellerProfileLocalDelivery,
      inStorePickupAvailable,
      pickupTerms,
      useSellerProfilePickup,
      businessId,
      variants:
        buildVariantsPayload(inventoryMode, variantAxes, variantSkus, {
          quantitiesVary,
          pricesVary,
          poolQuantity: parseInt(quantity, 10),
        }) ?? [],
      inventoryTracking,
    });
    if (draftId) await deleteDraft(draftId);
    finishLeave(() => {
      if (exitAction) navigation.dispatch(exitAction);
      else router.back();
    });
  }, [
    title, sku, description, photos, category, secondaryCategory, subcategory,
    priceCents, quantity, condition, shippingDisabled, shippingCostDollars,
    shippingFree, shippingOptionId, shippingPolicy, useSellerProfileShipping,
    localDeliveryAvailable, localDeliveryFeeDollars, localDeliveryTerms,
    useSellerProfileLocalDelivery, inStorePickupAvailable, pickupTerms,
    useSellerProfilePickup, businessId, inventoryMode, variantAxes, variantSkus,
    inventoryTracking, quantitiesVary, pricesVary, draftId, router, navigation, finishLeave,
  ]);

  useEffect(() => {
    if (editId) {
      setEditLoading(true);
      setError(null);
      apiGet<{
        title: string;
        description: string | null;
        photos: string[];
        category: string | null;
        secondaryCategory?: string | null;
        subcategory: string | null;
        priceCents: number;
        quantity: number;
        shippingDisabled: boolean;
        shippingCostCents: number | null;
        shippingOptionId?: string | null;
        shippingPolicy: string | null;
        localDeliveryAvailable: boolean;
        localDeliveryFeeCents: number | null;
        localDeliveryTerms: string | null;
        inStorePickupAvailable: boolean;
        pickupTerms: string | null;
        businessId: string | null;
        variants: unknown;
        storeVariants?: Array<{
          id?: string;
          options?: unknown;
          quantity?: number;
          priceCents?: number;
          sku?: string | null;
        }>;
        inventoryTracking?: string | null;
        condition?: "new" | "used";
        acceptOffers?: boolean;
        useSellerProfileShipping?: boolean;
        useSellerProfileLocalDelivery?: boolean;
        useSellerProfilePickup?: boolean;
        sku?: string | null;
        buyerFields?: Parameters<typeof buyerFieldsFromExisting>[0];
      }>(`/api/store-items/${editId}`)
        .then((item) => {
          setBuyerFields(buyerFieldsFromExisting(item.buyerFields));
          setTitle(item.title ?? "");
          setSku(item.sku ?? "");
          setDescription(item.description ?? "");
          setPhotos(item.photos ?? []);
          setCategory(item.category ?? "");
          setSecondaryCategory(item.secondaryCategory ?? "");
          setSubcategory(item.subcategory ?? "");
          setPriceCents(item.priceCents != null ? (item.priceCents / 100).toFixed(2) : "");
          setQuantity(String(item.quantity ?? 1));
          setShippingDisabled(item.shippingDisabled ?? false);
          setShippingCostDollars(
            item.shippingCostCents != null && item.shippingCostCents > 0
              ? (item.shippingCostCents / 100).toFixed(2)
              : ""
          );
          setShippingFree(item.shippingCostCents === 0);
          setShippingOptionId(item.shippingOptionId ?? "");
          setShippingPolicy(item.shippingPolicy ?? "");
          setLocalDeliveryAvailable(item.localDeliveryAvailable ?? false);
          setLocalDeliveryFeeDollars(
            item.localDeliveryFeeCents != null && item.localDeliveryFeeCents > 0
              ? (item.localDeliveryFeeCents / 100).toFixed(2)
              : ""
          );
          setLocalDeliveryTerms(item.localDeliveryTerms ?? "");
          setInStorePickupAvailable(item.inStorePickupAvailable ?? false);
          setPickupTerms(item.pickupTerms ?? "");
          setBusinessId(item.businessId ?? null);
          const parsed = parseVariantsToEditor(item.variants, item.storeVariants);
          setInventoryMode(parsed.mode);
          setVariantAxes(parsed.axes);
          setVariantSkus(parsed.skus);
          setPricesVary(parsed.pricesVary);
          setQuantitiesVary(parsed.quantitiesVary);
          setInventoryTracking(parseInventoryTracking(item.inventoryTracking));
          if (item.condition === "used" || item.condition === "new") setCondition(item.condition);
          if (typeof item.acceptOffers === "boolean") setAcceptOffers(item.acceptOffers);
          if (item.useSellerProfileShipping !== undefined) setUseSellerProfileShipping(item.useSellerProfileShipping);
          if (item.useSellerProfileLocalDelivery !== undefined) setUseSellerProfileLocalDelivery(item.useSellerProfileLocalDelivery);
          if (item.useSellerProfilePickup !== undefined) setUseSellerProfilePickup(item.useSellerProfilePickup);
        })
        .catch(() => setError("Failed to load item"))
        .finally(() => {
          setEditLoading(false);
          setLoadedDraft(true);
        });
    } else if (similarId && !loadedDraft) {
      setEditLoading(true);
      apiGet<{
        title: string;
        description: string | null;
        photos: string[];
        category: string | null;
        secondaryCategory?: string | null;
        subcategory: string | null;
        priceCents: number;
        quantity: number;
        shippingDisabled: boolean;
        shippingCostCents: number | null;
        shippingOptionId: string | null;
        shippingPolicy: string | null;
        localDeliveryAvailable: boolean;
        localDeliveryFeeCents: number | null;
        localDeliveryTerms: string | null;
        inStorePickupAvailable: boolean;
        pickupTerms: string | null;
        businessId: string | null;
        variants: unknown;
        storeVariants?: Array<{
          id?: string;
          options?: unknown;
          quantity?: number;
          priceCents?: number;
          sku?: string | null;
        }>;
        inventoryTracking?: string | null;
        condition?: "new" | "used";
        acceptOffers?: boolean;
        useSellerProfileShipping?: boolean;
        useSellerProfileLocalDelivery?: boolean;
        useSellerProfilePickup?: boolean;
      }>(`/api/store-items/${similarId}`)
        .then((item) => {
          setTitle(item.title ?? "");
          setSku("");
          setDescription(item.description ?? "");
          setPhotos(item.photos ?? []);
          setCategory(item.category ?? "");
          setSecondaryCategory(item.secondaryCategory ?? "");
          setSubcategory(item.subcategory ?? "");
          setPriceCents(item.priceCents != null ? (item.priceCents / 100).toFixed(2) : "");
          setQuantity(String(Math.max(1, item.quantity ?? 1)));
          setShippingDisabled(item.shippingDisabled ?? false);
          setShippingCostDollars(
            item.shippingCostCents != null && item.shippingCostCents > 0
              ? (item.shippingCostCents / 100).toFixed(2)
              : ""
          );
          setShippingFree(item.shippingCostCents === 0);
          setShippingOptionId(item.shippingOptionId ?? "");
          setShippingPolicy(item.shippingPolicy ?? "");
          setLocalDeliveryAvailable(item.localDeliveryAvailable ?? false);
          setLocalDeliveryFeeDollars(
            item.localDeliveryFeeCents != null && item.localDeliveryFeeCents > 0
              ? (item.localDeliveryFeeCents / 100).toFixed(2)
              : ""
          );
          setLocalDeliveryTerms(item.localDeliveryTerms ?? "");
          setInStorePickupAvailable(item.inStorePickupAvailable ?? false);
          setPickupTerms(item.pickupTerms ?? "");
          setBusinessId(item.businessId ?? null);
          const parsed = parseVariantsToEditor(item.variants, item.storeVariants);
          setInventoryMode(parsed.mode);
          setVariantAxes(parsed.axes);
          setVariantSkus(parsed.skus);
          setPricesVary(parsed.pricesVary);
          setQuantitiesVary(parsed.quantitiesVary);
          setInventoryTracking(parseInventoryTracking(item.inventoryTracking));
          if (item.condition === "used" || item.condition === "new") setCondition(item.condition);
          if (typeof item.acceptOffers === "boolean") setAcceptOffers(item.acceptOffers);
          if (item.useSellerProfileShipping !== undefined) setUseSellerProfileShipping(item.useSellerProfileShipping);
          if (item.useSellerProfileLocalDelivery !== undefined) {
            setUseSellerProfileLocalDelivery(item.useSellerProfileLocalDelivery);
          }
          if (item.useSellerProfilePickup !== undefined) setUseSellerProfilePickup(item.useSellerProfilePickup);
        })
        .catch(() => setError("Failed to load item to copy"))
        .finally(() => {
          setEditLoading(false);
          setLoadedDraft(true);
        });
    } else if (draftId && !loadedDraft) {
      getDraft(draftId).then((draft) => {
        if (draft) {
          setTitle(draft.title);
          setSku(draft.sku ?? "");
          setDescription(draft.description);
          setPhotos(draft.photos);
          setCategory(draft.category);
          setSecondaryCategory(draft.secondaryCategory ?? "");
          setSubcategory(draft.subcategory ?? "");
          setPriceCents(draft.priceCents);
          setQuantity(draft.quantity);
          setCondition(draft.condition ?? "new");
          setShippingDisabled(draft.shippingDisabled);
          setShippingCostDollars(draft.shippingCostDollars);
          setShippingFree(draft.shippingFree);
          setShippingOptionId(draft.shippingOptionId ?? "");
          setShippingPolicy(draft.shippingPolicy);
          setUseSellerProfileShipping(draft.useSellerProfileShipping);
          setLocalDeliveryAvailable(draft.localDeliveryAvailable);
          setLocalDeliveryFeeDollars(draft.localDeliveryFeeDollars);
          setLocalDeliveryTerms(draft.localDeliveryTerms);
          setUseSellerProfileLocalDelivery(draft.useSellerProfileLocalDelivery ?? true);
          setInStorePickupAvailable(draft.inStorePickupAvailable);
          setPickupTerms(draft.pickupTerms ?? "");
          setUseSellerProfilePickup(draft.useSellerProfilePickup ?? true);
          setBusinessId(draft.businessId);
          const parsed = parseVariantsToEditor(draft.variants);
          setInventoryMode(parsed.mode);
          setVariantAxes(parsed.axes);
          setVariantSkus(parsed.skus);
          setPricesVary(parsed.pricesVary);
          setQuantitiesVary(parsed.quantitiesVary);
          setInventoryTracking(parseInventoryTracking(draft.inventoryTracking));
        }
        setLoadedDraft(true);
      });
    } else if (!draftId && !editId && !similarId) {
      setLoadedDraft(true);
    }
  }, [draftId, editId, similarId, loadedDraft]);

  useEffect(() => {
    if (editId) return;
    apiGet<{ member?: { acceptOffersOnResale?: boolean } } | { error?: string }>("/api/seller-profile")
      .then((data) => {
        if (data && "member" in data && data.member && typeof data.member.acceptOffersOnResale === "boolean") {
          setAcceptOffers(data.member.acceptOffersOnResale);
        }
      })
      .catch(() => {});
  }, [editId]);

  const shouldPreventRemove = hasContent && !submitting && !allowLeave;
  usePreventRemove(shouldPreventRemove, ({ data }) => {
    Alert.alert(
      "Are you sure you want to exit item listing?",
      "Your changes may be lost.",
      [
        { text: "No", style: "cancel", onPress: () => {} },
        {
          text: "Yes",
          style: "destructive",
          onPress: () => finishLeave(() => navigation.dispatch(data.action)),
        },
        { text: "Save Draft", onPress: () => void saveDraftAndExit(data.action) },
      ]
    );
  });

  useEffect(() => {
    apiGet<Business[]>("/api/businesses?mine=1")
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        setBusinesses(list);
        if (list.length === 1) {
          setBusinessId(list[0].id);
        }
      })
      .catch(() => setBusinesses([]));
    apiGet<{ categories: StoreCategoryOption[] }>("/api/store-categories")
      .then((data) => setStoreCategories(data.categories ?? []))
      .catch(() => setStoreCategories([]));
    apiGet<PoliciesResponse>("/api/me/policies")
      .then((data) => {
        const pol = data as PoliciesResponse;
        setSellerProfileShippingPolicy(pol.sellerShippingPolicy ?? "");
        setSellerProfileLocalDeliveryPolicy(pol.sellerLocalDeliveryPolicy ?? "");
        setSellerProfilePickupPolicy(pol.sellerPickupPolicy ?? "");
        if (pol.sellerShippingPolicy && useSellerProfileShipping) setShippingPolicy(pol.sellerShippingPolicy);
        if (pol.sellerLocalDeliveryPolicy && useSellerProfileLocalDelivery) {
          setLocalDeliveryTerms(pol.sellerLocalDeliveryPolicy);
        }
        if (pol.sellerPickupPolicy) setPickupTerms((prev) => prev || (pol.sellerPickupPolicy ?? ""));
        if (pol.offerShipping !== undefined) setOfferShipping(pol.offerShipping);
        if (pol.offerLocalDelivery !== undefined) setOfferLocalDelivery(pol.offerLocalDelivery);
        if (pol.offerLocalPickup !== undefined) setOfferLocalPickup(pol.offerLocalPickup);
        if (pol.offerShipping === false) setShippingDisabled(false);
        if (pol.offerLocalDelivery === false) setLocalDeliveryAvailable(false);
        if (pol.offerLocalPickup === false) setInStorePickupAvailable(false);
      })
      .catch(() => {})
      .finally(() => setPoliciesLoaded(true));
    apiGet<{ options?: ShippingOptionChoice[]; offerFreeShippingOnInw?: boolean }>("/api/shipping-options")
      .then((data) => {
        const options = Array.isArray(data.options) ? data.options : [];
        setShippingOptions(options);
        const offerFree = Boolean(data.offerFreeShippingOnInw);
        setOfferFreeShippingOnInw(offerFree);
        if (!editId && !draftId) {
          if (offerFree) {
            setShippingFree(true);
            setShippingCostDollars("0.00");
          } else if (options.length === 1 && options[0]) {
            setShippingOptionId(options[0].id);
            if (options[0].shippingCostCents != null) {
              setShippingCostDollars((options[0].shippingCostCents / 100).toFixed(2));
              setShippingFree(options[0].shippingCostCents === 0);
            }
          }
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const subShow = Keyboard.addListener(showEvt, (e) => setKeyboardHeight(e.endCoordinates?.height ?? 0));
    const subHide = Keyboard.addListener(hideEvt, () => setKeyboardHeight(0));
    return () => { subShow.remove(); subHide.remove(); };
  }, []);

  const pickPhotos = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow access to photos.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      quality: 1,
    });
    if (result.canceled) return;
    setUploading(true);
    setPhotoError(null);
    const urls: string[] = [];
    try {
      const token = await getToken();
      if (!token) {
        setPhotoError("Sign in to upload photos.");
        return;
      }
      for (let i = 0; i < result.assets.length; i++) {
        const asset = result.assets[i];
        if (typeof asset.fileSize === "number" && asset.fileSize > MAX_LISTING_PHOTO_BYTES) {
          setPhotoError(`Each photo must be under ${formatListingPhotoSizeLabel()}.`);
          continue;
        }
        const { url } = await uploadListingPhotoFile({
          localUri: asset.uri,
          mimeType: asset.mimeType ?? "image/jpeg",
          fileSize: asset.fileSize,
        });
        urls.push(toFullUrl(url));
      }
      setPhotos((p) => {
        const next = [...p];
        for (const u of urls) {
          if (!next.includes(u)) next.push(u);
        }
        return next;
      });
      if (urls.length > 0) setPhotoError(null);
    } catch (e) {
      setPhotoError((e as { error?: string })?.error ?? "Photo upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = (url: string) => {
    setPhotos((p) => p.filter((u) => u !== url));
  };

  const effectiveShippingPolicy = useSellerProfileShipping ? sellerProfileShippingPolicy : shippingPolicy;

  const handleSubmit = async (asDraft = false) => {
    const enabledSkus = variantSkus.filter((s) => s.enabled);
    const sharedPool =
      hasVariantsWithOptions && !quantitiesVary && enabledSkus.length > 1;
    const variantPrices =
      pricesVary && hasVariantsWithOptions
        ? enabledSkus
            .map((s) => s.priceCents)
            .filter((cents): cents is number => typeof cents === "number" && cents > 0)
        : [];
    const parsedPrice =
      pricesVary && hasVariantsWithOptions
        ? variantPrices.length
          ? Math.min(...variantPrices)
          : 0
        : Math.round(parseFloat(priceCents) * 100);
    const price = asDraft && (!parsedPrice || parsedPrice < 1) ? 0 : parsedPrice;
    const qty = parseInt(quantity, 10);
    const shipCost = shippingFree || !shippingCostDollars.trim() ? 0 : Math.round(parseFloat(shippingCostDollars) * 100);
    const localFee = localDeliveryFeeDollars.trim() ? Math.round(parseFloat(localDeliveryFeeDollars) * 100) : null;

    if (!title.trim()) {
      setError(asDraft ? "Add a title to save this draft." : "Title is required");
      return;
    }
    if (!asDraft && pricesVary && hasVariantsWithOptions && variantPrices.length < 1) {
      setError("Set a price on at least one enabled combination (Prices vary is on).");
      return;
    }
    if (!asDraft && (!price || price < 1)) { setError("Price must be at least $0.01"); return; }
    if (!asDraft && !hasVariantsWithOptions && inventoryTracking !== "made_to_order" && (!qty || qty < 1)) {
      setError("Quantity must be at least 1"); return;
    }
    if (!asDraft && hasVariantsWithOptions) {
      if (variantAxes.some((a) => !a.name.trim() || a.values.length === 0)) {
        setError("Each option type needs a name and at least one value."); return;
      }
      if (inventoryTracking !== "made_to_order") {
        if (sharedPool) {
          if (!qty || qty < 1) {
            setError("Quantity must be at least 1");
            return;
          }
        } else if (sumEnabledSkus(variantSkus) < 1) {
          setError("Add at least one combination with quantity 1 or more.");
          return;
        }
      }
    }
    if (!asDraft && !shippingFree && !shippingOptionId) {
      setError("Choose a shipping option, or turn on Offer free shipping.");
      return;
    }
    if (!asDraft && listOnEtsy && !etsyMappedLive) {
      if (!etsyShippingReady) {
        setError("Etsy: set a default shipping profile in Connection Settings before listing.");
        return;
      }
      if (photos.length < 1) {
        setError("Etsy: add at least one photo before listing on Etsy.");
        return;
      }
      if (!etsyWhoMade) {
        setError("Etsy: choose who made it.");
        return;
      }
      if (etsyIsSupply !== true && etsyIsSupply !== false) {
        setError("Etsy: choose whether this is a finished product or a supply.");
        return;
      }
      if (inventoryTracking !== "made_to_order" && !etsyWhenMade) {
        setError("Etsy: choose when it was made.");
        return;
      }
    }
    if (!asDraft && listOnShopifyAfterSave && sharedPool) {
      setListOnShopifyAfterSave(false);
      setError("Shared quantity pools are not compatible with Shopify.");
      return;
    }

    const variantPayload = buildVariantsPayload(inventoryMode, variantAxes, variantSkus, {
      quantitiesVary,
      pricesVary,
      poolQuantity: qty,
    });
    const payloadQuantity = inventoryTracking === "made_to_order"
      ? qty || 1
      : sharedPool
        ? Math.max(0, qty || 0)
        : variantPayload != null
          ? sumEnabledSkus(variantSkus)
          : qty;

    setError(null);
    setPhotoError(null);
    const catTrim = category.trim();
    const secTrim = secondaryCategory.trim();
    const secondaryPayload = secTrim && secTrim !== catTrim ? secTrim : null;

    const basePayload: Record<string, unknown> = {
      title: title.trim().slice(0, TITLE_MAX),
      sku: sku.trim() || null,
      description: description.trim() || null,
      photos,
      category: catTrim || null,
      secondaryCategory: secondaryPayload,
      subcategory: subcategory.trim() || null,
      priceCents: price,
      quantity: payloadQuantity,
      inventoryTracking,
      variants: variantPayload,
      condition,
      status: asDraft ? "draft" : "active",
      shippingDisabled: false,
      localDeliveryAvailable,
      inStorePickupAvailable,
      businessId: businessId || null,
      shippingCostCents: shippingFree ? 0 : shipCost > 0 ? shipCost : null,
      shippingOptionId: shippingFree ? null : shippingOptionId || null,
      shippingPolicy: useSellerProfileShipping ? null : shippingPolicy.trim() || null,
      localDeliveryTerms: localDeliveryAvailable && !useSellerProfileLocalDelivery ? localDeliveryTerms.trim() || null : null,
      pickupTerms: inStorePickupAvailable && !useSellerProfilePickup ? pickupTerms.trim() || null : null,
      localDeliveryFeeCents: localFee,
      ...(condition === "used" ? { acceptOffers } : { acceptOffers: false }),
      buyerFields: buyerFieldsToPayload(buyerFields),
    };

    if (asDraft) setSavingDraft(true);
    else setSubmitting(true);
    submittedRef.current = true;
    try {
      let savedId = editId ?? null;
      if (editId) {
        await apiPatch(`/api/store-items/${editId}`, basePayload);
      } else {
        const res = await apiPost<{ id?: string }>("/api/store-items", basePayload);
        savedId = res.id ?? null;
        setCreatedItemId(savedId);
        setFeedShareDone(false);
      }
      if (asDraft) {
        finishLeave(() => router.replace("/seller-hub/store/items" as never));
        return;
      }
      if (savedId && listOnEtsy && !etsyMappedLive) {
        await apiPatch(`/api/store-items/${savedId}/etsy-attributes`, {
          etsyWhoMade: etsyWhoMade || null,
          etsyWhenMade: inventoryTracking === "made_to_order" ? "made_to_order" : etsyWhenMade || null,
          etsyIsSupply,
        });
        await apiPost("/api/etsy/listings/create", { storeItemId: savedId });
      }
      if (savedId && listOnShopifyAfterSave && !shopifyMappedProductId) {
        await apiPost("/api/shopify/listings/create", { storeItemId: savedId });
      }
      setEditSuccess(Boolean(editId));
      setAllowLeave(true);
      setShowListingSuccessModal(true);
    } catch (e) {
      setError((e as { error?: string })?.error ?? (asDraft ? "Failed to save draft" : editId ? "Failed to update listing" : "Failed to create listing"));
      submittedRef.current = false;
      setAllowLeave(false);
    } finally {
      setSubmitting(false);
      setSavingDraft(false);
    }
  };

  const handleSelectTemplate = useCallback((template: ListingTemplate) => {
    if (template.category) setCategory(template.category);
    if (template.subcategory) setSubcategory(template.subcategory);
    if (template.condition === "new" || template.condition === "used") setCondition(template.condition);
    if (template.shippingDisabled !== undefined) setShippingDisabled(template.shippingDisabled);
    if (template.localDeliveryAvailable !== undefined) setLocalDeliveryAvailable(template.localDeliveryAvailable);
    if (template.inStorePickupAvailable !== undefined) setInStorePickupAvailable(template.inStorePickupAvailable);
    if (template.shippingCostCents != null) {
      setShippingCostDollars((template.shippingCostCents / 100).toFixed(2));
      setShippingFree(template.shippingCostCents === 0);
    }
    if (template.shippingOptionId) setShippingOptionId(template.shippingOptionId);
    if (template.localDeliveryFeeCents != null) {
      setLocalDeliveryFeeDollars((template.localDeliveryFeeCents / 100).toFixed(2));
    }
    if (template.shippingPolicy) {
      setShippingPolicy(template.shippingPolicy);
      setUseSellerProfileShipping(false);
    }
    if (template.localDeliveryTerms) {
      setLocalDeliveryTerms(template.localDeliveryTerms);
      setUseSellerProfileLocalDelivery(false);
    }
    if (template.pickupTerms) {
      setPickupTerms(template.pickupTerms);
      setUseSellerProfilePickup(false);
    }
    if (template.variantsTemplate?.axes?.length) {
      setInventoryMode("options");
      const axes = template.variantsTemplate.axes
        .map((axis: { name?: string; values?: string[]; options?: string[] }) => ({
          name: axis.name || "Option",
          values: axis.values ?? axis.options ?? [],
        }))
        .filter((a: { name: string; values: string[] }) => a.name && a.values.length > 0);
      const rebuilt = rebuildMatrixFromAxes(axes, []);
      setVariantAxes(rebuilt.axes);
      setVariantSkus(rebuilt.skus.map((s) => ({ ...s, enabled: true })));
      setPricesVary(false);
      setQuantitiesVary(true);
    }
    Alert.alert("Template Applied", `Settings from "${template.name}" have been applied.`);
  }, [shippingOptions]);

  return (
    <View style={styles.screenWrapper}>
      <Modal visible={showListingSuccessModal} transparent animationType="fade">
        <View style={styles.successModalOverlay}>
          <View style={styles.successModalCard}>
            <Text style={styles.successModalTitle}>
              {editSuccess ? "Item updated" : "Item listed successfully"}
            </Text>
            <Text style={styles.successModalSubtitle}>
              {editSuccess ? "Your changes have been saved." : "Your listing is now live."}
            </Text>
            {!editSuccess && createdItemId && !feedShareDone ? (
              <Pressable
                style={({ pressed }) => [styles.successModalBtn, pressed && { opacity: 0.8 }]}
                disabled={feedShareBusy}
                onPress={async () => {
                  setFeedShareBusy(true);
                  try {
                    await apiPost("/api/store-items/share-to-feed", { storeItemIds: [createdItemId] });
                    setFeedShareDone(true);
                  } catch {
                    Alert.alert("Could not share", "Your listing is live. You can share it later.");
                  } finally {
                    setFeedShareBusy(false);
                  }
                }}
              >
                <Text style={styles.successModalBtnText}>
                  {feedShareBusy ? "Sharing…" : "Share on Community Feed"}
                </Text>
              </Pressable>
            ) : null}
            {!editSuccess && feedShareDone ? (
              <Text style={[styles.successModalSubtitle, { marginBottom: 12 }]}>Shared to the Community Feed.</Text>
            ) : null}
            <Pressable
              style={({ pressed }) => [styles.successModalBtn, pressed && { opacity: 0.8 }]}
              onPress={() => {
                setShowListingSuccessModal(false);
                setEditSuccess(false);
                (router.replace as (href: string) => void)("/seller-hub/store/items");
              }}
            >
              <Text style={styles.successModalBtnText}>
                {editSuccess ? "Back to My Items" : "See Listing"}
              </Text>
            </Pressable>
            {!editSuccess && (
              <Pressable
                style={({ pressed }) => [styles.successModalBtnSecondary, pressed && { opacity: 0.8 }]}
                onPress={() => {
                  setShowListingSuccessModal(false);
                  submittedRef.current = false;
                  (router.replace as (href: string) => void)("/seller-hub/store/new");
                }}
              >
                <Text style={styles.successModalBtnTextSecondary}>List Another Item</Text>
              </Pressable>
            )}
          </View>
        </View>
      </Modal>
      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? Math.max(headerHeight, 56) : 0}
      >
        <ScrollView
          style={styles.container}
          contentContainerStyle={[styles.content, { paddingBottom: 40 + insets.bottom + keyboardHeight }]}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        >
          {!editId && (
            <TemplateSelector onSelectTemplate={handleSelectTemplate} disabled={submitting || editLoading} />
          )}

          <View style={styles.formBox}>
            <Text style={styles.sectionTitle}>Listing details</Text>
          <View style={styles.typeRow}>
            <Text style={styles.label}>Condition</Text>
            <View style={styles.typeBtns}>
              <Pressable
                style={({ pressed }) => [styles.typeBtn, condition === "new" && styles.typeBtnActive, pressed && { opacity: 0.8 }]}
                onPress={() => setCondition("new")}
              >
                <Text style={condition === "new" ? styles.typeBtnTextActive : styles.typeBtnText}>New</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.typeBtn, condition === "used" && styles.typeBtnActive, pressed && { opacity: 0.8 }]}
                onPress={() => setCondition("used")}
              >
                <Text style={condition === "used" ? styles.typeBtnTextActive : styles.typeBtnText}>Used</Text>
              </Pressable>
            </View>
          </View>

          {condition === "used" && (
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Accept offers on this listing</Text>
              <Switch
                value={acceptOffers}
                onValueChange={setAcceptOffers}
                trackColor={switchTrackColor()}
                thumbColor={switchThumbColor(acceptOffers)}
                ios_backgroundColor={switchIosBackgroundColor}
              />
            </View>
          )}

          <Text style={styles.label}>Photos *</Text>
          <Text style={styles.hint}>Up to {formatListingPhotoSizeLabel()} each.</Text>
          <View style={styles.photoRow}>
            {photos.map((url) => (
              <View key={url} style={styles.photoWrap}>
                <Image source={{ uri: url }} style={styles.photo} />
                <Pressable style={styles.removePhoto} onPress={() => removePhoto(url)}>
                  <Text style={styles.removePhotoText}>×</Text>
                </Pressable>
              </View>
            ))}
            <Pressable
              style={({ pressed }) => [styles.addPhoto, pressed && { opacity: 0.8 }]}
              onPress={pickPhotos}
              disabled={uploading}
            >
              {uploading ? (
                <ActivityIndicator size="small" color={theme.colors.primary} />
              ) : (
                <Text style={styles.addPhotoText}>+ Add</Text>
              )}
            </Pressable>
          </View>
          {photoError ? <Text style={styles.photoErr}>{photoError}</Text> : null}

          <Text style={styles.label}>Title *</Text>
          <TextInput
            style={styles.input}
            placeholder="Item title"
            placeholderTextColor={placeholderColor}
            value={title}
            onChangeText={(t) => setTitle(t.slice(0, TITLE_MAX))}
            maxLength={TITLE_MAX}
            autoCorrect={true}
          />

          <Text style={styles.label}>SKU</Text>
          <TextInput
            style={styles.input}
            placeholder="Stock Keeping Unit (optional)"
            placeholderTextColor={placeholderColor}
            value={sku}
            onChangeText={(s) => setSku(s.slice(0, 50))}
            maxLength={50}
            autoCapitalize="characters"
            autoCorrect={false}
          />

          <Text style={styles.label}>Description</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Describe your item"
            placeholderTextColor={placeholderColor}
            value={description}
            onChangeText={setDescription}
            multiline
            scrollEnabled={false}
            numberOfLines={4}
            textAlignVertical="top"
            autoCorrect={true}
          />

          {pricesVary && inventoryMode === "options" ? (
            <Text style={styles.hint}>
              Prices vary by combination. Set each price in the table below, or use Apply to all enabled.
            </Text>
          ) : (
            <>
              <Text style={styles.label}>Price ($) *</Text>
              <TextInput
                style={styles.input}
                placeholder="0.00"
                placeholderTextColor={placeholderColor}
                value={priceCents}
                onFocus={() => setPriceCents((prev) => moneyInputToEditable(prev))}
                onChangeText={(t) => {
                  const next = sanitizePriceDraftInput(t);
                  if (next != null) setPriceCents(next);
                }}
                onBlur={() => setPriceCents((prev) => moneyInputToIdle(prev))}
                keyboardType="decimal-pad"
                autoCorrect={false}
              />
            </>
          )}
          </View>

          <View style={styles.formBox}>
            <Text style={styles.sectionTitle}>Pricing and inventory</Text>
            <ListingOptionsEditor
              mode={inventoryMode}
              onModeChange={setInventoryMode}
              axes={variantAxes}
              skus={variantSkus}
              onMatrixChange={(nextAxes, nextSkus) => {
                setVariantAxes(nextAxes);
                setVariantSkus(nextSkus);
              }}
              simpleQuantity={quantity}
              onSimpleQuantityChange={setQuantity}
              inventoryTracking={inventoryTracking}
              onInventoryTrackingChange={setInventoryTracking}
              galleryPhotos={photos}
              placeholderColor={placeholderColor}
              initialPricesVary={pricesVary}
              initialQuantitiesVary={quantitiesVary}
              onPricesVaryChange={setPricesVary}
              onQuantitiesVaryChange={setQuantitiesVary}
            />
          </View>

          <View style={styles.formBox}>
            <Text style={styles.sectionTitle}>Custom Options</Text>
            <Text style={styles.hint}>
              Text, choices, or files buyers fill in. These do not change stock.
            </Text>
            <ListingBuyerFieldsEditor fields={buyerFields} onChange={setBuyerFields} />
          </View>

          {(etsyConnected || shopifyConnected) && (
            <View style={styles.formBox}>
              <Text style={styles.sectionTitle}>3rd Party Syncing</Text>
              <Text style={styles.hint}>
                Optional. Check a shop to publish this listing there when you list it on INW.
              </Text>
              {etsyConnected ? (
                <View style={styles.channelBlock}>
                  <Text style={styles.channelName}>Etsy</Text>
                  {etsyMappedLive ? (
                    <Text style={styles.hint}>
                      Linked to Etsy listing #{etsyMappedListingId}. Updates sync from this listing.
                    </Text>
                  ) : (
                    <>
                      {etsyMappedListingId ? (
                        <Text style={styles.hint}>
                          Linked to Etsy, but it is not live yet. Check List on Etsy to finish publishing.
                        </Text>
                      ) : null}
                      <Pressable style={styles.checkRow} onPress={() => setListOnEtsy((on) => !on)}>
                        <View style={[styles.checkBox, listOnEtsy && styles.checkBoxOn]}>
                          {listOnEtsy ? <Text style={styles.checkMark}>✓</Text> : null}
                        </View>
                        <Text style={styles.checkLabel}>List on Etsy</Text>
                      </Pressable>
                      {listOnEtsy ? (
                        <View style={styles.etsyFields}>
                          <Text style={styles.hint}>
                            {etsyShippingReady ? "✓" : "○"} Default Etsy shipping profile
                            {etsyShippingReady ? "" : " — set it in Etsy connection settings."}
                          </Text>
                          <Text style={styles.label}>Who made it?</Text>
                          <ScrollView
                            horizontal
                            nestedScrollEnabled
                            showsHorizontalScrollIndicator={false}
                            style={styles.choiceScroll}
                            contentContainerStyle={styles.choiceRow}
                          >
                            {ETSY_WHO.map((who) => (
                              <Pressable
                                key={who.id}
                                style={[styles.typeBtn, etsyWhoMade === who.id && styles.typeBtnActive]}
                                onPress={() => setEtsyWhoMade(who.id)}
                              >
                                <Text style={etsyWhoMade === who.id ? styles.typeBtnTextActive : styles.typeBtnText}>
                                  {who.label}
                                </Text>
                              </Pressable>
                            ))}
                          </ScrollView>
                          <Text style={styles.label}>What is it?</Text>
                          <ScrollView
                            horizontal
                            nestedScrollEnabled
                            showsHorizontalScrollIndicator={false}
                            style={styles.choiceScroll}
                            contentContainerStyle={styles.choiceRow}
                          >
                            <Pressable
                              style={[styles.typeBtn, etsyIsSupply === false && styles.typeBtnActive]}
                              onPress={() => setEtsyIsSupply(false)}
                            >
                              <Text style={etsyIsSupply === false ? styles.typeBtnTextActive : styles.typeBtnText}>
                                Finished product
                              </Text>
                            </Pressable>
                            <Pressable
                              style={[styles.typeBtn, etsyIsSupply === true && styles.typeBtnActive]}
                              onPress={() => setEtsyIsSupply(true)}
                            >
                              <Text style={etsyIsSupply === true ? styles.typeBtnTextActive : styles.typeBtnText}>
                                Supply or tool
                              </Text>
                            </Pressable>
                          </ScrollView>
                          {inventoryTracking === "made_to_order" ? (
                            <Text style={styles.hint}>When it was made: made to order.</Text>
                          ) : (
                            <SelectField
                              label="When was it made?"
                              value={etsyWhenMade}
                              placeholder="When was it made?"
                              options={ETSY_WHEN.map((when) => ({ value: when.id, label: when.label }))}
                              onChange={setEtsyWhenMade}
                            />
                          )}
                        </View>
                      ) : null}
                    </>
                  )}
                </View>
              ) : null}
              {shopifyConnected ? (
                <View style={styles.channelBlock}>
                  <Text style={styles.channelName}>Shopify</Text>
                  {shopifyConn?.locationSelectionRequired || !shopifyConn?.inventoryReady ? (
                    <>
                      <Text style={styles.hint}>Select a primary Shopify location before listing.</Text>
                      <Pressable
                        style={({ pressed }) => [styles.channelSecondaryBtn, pressed && { opacity: 0.8 }]}
                        onPress={() => router.push("/seller-hub/shopify/settings" as never)}
                      >
                        <Text style={styles.channelSecondaryBtnText}>Open Shopify settings</Text>
                      </Pressable>
                    </>
                  ) : shopifyMappedProductId ? (
                    <>
                      <Text style={styles.hint}>This listing is linked to Shopify.</Text>
                      <Pressable
                        style={({ pressed }) => [
                          styles.channelPrimaryBtn,
                          pressed && { opacity: 0.8 },
                          shopifyBusy && styles.submitDisabled,
                        ]}
                        onPress={() => void handleViewOnShopify()}
                        disabled={shopifyBusy}
                      >
                        {shopifyBusy ? (
                          <ActivityIndicator color="#fff" size="small" />
                        ) : (
                          <Text style={styles.channelPrimaryBtnText}>View on Shopify</Text>
                        )}
                      </Pressable>
                    </>
                  ) : (
                    <Pressable
                      style={styles.checkRow}
                      onPress={() => setListOnShopifyAfterSave((on) => !on)}
                    >
                      <View style={[styles.checkBox, listOnShopifyAfterSave && styles.checkBoxOn]}>
                        {listOnShopifyAfterSave ? <Text style={styles.checkMark}>✓</Text> : null}
                      </View>
                      <Text style={styles.checkLabel}>List on Shopify</Text>
                    </Pressable>
                  )}
                  {shopifyMessage ? <Text style={styles.channelMessage}>{shopifyMessage}</Text> : null}
                </View>
              ) : null}
            </View>
          )}

          <View style={styles.formBox}>
          <Text style={styles.sectionTitle}>Category</Text>
          {storeCategories.length > 0 && (
            <>
              <TextInput
                style={styles.input}
                placeholder="Filter by name…"
                placeholderTextColor={placeholderColor}
                value={categorySearch}
                onChangeText={setCategorySearch}
                autoCorrect={false}
                autoCapitalize="none"
              />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                  {filteredStoreCategories.map((c) => (
                    <Pressable
                      key={c.label}
                      style={[styles.typeBtn, category === c.label && styles.typeBtnActive]}
                      onPress={() => { setCategory(c.label); setSubcategory(""); }}
                    >
                      <Text style={category === c.label ? styles.typeBtnTextActive : styles.typeBtnText} numberOfLines={1}>
                        {c.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
              {category && filteredSubcategoriesForCategory.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    {filteredSubcategoriesForCategory.map((s) => (
                      <Pressable
                        key={s}
                        style={[styles.typeBtn, subcategory === s && styles.typeBtnActive]}
                        onPress={() => setSubcategory(subcategory === s ? "" : s)}
                      >
                        <Text style={subcategory === s ? styles.typeBtnTextActive : styles.typeBtnText}>{s}</Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
              )}
            </>
          )}
          </View>

          <View style={styles.formBox}>
            <Text style={styles.sectionTitle}>Shipping</Text>
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Offer free shipping</Text>
              <Switch
                value={shippingFree}
                onValueChange={(on) => {
                  setShippingFree(on);
                  if (on) {
                    setShippingCostDollars("0.00");
                    setShippingOptionId("");
                  }
                }}
                trackColor={switchTrackColor()}
                thumbColor={switchThumbColor(shippingFree)}
                ios_backgroundColor={switchIosBackgroundColor}
              />
            </View>
            {shippingFree ? (
              <Text style={styles.hint}>
                This listing ships free. A shipping option is not required.
              </Text>
            ) : (
              <>
                <Text style={styles.label}>Shipping price ($)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 5.99"
                  placeholderTextColor={placeholderColor}
                  value={shippingCostDollars}
                  onChangeText={(v) => setShippingCostDollars(v)}
                  keyboardType="decimal-pad"
                  autoCorrect={false}
                />
                <SelectField
                  label="Shipping option (package)"
                  value={shippingOptionId}
                  placeholder="Select a shipping option"
                  options={shippingOptions.map((opt) => ({
                    value: opt.id,
                    label: `${opt.name}${opt.shippingCostCents != null ? ` · $${(opt.shippingCostCents / 100).toFixed(2)}` : ""}`,
                  }))}
                  onChange={(id) => {
                    setShippingOptionId(id);
                    const opt = shippingOptions.find((o) => o.id === id);
                    if (opt?.shippingCostCents != null) {
                      setShippingCostDollars((opt.shippingCostCents / 100).toFixed(2));
                    }
                  }}
                />
              </>
            )}
          </View>

          {businesses.length >= 2 && (
            <View style={styles.formBox}>
              <Text style={styles.sectionTitle}>Which business is this item posted under?</Text>
              <View style={styles.bizRow}>
                <Pressable
                  style={({ pressed }) => [styles.bizBtn, !businessId && styles.bizBtnActive, pressed && { opacity: 0.8 }]}
                  onPress={() => setBusinessId(null)}
                >
                  <Text style={!businessId ? styles.bizBtnTextActive : styles.bizBtnText}>None</Text>
                </Pressable>
                {businesses.map((b) => (
                  <Pressable
                    key={b.id}
                    style={({ pressed }) => [styles.bizBtn, businessId === b.id && styles.bizBtnActive, pressed && { opacity: 0.8 }]}
                    onPress={() => setBusinessId(businessId === b.id ? null : b.id)}
                  >
                    <Text style={businessId === b.id ? styles.bizBtnTextActive : styles.bizBtnText}>{b.name}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {error && (
            <View style={styles.errorWrap}>
              <Text style={styles.err}>{error}</Text>
            </View>
          )}

          <Pressable
            style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.8 }]}
            onPress={() => router.back()}
            disabled={submitting || savingDraft}
          >
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.draftBtn, pressed && { opacity: 0.8 }, (submitting || savingDraft) && styles.submitDisabled]}
            onPress={() => void handleSubmit(true)}
            disabled={submitting || savingDraft}
          >
            {savingDraft ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.submitBtnText}>Save Draft</Text>
            )}
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.submitBtn, pressed && { opacity: 0.8 }, (submitting || savingDraft) && styles.submitDisabled]}
            onPress={() => void handleSubmit(false)}
            disabled={submitting || savingDraft}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.submitBtnText}>{editId ? "Update Item" : "List Item"}</Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screenWrapper: { flex: 1, backgroundColor: "#f7f3ee" },
  keyboardAvoid: { flex: 1, backgroundColor: "#f7f3ee" },
  container: { flex: 1, backgroundColor: "#f7f3ee" },
  content: { padding: 20, paddingBottom: 40 },
  successModalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", padding: 24 },
  successModalCard: { backgroundColor: "#fff", borderRadius: 16, padding: 24, width: "100%", maxWidth: 340, borderWidth: 2, borderColor: defaultTheme.colors.primary },
  successModalTitle: { fontSize: 20, fontWeight: "700", color: "#000", textAlign: "center", marginBottom: 8 },
  successModalSubtitle: { fontSize: 15, color: "#666", textAlign: "center", marginBottom: 24 },
  successModalBtn: { backgroundColor: defaultTheme.colors.primary, paddingVertical: 14, borderRadius: 8, alignItems: "center", marginBottom: 12 },
  successModalBtnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  successModalBtnSecondary: { paddingVertical: 14, borderRadius: 8, alignItems: "center", borderWidth: 2, borderColor: defaultTheme.colors.primary },
  successModalBtnTextSecondary: { color: defaultTheme.colors.primary, fontSize: 16, fontWeight: "600" },
  errorWrap: { marginTop: 8, marginBottom: 16 },
  err: { color: "#c62828", marginBottom: 0, fontSize: 14 },
  label: { fontSize: 14, fontWeight: "600", marginBottom: 8, color: "#000" },
  hint: { fontSize: 12, color: defaultTheme.colors.labelMuted, marginBottom: 12 },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 12, fontSize: 16, marginBottom: 16, color: defaultTheme.colors.text },
  textArea: { minHeight: 80, textAlignVertical: "top" },
  photoRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 8 },
  photoErr: { fontSize: 14, color: defaultTheme.colors.primary, marginBottom: 12, lineHeight: 20 },
  photoWrap: { position: "relative" },
  photo: { width: 80, height: 80, borderRadius: 8 },
  removePhoto: { position: "absolute", top: -8, right: -8, width: 24, height: 24, borderRadius: 12, backgroundColor: "#c62828", justifyContent: "center", alignItems: "center" },
  removePhotoText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  addPhoto: { width: 80, height: 80, borderRadius: 8, borderWidth: 2, borderColor: defaultTheme.colors.primary, borderStyle: "dashed", justifyContent: "center", alignItems: "center" },
  addPhotoText: { color: defaultTheme.colors.primary, fontWeight: "600" },
  typeRow: { marginBottom: 16 },
  typeBtns: { flexDirection: "row", gap: 8, marginTop: 8 },
  typeBtn: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8, borderWidth: 1, borderColor: "#ccc" },
  typeBtnActive: { backgroundColor: defaultTheme.colors.primary, borderColor: defaultTheme.colors.primary },
  typeBtnText: { color: "#333", fontSize: 16 },
  typeBtnTextActive: { color: "#fff", fontWeight: "600", fontSize: 16 },
  section: { borderTopWidth: 1, borderTopColor: "#eee", paddingTop: 16, marginTop: 8, marginBottom: 16 },
  formBox: {
    borderWidth: 1.5,
    borderColor: defaultTheme.colors.primary,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    backgroundColor: "#fff",
  },
  channelBlock: { marginTop: 8, gap: 8 },
  channelName: { fontSize: 14, fontWeight: "700", color: "#111" },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 },
  checkBox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: defaultTheme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  checkBoxOn: { backgroundColor: defaultTheme.colors.primary },
  checkMark: { color: "#fff", fontSize: 14, fontWeight: "700" },
  checkLabel: { fontSize: 15, fontWeight: "600", color: "#111", flex: 1 },
  etsyFields: { marginTop: 8, gap: 8, overflow: "hidden" },
  choiceScroll: { flexGrow: 0, marginHorizontal: -2 },
  choiceRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingRight: 8 },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: "#000", marginBottom: 12 },
  channelSection: {
    marginTop: 8,
    marginBottom: 20,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#e5e5e5",
  },
  channelPrimaryBtn: {
    backgroundColor: defaultTheme.colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  channelPrimaryBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  channelSecondaryBtn: {
    borderWidth: 1,
    borderColor: defaultTheme.colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 8,
  },
  channelSecondaryBtnText: { color: defaultTheme.colors.primary, fontSize: 15, fontWeight: "600" },
  channelMessage: { marginTop: 8, fontSize: 13, color: "#404040", lineHeight: 18 },
  switchRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  switchLabel: { fontSize: 14, color: "#000", flex: 1 },
  bizRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  bizBtn: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8, borderWidth: 1, borderColor: "#ccc" },
  bizBtnActive: { backgroundColor: defaultTheme.colors.creamAlt, borderColor: defaultTheme.colors.primary },
  bizBtnText: { color: defaultTheme.colors.labelMuted },
  bizBtnTextActive: { color: defaultTheme.colors.primary, fontWeight: "600" },
  cancelBtn: {
    marginTop: 8,
    backgroundColor: "#fff",
    borderWidth: 1.5,
    borderColor: defaultTheme.colors.primary,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
  },
  cancelBtnText: { color: defaultTheme.colors.primary, fontWeight: "700", fontSize: 16 },
  draftBtn: {
    marginTop: 10,
    backgroundColor: defaultTheme.colors.earth,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
  },
  submitBtn: { marginTop: 10, backgroundColor: defaultTheme.colors.primary, paddingVertical: 14, borderRadius: 8, alignItems: "center" },
  submitDisabled: { opacity: 0.7 },
  submitBtnText: { color: "#fff", fontWeight: "600", fontSize: 16 },
});
