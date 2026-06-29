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
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
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
import { apiGet, apiPost, apiPatch, apiUploadFile, getToken } from "@/lib/api";
import { alertChannelSyncFailures } from "@/lib/channel-sync-alert";
import {
  fetchChannelConnections,
  publishReadyConnections,
  type ChannelConnectionSummary,
  type ChannelProviderId,
} from "@/lib/channel-connections";
import { ChannelPublishModal } from "@/components/channels/ChannelPublishModal";
import { getDraft, saveDraft, deleteDraft, type StoreItemDraft } from "@/lib/drafts";
import { BadgeEarnedPopup } from "@/components/BadgeEarnedPopup";
import type { EarnedBadgePayload } from "@/lib/share-utils";
import {
  ListingOptionsEditor,
  buildVariantsPayload,
  parseVariantsToEditor,
  sumOptionRows,
  type InventoryMode,
  type OptionRow,
} from "@/components/listing/ListingOptionsEditor";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

// eBay listing field caps (mirror of apps/main/src/lib/listing-limits.ts).
const EBAY_TITLE_MAX = 80;
const EBAY_ASPECT_NAME_MAX = 40;
const EBAY_ASPECT_VALUE_MAX = 50;
const MAX_ASPECTS = 30;

type ListingAspect = { name: string; value: string };
type EbayCategorySuggestion = { categoryId: string; categoryName: string; categoryPath?: string };
type EbayCategoryAspect = {
  name: string;
  required: boolean;
  mode: "FREE_TEXT" | "SELECTION_ONLY";
  cardinality: "SINGLE" | "MULTI";
  suggestedValues: string[];
};

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

interface Meta {
  categories: string[];
  sizes: string[];
}

interface PoliciesResponse {
  sellerShippingPolicy?: string;
  sellerLocalDeliveryPolicy?: string;
  sellerPickupPolicy?: string;
  offerShipping?: boolean;
  offerLocalDelivery?: boolean;
  offerLocalPickup?: boolean;
  acceptCashForPickupDelivery?: boolean;
}

const PLACEHOLDER_COLOR = "#888888";
/** Must stay in sync with server [/api/upload] max size for listing photos. */
const MAX_LISTING_PHOTO_BYTES = 160 * 1024 * 1024;

export default function ListItemScreen() {
  const theme = useTheme();
  const router = useRouter();
  const navigation = useNavigation();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const params = useLocalSearchParams<{ draftId?: string; edit?: string; condition?: string; listingType?: string }>();
  const draftId = params.draftId;
  const editId = params.edit?.trim() || undefined;
  const conditionParam =
    params.condition === "used" || params.listingType === "resale" ? "used" : "new";
  const placeholderColor = PLACEHOLDER_COLOR;

  useLayoutEffect(() => {
    navigation.setOptions({
      title: editId ? "Edit Item" : "List an Item",
      contentStyle: { backgroundColor: "#fff" },
    });
  }, [navigation, editId]);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [storeCategories, setStoreCategories] = useState<StoreCategoryOption[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
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
  const [shippingPolicy, setShippingPolicy] = useState("");
  const [useSellerProfileShipping, setUseSellerProfileShipping] = useState(true);
  const [localDeliveryAvailable, setLocalDeliveryAvailable] = useState(false);
  const [localDeliveryFeeDollars, setLocalDeliveryFeeDollars] = useState("");
  const [localDeliveryTerms, setLocalDeliveryTerms] = useState("");
  const [inStorePickupAvailable, setInStorePickupAvailable] = useState(false);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [inventoryMode, setInventoryMode] = useState<InventoryMode>("simple");
  const [optionName, setOptionName] = useState("Size");
  const [optionRows, setOptionRows] = useState<OptionRow[]>([]);
  const [legacyMultiAxisNotice, setLegacyMultiAxisNotice] = useState(false);
  const [acceptOffers, setAcceptOffers] = useState(true);
  // Channel sync (Etsy). Only shown when the seller has connected an Etsy shop.
  const [etsyConnected, setEtsyConnected] = useState(false);
  const [syncToEtsy, setSyncToEtsy] = useState(true);
  const [etsyWhoMade, setEtsyWhoMade] = useState<"i_did" | "someone_else" | "collective">("i_did");
  const [etsyWhenMade, setEtsyWhenMade] = useState<"made_to_order" | "2020_2025" | "before_2006">(
    "made_to_order"
  );
  const [etsyIsSupply, setEtsyIsSupply] = useState(false);
  // Channel sync (eBay). Only shown when the seller has connected an eBay account.
  const [ebayConnected, setEbayConnected] = useState(false);
  const [ebayCategoryId, setEbayCategoryId] = useState("");
  const [ebayCategoryLabel, setEbayCategoryLabel] = useState("");
  const [ebayCategorySearch, setEbayCategorySearch] = useState("");
  const [ebayCategoryResults, setEbayCategoryResults] = useState<EbayCategorySuggestion[]>([]);
  const [ebaySearching, setEbaySearching] = useState(false);
  const [categoryAspects, setCategoryAspects] = useState<EbayCategoryAspect[]>([]);
  const [aspects, setAspects] = useState<ListingAspect[]>([]);
  const [channelConnections, setChannelConnections] = useState<ChannelConnectionSummary[]>([]);
  const [showChannelPublishModal, setShowChannelPublishModal] = useState(false);
  const pendingCreatePayloadRef = useRef<Record<string, unknown> | null>(null);

  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [loadedDraft, setLoadedDraft] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [showListingSuccessModal, setShowListingSuccessModal] = useState(false);
  const [editSuccess, setEditSuccess] = useState(false);
  const [hasEbayLink, setHasEbayLink] = useState(false);
  const [refreshingFromEbay, setRefreshingFromEbay] = useState(false);
  const [listingEarnedBadges, setListingEarnedBadges] = useState<EarnedBadgePayload[]>([]);
  const [listingBadgePopupIndex, setListingBadgePopupIndex] = useState(-1);
  const isExitingRef = useRef(false);
  const submittedRef = useRef(false);

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
    optionName.trim().length > 0 &&
    optionRows.some((o) => o.value.trim());
  const hasContent =
    !!title.trim() ||
    !!description.trim() ||
    photos.length > 0 ||
    !!category.trim() ||
    !!secondaryCategory.trim() ||
    !!priceCents ||
    (inventoryMode === "simple" && quantity !== "1" && !!quantity) ||
    (hasVariantsWithOptions && sumOptionRows(optionRows) > 0) ||
    optionRows.length > 0 ||
    !!shippingCostDollars ||
    !!shippingPolicy.trim() ||
    !!localDeliveryTerms.trim() ||
    !!localDeliveryFeeDollars ||
    !!pickupTerms.trim();

  const saveDraftAndExit = useCallback(async () => {
    isExitingRef.current = true;
    await saveDraft({
      title,
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
      variants: buildVariantsPayload(inventoryMode, optionName, optionRows) ?? [],
    });
    if (draftId) await deleteDraft(draftId);
    router.back();
  }, [
    title,
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
    inventoryMode,
    optionName,
    optionRows,
    draftId,
    router,
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
        shippingPolicy: string | null;
        localDeliveryAvailable: boolean;
        localDeliveryFeeCents: number | null;
        localDeliveryTerms: string | null;
        inStorePickupAvailable: boolean;
        pickupTerms: string | null;
        businessId: string | null;
        variants: unknown;
        condition?: "new" | "used";
        acceptOffers?: boolean;
        useSellerProfileShipping?: boolean;
        useSellerProfileLocalDelivery?: boolean;
        useSellerProfilePickup?: boolean;
        etsyWhoMade?: string | null;
        etsyWhenMade?: string | null;
        etsyIsSupply?: boolean | null;
        ebayCategoryId?: number | null;
        aspects?: { name?: unknown; value?: unknown }[] | null;
        hasEbayLink?: boolean;
      }>(`/api/store-items/${editId}`)
        .then((item) => {
          setTitle(item.title ?? "");
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
          const parsed = parseVariantsToEditor(item.variants);
          setInventoryMode(parsed.mode);
          setOptionName(parsed.optionName);
          setOptionRows(parsed.optionRows);
          setLegacyMultiAxisNotice(parsed.hadMultipleAxes);
          if (item.condition === "used" || item.condition === "new") setCondition(item.condition);
          if (typeof item.acceptOffers === "boolean") setAcceptOffers(item.acceptOffers);
          if (item.etsyWhoMade === "i_did" || item.etsyWhoMade === "someone_else" || item.etsyWhoMade === "collective") {
            setEtsyWhoMade(item.etsyWhoMade);
          }
          if (item.etsyWhenMade === "made_to_order" || item.etsyWhenMade === "2020_2025" || item.etsyWhenMade === "before_2006") {
            setEtsyWhenMade(item.etsyWhenMade);
          }
          if (typeof item.etsyIsSupply === "boolean") setEtsyIsSupply(item.etsyIsSupply);
          if (item.ebayCategoryId != null) setEbayCategoryId(String(item.ebayCategoryId));
          if (Array.isArray(item.aspects)) {
            setAspects(
              item.aspects.map((a) => ({ name: String(a?.name ?? ""), value: String(a?.value ?? "") }))
            );
          }
          if (item.useSellerProfileShipping !== undefined) setUseSellerProfileShipping(item.useSellerProfileShipping);
          if (item.useSellerProfileLocalDelivery !== undefined) setUseSellerProfileLocalDelivery(item.useSellerProfileLocalDelivery);
          if (item.useSellerProfilePickup !== undefined) setUseSellerProfilePickup(item.useSellerProfilePickup);
          if (item.hasEbayLink) setHasEbayLink(true);
        })
        .catch(() => setError("Failed to load item"))
        .finally(() => {
          setEditLoading(false);
          setLoadedDraft(true);
        });
    } else if (draftId && !loadedDraft) {
      getDraft(draftId).then((draft) => {
        if (draft) {
          setTitle(draft.title);
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
          setOptionName(parsed.optionName);
          setOptionRows(parsed.optionRows);
          setLegacyMultiAxisNotice(parsed.hadMultipleAxes);
        }
        setLoadedDraft(true);
      });
    } else if (!draftId && !editId) {
      setLoadedDraft(true);
    }
  }, [draftId, editId, loadedDraft]);

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

  useEffect(() => {
    if (editId && category && storeCategories.length > 0 && !storeCategories.some((c) => c.label === category)) {
      setUseCustomCategory(true);
    }
  }, [editId, category, storeCategories]);

  const shouldPreventRemove = hasContent && !submitting && !isExitingRef.current;
  usePreventRemove(shouldPreventRemove, ({ data }) => {
    Alert.alert(
      "Are you sure you want to exit item listing?",
      "Your changes may be lost.",
      [
        { text: "No", style: "cancel", onPress: () => {} },
        {
          text: "Yes",
          style: "destructive",
          onPress: () => {
            isExitingRef.current = true;
            navigation.dispatch(data.action);
          },
        },
        { text: "Save draft", onPress: () => saveDraftAndExit() },
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
    apiGet<Meta>("/api/store-items?list=meta")
      .then((data) => setCategories((data as Meta).categories ?? []))
      .catch(() => setCategories([]));
    fetchChannelConnections()
      .then((list) => {
        setChannelConnections(list);
        setEtsyConnected(list.some((c) => c.provider === "etsy" && c.status === "active"));
        setEbayConnected(list.some((c) => c.provider === "ebay" && c.status === "active"));
      })
      .catch(() => {
        setChannelConnections([]);
        setEtsyConnected(false);
        setEbayConnected(false);
      });
    apiGet<PoliciesResponse>("/api/me/policies")
      .then((data) => {
        const pol = data as PoliciesResponse;
        setSellerProfileShippingPolicy(pol.sellerShippingPolicy ?? "");
        setSellerProfileLocalDeliveryPolicy(pol.sellerLocalDeliveryPolicy ?? "");
        setSellerProfilePickupPolicy(pol.sellerPickupPolicy ?? "");
        if (pol.sellerShippingPolicy && useSellerProfileShipping) setShippingPolicy(pol.sellerShippingPolicy);
        if (pol.sellerLocalDeliveryPolicy && useSellerProfileLocalDelivery) {
          setLocalDeliveryTerms(pol.sellerLocalDeliveryPolicy);
        } else if (pol.sellerLocalDeliveryPolicy) {
          setLocalDeliveryTerms((prev) => prev || (pol.sellerLocalDeliveryPolicy ?? ""));
        }
        if (pol.sellerPickupPolicy) setPickupTerms((prev) => prev || (pol.sellerPickupPolicy ?? ""));
        if (pol.offerShipping !== undefined) setOfferShipping(pol.offerShipping);
        if (pol.offerLocalDelivery !== undefined) setOfferLocalDelivery(pol.offerLocalDelivery);
        if (pol.offerLocalPickup !== undefined) setOfferLocalPickup(pol.offerLocalPickup);
        if (pol.offerShipping === false) setShippingDisabled(true);
        if (pol.offerLocalDelivery === false) setLocalDeliveryAvailable(false);
        if (pol.offerLocalPickup === false) setInStorePickupAvailable(false);
        if (pol.offerLocalDelivery === false && pol.offerLocalPickup === false) setShippingDisabled(false);
      })
      .catch(() => {})
      .finally(() => setPoliciesLoaded(true));
  }, []);

  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const subShow = Keyboard.addListener(showEvt, (e) =>
      setKeyboardHeight(e.endCoordinates?.height ?? 0)
    );
    const subHide = Keyboard.addListener(hideEvt, () => setKeyboardHeight(0));
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, []);

  // Load required/recommended item specifics for an eBay leaf category; pre-seed required rows.
  const loadCategoryAspects = useCallback(async (categoryId: string) => {
    if (!categoryId) {
      setCategoryAspects([]);
      return;
    }
    try {
      const data = await apiGet<{ aspects?: EbayCategoryAspect[] }>(
        `/api/channels/ebay/category-aspects?categoryId=${encodeURIComponent(categoryId)}`
      );
      const list = data.aspects ?? [];
      setCategoryAspects(list);
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
      apiGet<{ categories?: EbayCategorySuggestion[] }>(
        `/api/channels/ebay/categories?q=${encodeURIComponent(q)}`
      )
        .then((data) => {
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

  // Load aspects for a previously-saved eBay category once the connection is known.
  useEffect(() => {
    if (ebayConnected && ebayCategoryId) void loadCategoryAspects(ebayCategoryId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ebayConnected]);

  const addAspectRow = () =>
    setAspects((prev) => (prev.length >= MAX_ASPECTS ? prev : [...prev, { name: "", value: "" }]));
  const setAspectName = (i: number, name: string) =>
    setAspects((prev) =>
      prev.map((a, idx) => (idx === i ? { ...a, name: name.slice(0, EBAY_ASPECT_NAME_MAX) } : a))
    );
  const setAspectValue = (i: number, value: string) =>
    setAspects((prev) =>
      prev.map((a, idx) => (idx === i ? { ...a, value: value.slice(0, EBAY_ASPECT_VALUE_MAX) } : a))
    );
  const removeAspectRow = (i: number) =>
    setAspects((prev) => prev.filter((_, idx) => idx !== i));
  const isRequiredAspect = (name: string) =>
    categoryAspects.some(
      (a) => a.required && a.name.trim().toLowerCase() === name.trim().toLowerCase()
    );

  const syncShippingPolicy = () => {
    apiGet<PoliciesResponse>("/api/me/policies")
      .then((data) => {
        const pol = data as PoliciesResponse;
        const policy = pol.sellerShippingPolicy ?? "";
        setSellerProfileShippingPolicy(policy);
        setShippingPolicy(policy);
      })
      .catch(() => {});
  };

  const syncPickupPolicy = () => {
    apiGet<PoliciesResponse>("/api/me/policies")
      .then((data) => {
        const pol = data as PoliciesResponse;
        const policy = pol.sellerPickupPolicy ?? "";
        setSellerProfilePickupPolicy(policy);
        setPickupTerms(policy);
      })
      .catch(() => {});
  };

  const syncLocalDeliveryPolicy = () => {
    apiGet<PoliciesResponse>("/api/me/policies")
      .then((data) => {
        const pol = data as PoliciesResponse;
        const policy = pol.sellerLocalDeliveryPolicy ?? "";
        setSellerProfileLocalDeliveryPolicy(policy);
        setLocalDeliveryTerms(policy);
      })
      .catch(() => {});
  };

  const refreshFromEbay = async () => {
    if (!editId) return;
    setRefreshingFromEbay(true);
    setError(null);
    try {
      const res = await apiPost<{
        ok: boolean;
        updated: boolean;
        changes: string[];
        message: string;
      }>("/api/channels/ebay/refresh", { storeItemId: editId });

      if (res.updated && res.changes.length > 0) {
        // Reload the item data to reflect changes
        const item = await apiGet<{
          title: string;
          description: string | null;
          photos: string[];
          category: string | null;
          subcategory: string | null;
          priceCents: number;
          quantity: number;
          ebayCategoryId?: number | null;
          aspects?: { name?: unknown; value?: unknown }[] | null;
        }>(`/api/store-items/${editId}`);

        // Update form state with fresh data
        setTitle(item.title ?? "");
        setDescription(item.description ?? "");
        setPhotos(item.photos ?? []);
        setCategory(item.category ?? "");
        setSubcategory(item.subcategory ?? "");
        setPriceCents(item.priceCents != null ? (item.priceCents / 100).toFixed(2) : "");
        setQuantity(String(item.quantity ?? 1));
        if (item.ebayCategoryId != null) setEbayCategoryId(String(item.ebayCategoryId));
        if (Array.isArray(item.aspects)) {
          setAspects(
            item.aspects.map((a) => ({ name: String(a?.name ?? ""), value: String(a?.value ?? "") }))
          );
        }

        Alert.alert("Refreshed from eBay", res.message);
      } else {
        Alert.alert("Up to Date", res.message);
      }
    } catch (e: unknown) {
      const err = e as { error?: string };
      setError(err?.error ?? "Failed to refresh from eBay");
    } finally {
      setRefreshingFromEbay(false);
    }
  };

  const pickPhotos = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow access to photos.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      quality: 0.8,
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
        if (
          typeof asset.fileSize === "number" &&
          asset.fileSize > MAX_LISTING_PHOTO_BYTES
        ) {
          setPhotoError(
            `Each photo must be under ${MAX_LISTING_PHOTO_BYTES / (1024 * 1024)}MB. Skip very large originals or compress them.`
          );
          continue;
        }
        const formData = new FormData();
        formData.append("file", {
          uri: asset.uri,
          type: asset.mimeType ?? "image/jpeg",
          name: `photo-${i}.jpg`,
        } as unknown as Blob);
        const { url } = await apiUploadFile("/api/upload", formData);
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
      if (urls.length > 0) {
        setPhotos((p) => {
          const next = [...p];
          for (const u of urls) {
            if (!next.includes(u)) next.push(u);
          }
          return next;
        });
      }
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = (url: string) => {
    setPhotos((p) => p.filter((u) => u !== url));
  };

  const effectiveShippingPolicy = useSellerProfileShipping
    ? sellerProfileShippingPolicy
    : shippingPolicy;

  const handleSubmit = async () => {
    const price = Math.round(parseFloat(priceCents) * 100);
    const qty = hasVariantsWithOptions ? 0 : parseInt(quantity, 10);
    const shipCost =
      shippingFree || !shippingCostDollars.trim()
        ? 0
        : Math.round(parseFloat(shippingCostDollars) * 100);
    const localFee = localDeliveryFeeDollars.trim()
      ? Math.round(parseFloat(localDeliveryFeeDollars) * 100)
      : null;

    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    if (!price || price < 1) {
      setError("Price must be at least $0.01");
      return;
    }
    if (!hasVariantsWithOptions && (!qty || qty < 1)) {
      setError("Quantity must be at least 1");
      return;
    }
    if (hasVariantsWithOptions) {
      if (!optionName.trim()) {
        setError("Option type is required (e.g. Size).");
        return;
      }
      const dup = optionRows.some(
        (o, i) =>
          optionRows.findIndex(
            (x) => x.value.trim().toLowerCase() === o.value.trim().toLowerCase()
          ) !== i
      );
      if (dup) {
        setError("Each option value must be unique.");
        return;
      }
      const totalOptionQty = sumOptionRows(optionRows);
      if (totalOptionQty < 1) {
        setError("Add at least one option with quantity 1 or more.");
        return;
      }
    }
    if (shippingDisabled && !localDeliveryAvailable && !inStorePickupAvailable) {
      setError("You must offer at least one form of delivery (shipping, local delivery, or pickup).");
      return;
    }
    if (ebayConnected && ebayCategoryId.trim()) {
      const filled = aspects
        .map((a) => ({ name: a.name.trim().toLowerCase(), value: a.value.trim() }))
        .filter((a) => a.name && a.value);
      const missingRequired = categoryAspects
        .filter((a) => a.required)
        .filter((a) => !filled.some((f) => f.name === a.name.trim().toLowerCase()))
        .map((a) => a.name);
      if (missingRequired.length > 0) {
        setError(
          `eBay requires these item details for this category: ${missingRequired.join(", ")}. Add them under "Item details".`
        );
        return;
      }
    }
    if (
      !shippingDisabled &&
      !(useSellerProfileShipping ? effectiveShippingPolicy : shippingPolicy).trim()
    ) {
      setError("Shipping policy is required when you offer shipping.");
      return;
    }
    if (
      localDeliveryAvailable &&
      !(useSellerProfileLocalDelivery ? sellerProfileLocalDeliveryPolicy : localDeliveryTerms).trim()
    ) {
      setError(
        useSellerProfileLocalDelivery
          ? "Set your Delivery Policy in Policies first, or uncheck \"Use seller profile default\" to add item-specific terms."
          : "Local delivery terms are required when you offer local delivery."
      );
      return;
    }
    if (
      inStorePickupAvailable &&
      !(useSellerProfilePickup ? sellerProfilePickupPolicy : pickupTerms).trim()
    ) {
      setError("Pickup terms are required when you offer local pickup.");
      return;
    }

    const variantPayload = buildVariantsPayload(inventoryMode, optionName, optionRows);

    const payloadQuantity =
      variantPayload != null ? sumOptionRows(optionRows) : qty;

    setError(null);
    setPhotoError(null);
    const catTrim = category.trim();
    const secTrim = secondaryCategory.trim();
    const secondaryPayload = secTrim && secTrim !== catTrim ? secTrim : null;
    const cleanedAspects = aspects
      .map((a) => ({ name: a.name.trim(), value: a.value.trim() }))
      .filter((a) => a.name && a.value);
    const basePayload: Record<string, unknown> = {
      title: title.trim().slice(0, EBAY_TITLE_MAX),
      aspects: cleanedAspects,
      ...(ebayConnected && ebayCategoryId.trim()
        ? { ebayCategoryId: Number(ebayCategoryId.trim()) }
        : {}),
      description: description.trim() || null,
      photos,
      category: catTrim || null,
      secondaryCategory: secondaryPayload,
      subcategory: subcategory.trim() || null,
      priceCents: price,
      quantity: payloadQuantity,
      condition,
      shippingDisabled,
      localDeliveryAvailable,
      inStorePickupAvailable,
      businessId: businessId || null,
      shippingCostCents:
        !shippingDisabled ? (shippingFree ? 0 : shipCost > 0 ? shipCost : null) : null,
      shippingPolicy:
        shippingDisabled || useSellerProfileShipping
          ? null
          : shippingPolicy.trim() || null,
      localDeliveryTerms:
        localDeliveryAvailable && !useSellerProfileLocalDelivery
          ? localDeliveryTerms.trim() || null
          : null,
      pickupTerms:
        inStorePickupAvailable && !useSellerProfilePickup
          ? pickupTerms.trim() || null
          : null,
      localDeliveryFeeCents: localFee,
      variants: variantPayload,
      ...(condition === "used" ? { acceptOffers } : { acceptOffers: false }),
    };

    if (editId) {
      const editPayload = {
        ...basePayload,
        ...(etsyConnected || ebayConnected
          ? {
              syncToChannels: etsyConnected ? syncToEtsy : true,
              ...(etsyConnected ? { etsyWhoMade, etsyWhenMade, etsyIsSupply } : {}),
              ...(ebayConnected && ebayCategoryId.trim()
                ? { ebayCategoryId: Number(ebayCategoryId.trim()) }
                : {}),
            }
          : {}),
      };
      await performListingSubmit(editPayload, true);
      return;
    }

    if (publishReadyConnections(channelConnections).length > 0) {
      pendingCreatePayloadRef.current = basePayload;
      setShowChannelPublishModal(true);
      return;
    }

    await performListingSubmit(
      { ...basePayload, syncToChannels: false, channelProviders: [] },
      false
    );
  };

  const performListingSubmit = async (
    payload: Record<string, unknown>,
    isEdit: boolean
  ) => {
    setSubmitting(true);
    submittedRef.current = true;
    try {
      isExitingRef.current = true;
      if (isEdit && editId) {
        const patchRes = await apiPatch<{
          channelSync?: { provider: string; ok: boolean; error?: string }[];
        }>(`/api/store-items/${editId}`, payload);
        alertChannelSyncFailures(patchRes.channelSync, "saved");
        setEditSuccess(true);
        setShowListingSuccessModal(true);
      } else {
        const res = await apiPost<{
          earnedBadges?: EarnedBadgePayload[];
          channelSync?: { provider: string; ok: boolean; error?: string }[];
        }>("/api/store-items", payload);
        alertChannelSyncFailures(res.channelSync, "saved");
        const badges = (res?.earnedBadges ?? []).filter(
          (b): b is EarnedBadgePayload =>
            !!b && typeof b.slug === "string" && typeof b.name === "string"
        );
        if (badges.length > 0) {
          setListingEarnedBadges(badges);
          setListingBadgePopupIndex(0);
        } else {
          setShowListingSuccessModal(true);
        }
      }
    } catch (e) {
      setError(
        (e as { error?: string })?.error ??
          (isEdit ? "Failed to update listing" : "Failed to create listing")
      );
      submittedRef.current = false;
      isExitingRef.current = false;
    } finally {
      setSubmitting(false);
    }
  };

  const handleChannelPublishConfirm = (providers: ChannelProviderId[]) => {
    setShowChannelPublishModal(false);
    const base = pendingCreatePayloadRef.current;
    pendingCreatePayloadRef.current = null;
    if (!base) return;
    const payload: Record<string, unknown> = {
      ...base,
      syncToChannels: providers.length > 0,
      channelProviders: providers,
      ...(providers.includes("etsy")
        ? { etsyWhoMade, etsyWhenMade, etsyIsSupply }
        : {}),
      ...(providers.includes("ebay") && ebayCategoryId.trim()
        ? { ebayCategoryId: Number(ebayCategoryId.trim()) }
        : {}),
    };
    void performListingSubmit(payload, false);
  };

  const handleCloseListingBadgePopup = () => {
    const next = listingBadgePopupIndex + 1;
    if (next < listingEarnedBadges.length) {
      setListingBadgePopupIndex(next);
    } else {
      setListingBadgePopupIndex(-1);
      setListingEarnedBadges([]);
      setShowListingSuccessModal(true);
    }
  };

  return (
    <View style={styles.screenWrapper}>
    <ChannelPublishModal
      visible={showChannelPublishModal}
      onClose={() => {
        setShowChannelPublishModal(false);
        pendingCreatePayloadRef.current = null;
      }}
      onConfirm={handleChannelPublishConfirm}
    />
    {listingBadgePopupIndex >= 0 && listingBadgePopupIndex < listingEarnedBadges.length && (
      <BadgeEarnedPopup
        visible
        onClose={handleCloseListingBadgePopup}
        badgeName={listingEarnedBadges[listingBadgePopupIndex].name}
        badgeSlug={listingEarnedBadges[listingBadgePopupIndex].slug}
        badgeDescription={listingEarnedBadges[listingBadgePopupIndex].description}
      />
    )}
    <Modal visible={showListingSuccessModal} transparent animationType="fade">
      <View style={styles.successModalOverlay}>
        <View style={styles.successModalCard}>
          <Text style={styles.successModalTitle}>
            {editSuccess ? "Item updated" : "Item listed successfully"}
          </Text>
          <Text style={styles.successModalSubtitle}>
            {editSuccess ? "Your changes have been saved." : "Your listing is now live."}
          </Text>
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
      contentContainerStyle={[
        styles.content,
        { paddingBottom: 40 + insets.bottom + keyboardHeight },
      ]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
    >
      <View style={styles.typeRow}>
        <Text style={styles.label}>Condition</Text>
        <View style={styles.typeBtns}>
          <Pressable
            style={({ pressed }) => [
              styles.typeBtn,
              condition === "new" && styles.typeBtnActive,
              pressed && { opacity: 0.8 },
            ]}
            onPress={() => setCondition("new")}
          >
            <Text
              style={
                condition === "new" ? styles.typeBtnTextActive : styles.typeBtnText
              }
            >
              New
            </Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.typeBtn,
              condition === "used" && styles.typeBtnActive,
              pressed && { opacity: 0.8 },
            ]}
            onPress={() => setCondition("used")}
          >
            <Text
              style={
                condition === "used"
                  ? styles.typeBtnTextActive
                  : styles.typeBtnText
              }
            >
              Used
            </Text>
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
      {photoError ? (
        <Text style={styles.photoErr}>{photoError}</Text>
      ) : null}

      <Text style={styles.label}>Title *</Text>
      <TextInput
        style={styles.input}
        placeholder="Item title"
        placeholderTextColor={placeholderColor}
        value={title}
        onChangeText={(t) => setTitle(t.slice(0, EBAY_TITLE_MAX))}
        maxLength={EBAY_TITLE_MAX}
        autoCorrect={true}
      />
      <Text style={[styles.hint, { textAlign: "right" }, title.length >= EBAY_TITLE_MAX ? { color: "#dc2626" } : null]}>
        {title.length}/{EBAY_TITLE_MAX}
      </Text>

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

      <Text style={styles.label}>Price ($) *</Text>
      <TextInput
        style={styles.input}
        placeholder="0.00"
        placeholderTextColor={placeholderColor}
        value={priceCents}
        onChangeText={setPriceCents}
        keyboardType="decimal-pad"
        autoCorrect={true}
      />

      <ListingOptionsEditor
        mode={inventoryMode}
        onModeChange={setInventoryMode}
        optionName={optionName}
        onOptionNameChange={setOptionName}
        optionRows={optionRows}
        onOptionRowsChange={setOptionRows}
        simpleQuantity={quantity}
        onSimpleQuantityChange={setQuantity}
        placeholderColor={placeholderColor}
        legacyMultiAxisNotice={legacyMultiAxisNotice}
      />

      <Text style={styles.label}>Category</Text>
      {useCustomCategory ? (
        <>
          <TextInput
            style={styles.input}
            placeholder="Your category"
            placeholderTextColor={placeholderColor}
            value={category}
            onChangeText={setCategory}
            autoCorrect={true}
          />
          <TextInput
            style={styles.input}
            placeholder="Second category (optional)"
            placeholderTextColor={placeholderColor}
            value={secondaryCategory}
            onChangeText={setSecondaryCategory}
            autoCorrect={true}
          />
          <TextInput
            style={styles.input}
            placeholder="Subcategory (optional)"
            placeholderTextColor={placeholderColor}
            value={subcategory}
            onChangeText={setSubcategory}
            autoCorrect={true}
          />
          <Pressable onPress={() => { setUseCustomCategory(false); setCategory(""); setSecondaryCategory(""); setSubcategory(""); }}>
            <Text style={[styles.hint, { color: theme.colors.primary }]}>Choose from list</Text>
          </Pressable>
        </>
      ) : (
        <>
          {storeCategories.length > 0 && (
            <>
              <Text style={styles.hint}>Search categories</Text>
              <TextInput
                style={styles.input}
                placeholder="Filter by name…"
                placeholderTextColor={placeholderColor}
                value={categorySearch}
                onChangeText={setCategorySearch}
                autoCorrect={false}
                autoCapitalize="none"
              />
              <Text style={styles.hint}>Category</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                  {filteredStoreCategories.map((c) => (
                    <Pressable
                      key={c.label}
                      style={[
                        styles.typeBtn,
                        category === c.label && styles.typeBtnActive,
                      ]}
                      onPress={() => {
                        setCategory(c.label);
                        setSubcategory("");
                        if (secondaryCategory === c.label) setSecondaryCategory("");
                      }}
                    >
                      <Text style={category === c.label ? styles.typeBtnTextActive : styles.typeBtnText} numberOfLines={1}>
                        {c.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
              {category && filteredSubcategoriesForCategory.length ? (
                <>
                  <Text style={styles.hint}>Subcategory (optional)</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
                    <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                      {filteredSubcategoriesForCategory.map((s) => (
                        <Pressable
                          key={s}
                          style={[styles.typeBtn, subcategory === s && styles.typeBtnActive]}
                          onPress={() => setSubcategory(subcategory === s ? "" : s)}
                        >
                          <Text style={subcategory === s ? styles.typeBtnTextActive : styles.typeBtnText} numberOfLines={1}>
                            {s}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </ScrollView>
                </>
              ) : null}
              <>
                <Text style={styles.hint}>Second category (optional)</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                  <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                    {filteredSecondaryStoreCategories.map((c) => (
                      <Pressable
                        key={`sec-${c.label}`}
                        style={[
                          styles.typeBtn,
                          secondaryCategory === c.label && styles.typeBtnActive,
                        ]}
                        onPress={() =>
                          setSecondaryCategory((prev) => (prev === c.label ? "" : c.label))
                        }
                      >
                        <Text
                          style={
                            secondaryCategory === c.label
                              ? styles.typeBtnTextActive
                              : styles.typeBtnText
                          }
                          numberOfLines={1}
                        >
                          {c.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
              </>
            </>
          )}
          {storeCategories.length === 0 && (
            <>
            <TextInput
              style={styles.input}
              placeholder="Category"
              placeholderTextColor={placeholderColor}
              value={category}
              onChangeText={setCategory}
              autoCorrect={true}
            />
            <TextInput
              style={styles.input}
              placeholder="Second category (optional)"
              placeholderTextColor={placeholderColor}
              value={secondaryCategory}
              onChangeText={setSecondaryCategory}
              autoCorrect={true}
            />
            </>
          )}
          {storeCategories.length > 0 && (
            <Pressable onPress={() => setUseCustomCategory(true)}>
              <Text style={[styles.hint, { color: theme.colors.primary }]}>Can&apos;t find your category? Add your own</Text>
            </Pressable>
          )}
        </>
      )}

      {/* Delivery options - three toggles from policy */}
      {policiesLoaded && (offerShipping || offerLocalDelivery || offerLocalPickup) && (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Delivery options</Text>

        {offerShipping && (
          <>
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Offer Shipping</Text>
              <Switch
                value={!shippingDisabled}
                onValueChange={(v) => {
                  const nextDisabled = !v;
                  if (nextDisabled && !localDeliveryAvailable && !inStorePickupAvailable) {
                    setLocalDeliveryAvailable(true);
                  }
                  setShippingDisabled(nextDisabled);
                }}
                trackColor={switchTrackColor()}
                thumbColor={switchThumbColor(!shippingDisabled)}
                ios_backgroundColor={switchIosBackgroundColor}
              />
            </View>
            {!shippingDisabled && (
              <>
                <Text style={styles.label}>Shipping price ($)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 5.99"
                  placeholderTextColor={placeholderColor}
                  value={shippingCostDollars}
                  onChangeText={(v) => {
                    setShippingCostDollars(v);
                    if (v.trim()) setShippingFree(false);
                  }}
                  keyboardType="decimal-pad"
                  editable={!shippingFree}
                  autoCorrect={true}
                />
                <View style={styles.checkboxRow}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.checkbox,
                      shippingFree && styles.checkboxChecked,
                      pressed && { opacity: 0.8 },
                    ]}
                    onPress={() => {
                      setShippingFree((prev) => {
                        if (!prev) setShippingCostDollars("");
                        return !prev;
                      });
                    }}
                  >
                    {shippingFree && <Text style={styles.checkboxCheck}>✓</Text>}
                  </Pressable>
                  <Text
                    style={styles.checkboxLabel}
                    onPress={() => {
                      setShippingFree((prev) => {
                        if (!prev) setShippingCostDollars("");
                        return !prev;
                      });
                    }}
                  >
                    Free
                  </Text>
                </View>
                <Text style={styles.label}>Shipping Policy</Text>
                <View style={styles.policyRow}>
                  <TextInput
                    style={[
                      styles.input,
                      styles.textAreaSmall,
                      useSellerProfileShipping && styles.inputReadonly,
                    ]}
                    placeholder="e.g. 2-5 business days via USPS. Free over $50."
                    placeholderTextColor={placeholderColor}
                    value={
                      useSellerProfileShipping ? effectiveShippingPolicy : shippingPolicy
                    }
                    onChangeText={(v) => {
                      if (!useSellerProfileShipping) setShippingPolicy(v);
                    }}
                    editable={!useSellerProfileShipping}
                    multiline
                    scrollEnabled={false}
                    autoCorrect={true}
                    numberOfLines={3}
                    textAlignVertical="top"
                  />
                  <Pressable
                    style={({ pressed }) => [
                      styles.syncBtn,
                      pressed && { opacity: 0.8 },
                    ]}
                    onPress={syncShippingPolicy}
                  >
                    <Text style={styles.syncBtnText}>Sync</Text>
                  </Pressable>
                </View>
                <View style={styles.switchRow}>
                  <Text style={styles.switchLabel}>
                    Use seller profile default
                  </Text>
                  <Switch
                    value={useSellerProfileShipping}
                    onValueChange={(v) => {
                      setUseSellerProfileShipping(v);
                      if (v) setShippingPolicy("");
                    }}
                    trackColor={switchTrackColor()}
                    thumbColor={switchThumbColor(useSellerProfileShipping)}
                    ios_backgroundColor={switchIosBackgroundColor}
                  />
                </View>
                <Text style={styles.hint}>
                  {useSellerProfileShipping
                    ? "Synced from your seller profile. Uncheck to set item-specific policy."
                    : "Item-specific shipping policy (overrides profile default)."}
                </Text>
              </>
            )}
          </>
        )}

        {offerLocalDelivery && (
          <>
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Offer Local Delivery</Text>
              <Switch
                value={localDeliveryAvailable}
                onValueChange={(v) => {
                  if (!v && shippingDisabled && !inStorePickupAvailable) return;
                  setLocalDeliveryAvailable(v);
                }}
                trackColor={switchTrackColor()}
                thumbColor={switchThumbColor(localDeliveryAvailable)}
                ios_backgroundColor={switchIosBackgroundColor}
              />
            </View>
            {localDeliveryAvailable && (
              <>
                <Text style={styles.label}>Local delivery fee ($, optional)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 5.00 or leave blank for free"
                  placeholderTextColor={placeholderColor}
                  value={localDeliveryFeeDollars}
                  onChangeText={setLocalDeliveryFeeDollars}
                  keyboardType="decimal-pad"
                  autoCorrect={true}
                />
                <Text style={styles.label}>Local delivery terms</Text>
                <View style={styles.policyRow}>
                  <TextInput
                    style={[
                      styles.input,
                      styles.textAreaSmall,
                      useSellerProfileLocalDelivery && styles.inputReadonly,
                    ]}
                    placeholder="e.g. Areas served, contact method, timing."
                    placeholderTextColor={placeholderColor}
                    value={
                      useSellerProfileLocalDelivery
                        ? sellerProfileLocalDeliveryPolicy
                        : localDeliveryTerms
                    }
                    onChangeText={(v) => {
                      if (!useSellerProfileLocalDelivery) setLocalDeliveryTerms(v);
                    }}
                    autoCorrect={true}
                    editable={!useSellerProfileLocalDelivery}
                    multiline
                    scrollEnabled={false}
                    numberOfLines={3}
                    textAlignVertical="top"
                  />
                  <Pressable
                    style={({ pressed }) => [styles.syncBtn, pressed && { opacity: 0.8 }]}
                    onPress={syncLocalDeliveryPolicy}
                  >
                    <Text style={styles.syncBtnText}>Sync</Text>
                  </Pressable>
                </View>
                <View style={styles.switchRow}>
                  <Text style={styles.switchLabel}>Use seller profile default</Text>
                  <Switch
                    value={useSellerProfileLocalDelivery}
                    onValueChange={(v) => {
                      setUseSellerProfileLocalDelivery(v);
                      if (v) setLocalDeliveryTerms("");
                    }}
                    trackColor={switchTrackColor()}
                    thumbColor={switchThumbColor(useSellerProfileLocalDelivery)}
                    ios_backgroundColor={switchIosBackgroundColor}
                  />
                </View>
                <Text style={styles.hint}>
                  {useSellerProfileLocalDelivery
                    ? "Synced from your Policies screen. Uncheck to set item-specific terms."
                    : "Item-specific delivery terms (overrides profile default)."}
                </Text>
              </>
            )}
          </>
        )}

        {offerLocalPickup && (
          <>
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Offer Local Pick Up</Text>
              <Switch
                value={inStorePickupAvailable}
                onValueChange={(v) => {
                  if (!v && shippingDisabled && !localDeliveryAvailable) return;
                  setInStorePickupAvailable(v);
                }}
                trackColor={switchTrackColor()}
                thumbColor={switchThumbColor(inStorePickupAvailable)}
                ios_backgroundColor={switchIosBackgroundColor}
              />
            </View>
            {inStorePickupAvailable && (
              <>
                <Text style={styles.label}>Pickup terms</Text>
                <View style={styles.policyRow}>
                  <TextInput
                    style={[
                      styles.input,
                      styles.textAreaSmall,
                      useSellerProfilePickup && styles.inputReadonly,
                    ]}
                    placeholder="e.g. Location, contact method, hours."
                    placeholderTextColor={placeholderColor}
                    value={
                      useSellerProfilePickup ? sellerProfilePickupPolicy : pickupTerms
                    }
                    onChangeText={(v) => {
                      if (!useSellerProfilePickup) setPickupTerms(v);
                    }}
                    editable={!useSellerProfilePickup}
                    multiline
                    scrollEnabled={false}
                    autoCorrect={true}
                    numberOfLines={3}
                    textAlignVertical="top"
                  />
                  <Pressable
                    style={({ pressed }) => [
                      styles.syncBtn,
                      pressed && { opacity: 0.8 },
                    ]}
                    onPress={syncPickupPolicy}
                  >
                    <Text style={styles.syncBtnText}>Sync</Text>
                  </Pressable>
                </View>
                <View style={styles.switchRow}>
                  <Text style={styles.switchLabel}>Use seller profile default</Text>
                  <Switch
                    value={useSellerProfilePickup}
                    onValueChange={(v) => {
                      setUseSellerProfilePickup(v);
                      if (v) setPickupTerms("");
                    }}
                    trackColor={switchTrackColor()}
                    thumbColor={switchThumbColor(useSellerProfilePickup)}
                    ios_backgroundColor={switchIosBackgroundColor}
                  />
                </View>
                <Text style={styles.hint}>
                  {useSellerProfilePickup
                    ? "Synced from your seller profile. Uncheck to set item-specific terms."
                    : "Item-specific pickup terms (overrides profile default)."}
                </Text>
              </>
            )}
          </>
        )}

      </View>
      )}

      {policiesLoaded && !(offerShipping || offerLocalDelivery || offerLocalPickup) && (
        <View style={[styles.section, { backgroundColor: "#f9f9f9", padding: 16 }]}>
          <Text style={styles.hint}>
            Set your fulfillment options in Policies (Policies screen or Seller Profile) to
            enable shipping, local delivery, and pickup here.
          </Text>
          <Pressable
            style={({ pressed }) => [
              styles.policiesBtn,
              pressed && { opacity: 0.8 },
            ]}
            onPress={() => (router.push as (href: string) => void)("/policies")}
          >
            <Text style={styles.policiesBtnText}>Open Policies</Text>
          </Pressable>
        </View>
      )}

      {!policiesLoaded && (
        <View style={[styles.section, { alignItems: "center", padding: 24 }]}>
          <ActivityIndicator size="small" color={theme.colors.primary} />
          <Text style={styles.hint}>Loading your policies…</Text>
        </View>
      )}

      {businesses.length >= 2 && (
        <>
          <Text style={styles.label}>Which business is this item posted under?</Text>
          <View style={styles.bizRow}>
            <Pressable
              style={({ pressed }) => [
                styles.bizBtn,
                !businessId && styles.bizBtnActive,
                pressed && { opacity: 0.8 },
              ]}
              onPress={() => setBusinessId(null)}
            >
              <Text style={!businessId ? styles.bizBtnTextActive : styles.bizBtnText}>
                None
              </Text>
            </Pressable>
            {businesses.map((b) => (
              <Pressable
                key={b.id}
                style={({ pressed }) => [
                  styles.bizBtn,
                  businessId === b.id && styles.bizBtnActive,
                  pressed && { opacity: 0.8 },
                ]}
                onPress={() => setBusinessId(businessId === b.id ? null : b.id)}
              >
                <Text
                  style={
                    businessId === b.id
                      ? styles.bizBtnTextActive
                      : styles.bizBtnText
                  }
                >
                  {b.name}
                </Text>
              </Pressable>
            ))}
          </View>
        </>
      )}

      {etsyConnected && (
        <>
          <Text style={styles.sectionTitle}>Etsy sync</Text>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>List this item on Etsy too</Text>
            <Switch
              value={syncToEtsy}
              onValueChange={setSyncToEtsy}
              trackColor={switchTrackColor()}
              thumbColor={switchThumbColor(syncToEtsy)}
              ios_backgroundColor={switchIosBackgroundColor}
            />
          </View>
          <Text style={styles.hint}>
            When on, this listing is created/updated on your connected Etsy shop and inventory stays
            in sync across both stores.
          </Text>

          {syncToEtsy && (
            <>
              <Text style={styles.label}>Who made it?</Text>
              <View style={styles.bizRow}>
                {(
                  [
                    { v: "i_did", label: "I did" },
                    { v: "someone_else", label: "Another company or person" },
                    { v: "collective", label: "A member of my shop" },
                  ] as const
                ).map((opt) => (
                  <Pressable
                    key={opt.v}
                    style={etsyWhoMade === opt.v ? styles.bizBtnActive : styles.bizBtn}
                    onPress={() => setEtsyWhoMade(opt.v)}
                  >
                    <Text style={etsyWhoMade === opt.v ? styles.bizBtnTextActive : styles.bizBtnText}>
                      {opt.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.label}>When was it made?</Text>
              <View style={styles.bizRow}>
                {(
                  [
                    { v: "made_to_order", label: "Made to order" },
                    { v: "2020_2025", label: "2020-2025" },
                    { v: "before_2006", label: "Before 2006 (vintage)" },
                  ] as const
                ).map((opt) => (
                  <Pressable
                    key={opt.v}
                    style={etsyWhenMade === opt.v ? styles.bizBtnActive : styles.bizBtn}
                    onPress={() => setEtsyWhenMade(opt.v)}
                  >
                    <Text style={etsyWhenMade === opt.v ? styles.bizBtnTextActive : styles.bizBtnText}>
                      {opt.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>This is a craft supply or tool</Text>
                <Switch
                  value={etsyIsSupply}
                  onValueChange={setEtsyIsSupply}
                  trackColor={switchTrackColor()}
                  thumbColor={switchThumbColor(etsyIsSupply)}
                  ios_backgroundColor={switchIosBackgroundColor}
                />
              </View>
              <Text style={styles.hint}>
                Etsy requires these details to publish a listing. Items publish live only when your
                Etsy shop has a shipping profile.
              </Text>
            </>
          )}
        </>
      )}

      {ebayConnected && (
        <>
          <Text style={styles.sectionTitle}>eBay sync</Text>
          <Text style={styles.hint}>
            This listing is created and kept in sync on your connected eBay account. A sale on either
            store updates inventory on both. eBay listings publish live only when your eBay account
            has business policies (payment, return, shipping) and a merchant location.
          </Text>
          {editId && hasEbayLink && (
            <Pressable
              style={[styles.refreshEbayButton, refreshingFromEbay && styles.refreshEbayButtonDisabled]}
              onPress={refreshFromEbay}
              disabled={refreshingFromEbay}
            >
              {refreshingFromEbay ? (
                <ActivityIndicator size="small" color={theme.colors.primary} />
              ) : (
                <Text style={styles.refreshEbayButtonText}>Refresh from eBay</Text>
              )}
            </Pressable>
          )}
          <Text style={styles.label}>eBay category</Text>
          {ebayCategoryId ? (
            <View style={styles.ebayCategoryChip}>
              <View style={{ flex: 1 }}>
                <Text style={styles.ebayCategoryChipLabel} numberOfLines={2}>
                  {ebayCategoryLabel || `eBay category #${ebayCategoryId}`}
                </Text>
                <Text style={styles.hint}>eBay category #{ebayCategoryId}</Text>
              </View>
              <Pressable
                onPress={() => {
                  setEbayCategoryId("");
                  setEbayCategoryLabel("");
                  setEbayCategorySearch("");
                  setCategoryAspects([]);
                }}
              >
                <Text style={styles.ebayCategoryChange}>Change</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <TextInput
                style={styles.input}
                value={ebayCategorySearch}
                onChangeText={setEbayCategorySearch}
                placeholder="Search eBay categories (e.g. US coins)"
                placeholderTextColor="#999"
              />
              {ebaySearching ? <Text style={styles.hint}>Searching eBay…</Text> : null}
              {ebayCategoryResults.map((c) => (
                <Pressable
                  key={c.categoryId}
                  style={styles.ebayCategoryResult}
                  onPress={() => {
                    setEbayCategoryId(c.categoryId);
                    setEbayCategoryLabel(c.categoryPath || c.categoryName);
                    setEbayCategoryResults([]);
                    setEbayCategorySearch("");
                    void loadCategoryAspects(c.categoryId);
                  }}
                >
                  <Text style={styles.ebayCategoryResultName}>{c.categoryName}</Text>
                  {c.categoryPath && c.categoryPath !== c.categoryName ? (
                    <Text style={styles.hint} numberOfLines={1}>
                      {c.categoryPath}
                    </Text>
                  ) : null}
                </Pressable>
              ))}
            </>
          )}

          <Text style={styles.label}>Item details</Text>
          <Text style={styles.hint}>
            Add a detail (Descriptor + Value), e.g. Brand → Nike. eBay requires certain details to
            publish. Required details are marked *.
          </Text>
          {aspects.map((a, i) => {
            const required = isRequiredAspect(a.name);
            return (
              <View key={i} style={styles.aspectRow}>
                <TextInput
                  style={[styles.input, styles.aspectInput]}
                  value={a.name}
                  onChangeText={(t) => setAspectName(i, t)}
                  placeholder="Descriptor"
                  maxLength={EBAY_ASPECT_NAME_MAX}
                  placeholderTextColor="#999"
                />
                <TextInput
                  style={[
                    styles.input,
                    styles.aspectInput,
                    required && !a.value.trim() ? styles.aspectInputRequired : null,
                  ]}
                  value={a.value}
                  onChangeText={(t) => setAspectValue(i, t)}
                  placeholder={required ? "Value (required)" : "Value"}
                  maxLength={EBAY_ASPECT_VALUE_MAX}
                  placeholderTextColor="#999"
                />
                <Pressable onPress={() => removeAspectRow(i)} style={styles.aspectRemove}>
                  <Text style={styles.aspectRemoveText}>×</Text>
                </Pressable>
              </View>
            );
          })}
          {aspects.length < MAX_ASPECTS ? (
            <Pressable style={styles.addDetailBtn} onPress={addAspectRow}>
              <Text style={styles.addDetailBtnText}>+ Add a detail</Text>
            </Pressable>
          ) : null}
        </>
      )}

      {error && (
        <View style={styles.errorWrap}>
          <Text style={styles.err}>{error}</Text>
        </View>
      )}

      <Pressable
        style={({ pressed }) => [
          styles.submitBtn,
          pressed && { opacity: 0.8 },
          submitting && styles.submitDisabled,
        ]}
        onPress={handleSubmit}
        disabled={submitting}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Text style={styles.submitBtnText}>{editId ? "Update Item" : "List an Item"}</Text>
        )}
      </Pressable>
    </ScrollView>
    </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screenWrapper: { flex: 1, backgroundColor: "#fff" },
  keyboardAvoid: { flex: 1 },
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 20, paddingBottom: 40 },
  successModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  successModalCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 24,
    width: "100%",
    maxWidth: 340,
    borderWidth: 2,
    borderColor: defaultTheme.colors.primary,
  },
  successModalTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#000",
    textAlign: "center",
    marginBottom: 8,
  },
  successModalSubtitle: {
    fontSize: 15,
    color: "#666",
    textAlign: "center",
    marginBottom: 24,
  },
  successModalBtn: {
    backgroundColor: defaultTheme.colors.primary,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 12,
  },
  successModalBtnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  successModalBtnSecondary: {
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    borderWidth: 2,
    borderColor: defaultTheme.colors.primary,
  },
  successModalBtnTextSecondary: {
    color: defaultTheme.colors.primary,
    fontSize: 16,
    fontWeight: "600",
  },
  errorWrap: { marginTop: 8, marginBottom: 16 },
  err: { color: "#c62828", marginBottom: 0, fontSize: 14 },
  label: { fontSize: 14, fontWeight: "600", marginBottom: 8, color: "#000" },
  hint: { fontSize: 12, color: defaultTheme.colors.labelMuted, marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 16,
    color: defaultTheme.colors.text,
  },
  inputReadonly: { backgroundColor: "#f5f5f5" },
  textArea: { minHeight: 80, textAlignVertical: "top" },
  textAreaSmall: { minHeight: 60, textAlignVertical: "top" },
  photoRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 8 },
  photoErr: {
    fontSize: 14,
    color: defaultTheme.colors.primary,
    marginBottom: 12,
    lineHeight: 20,
  },
  photoWrap: { position: "relative" },
  photo: { width: 80, height: 80, borderRadius: 8 },
  removePhoto: {
    position: "absolute",
    top: -8,
    right: -8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#c62828",
    justifyContent: "center",
    alignItems: "center",
  },
  removePhotoText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  addPhoto: {
    width: 80,
    height: 80,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: defaultTheme.colors.primary,
    borderStyle: "dashed",
    justifyContent: "center",
    alignItems: "center",
  },
  addPhotoText: { color: defaultTheme.colors.primary, fontWeight: "600" },
  typeRow: { marginBottom: 16 },
  typeBtns: { flexDirection: "row", gap: 8, marginTop: 8 },
  typeBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ccc",
  },
  typeBtnActive: {
    backgroundColor: defaultTheme.colors.primary,
    borderColor: defaultTheme.colors.primary,
  },
  typeBtnText: { color: "#333", fontSize: 16 },
  typeBtnTextActive: { color: "#fff", fontWeight: "600", fontSize: 16 },
  section: {
    borderTopWidth: 1,
    borderTopColor: "#eee",
    paddingTop: 16,
    marginTop: 8,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#000",
    marginBottom: 12,
  },
  ebayCategoryChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    backgroundColor: "#f7f7f7",
    padding: 12,
    marginBottom: 8,
  },
  ebayCategoryChipLabel: { fontSize: 14, fontWeight: "600", color: "#000" },
  ebayCategoryChange: { color: "#dc2626", fontSize: 14, fontWeight: "600" },
  refreshEbayButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.colors.primary,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  refreshEbayButtonDisabled: {
    opacity: 0.5,
  },
  refreshEbayButtonText: {
    color: theme.colors.primary,
    fontSize: 14,
    fontWeight: "600",
  },
  ebayCategoryResult: {
    borderWidth: 1,
    borderColor: "#eee",
    borderRadius: 8,
    padding: 10,
    marginBottom: 6,
  },
  ebayCategoryResultName: { fontSize: 14, fontWeight: "600", color: "#000" },
  aspectRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  aspectInput: { flex: 1, marginBottom: 0 },
  aspectInputRequired: { borderColor: "#f87171" },
  aspectRemove: { paddingHorizontal: 6, paddingVertical: 4 },
  aspectRemoveText: { color: "#dc2626", fontSize: 22, fontWeight: "700", lineHeight: 24 },
  addDetailBtn: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    marginBottom: 8,
  },
  addDetailBtnText: { color: "#333", fontSize: 14, fontWeight: "600" },
  switchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  switchLabel: { fontSize: 14, color: "#000", flex: 1 },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 16,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 2,
    borderColor: "#ccc",
    borderRadius: 4,
    justifyContent: "center",
    alignItems: "center",
  },
  checkboxChecked: {
    backgroundColor: defaultTheme.colors.primary,
    borderColor: defaultTheme.colors.primary,
  },
  checkboxCheck: { color: "#fff", fontSize: 14, fontWeight: "700" },
  checkboxLabel: { fontSize: 14, color: "#000" },
  policyRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  syncBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    backgroundColor: "#fff",
  },
  syncBtnText: { color: "#000", fontSize: 14, fontWeight: "600" },
  policiesBtn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderWidth: 2,
    borderColor: defaultTheme.colors.primary,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 8,
  },
  policiesBtnText: {
    color: defaultTheme.colors.primary,
    fontWeight: "600",
    fontSize: 15,
  },
  bizRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  bizBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ccc",
  },
  bizBtnActive: {
    backgroundColor: defaultTheme.colors.creamAlt,
    borderColor: defaultTheme.colors.primary,
  },
  bizBtnText: { color: defaultTheme.colors.labelMuted },
  bizBtnTextActive: { color: defaultTheme.colors.primary, fontWeight: "600" },
  submitBtn: {
    marginTop: 24,
    backgroundColor: defaultTheme.colors.primary,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
  },
  submitDisabled: { opacity: 0.7 },
  submitBtnText: { color: "#fff", fontWeight: "600", fontSize: 16 },
});
