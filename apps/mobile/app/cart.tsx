import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Image,
  Pressable,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from "react-native";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Swipeable } from "react-native-gesture-handler";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { WebView } from "react-native-webview";
import { theme } from "@/lib/theme";
import { apiGet, apiPost, apiPatch, apiDelete, getToken, API_BASE } from "@/lib/api";
import {
  LocalDeliveryModal,
  type LocalDeliveryDetails,
} from "@/components/LocalDeliveryModal";
import {
  PickupTermsModal,
  type PickupDetails,
} from "@/components/PickupTermsModal";
import { AddressSearchInput } from "@/components/AddressSearchInput";
import {
  StorefrontNativeCheckoutButton,
  type StorefrontCheckoutPayload,
} from "@/components/StorefrontNativeCheckoutButton";
import { useAuth } from "@/contexts/AuthContext";
import { OrderSuccessOverlay, type OrderSuccessItem } from "@/components/OrderSuccessOverlay";
import { buildProductPath } from "@/lib/product-referrer";
import {
  getAvailableQuantityForSelection,
  getSkuPhotos,
  getSkuPriceCents,
} from "@/lib/product-variants";

const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

const stripePublishableKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
const hasStripeKey = !!stripePublishableKey && !stripePublishableKey.includes("placeholder");
const isExpoGo = Constants.appOwnership === "expo";
const useNativeStorefrontCheckout = hasStripeKey && !isExpoGo;

interface CartItemStoreItem {
  id: string;
  title: string;
  slug: string;
  photos: string[];
  priceCents: number;
  quantity: number;
  variants?: unknown;
  inventoryTracking?: string | null;
  shippingCostCents?: number | null;
  localDeliveryFeeCents?: number | null;
  localDeliveryAvailable?: boolean;
  inStorePickupAvailable?: boolean;
  shippingDisabled?: boolean;
  pickupTerms?: string | null;
  localDeliveryTerms?: string | null;
  member?: {
    sellerLocalDeliveryPolicy?: string | null;
    sellerPickupPolicy?: string | null;
  };
}

interface CartItem {
  id: string;
  storeItemId: string;
  quantity: number;
  variant: unknown;
  /** From GET /api/cart — SKU or agreed resale offer unit price */
  unitPriceCents?: number;
  resaleOfferId?: string | null;
  availableQuantity?: number;
  fulfillmentType?: string | null;
  localDeliveryDetails?: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    email?: string;
    deliveryAddress?: { street?: string; city?: string; state?: string; zip?: string };
    availableDropOffTimes?: string;
    note?: string;
    termsAcceptedAt?: string;
  } | null;
  pickupDetails?: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    email?: string;
    preferredPickupDate?: string;
    preferredPickupTime?: string;
    note?: string;
    termsAcceptedAt?: string;
  } | null;
  storeItem: CartItemStoreItem;
  unavailableReason?: string;
}

/** Row from GET /api/resale-offers?role=buyer (cart “Your offers” section). */
interface CartBuyerOfferRow {
  id: string;
  status: string;
  amountCents: number;
  counterAmountCents?: number | null;
  finalAmountCents?: number | null;
  checkoutDeadlineAt?: string | null;
  createdAt?: string;
  storeItem: { id: string; title: string; slug: string; priceCents: number; photos: string[] };
}

function sortBuyerOffersForCart(offers: CartBuyerOfferRow[]): CartBuyerOfferRow[] {
  const rank: Record<string, number> = { countered: 0, accepted: 1, pending: 2, declined: 3, expired: 4 };
  return [...offers].sort((a, b) => {
    const ra = rank[a.status] ?? 99;
    const rb = rank[b.status] ?? 99;
    if (ra !== rb) return ra - rb;
    const da = new Date(a.createdAt ?? 0).getTime();
    const db = new Date(b.createdAt ?? 0).getTime();
    return db - da;
  });
}

function dismissedBuyerOffersStorageKey(memberId: string): string {
  return `inw_cart_dismissed_buyer_offers:${memberId}`;
}

async function persistDismissedBuyerOfferIds(memberId: string, ids: Set<string>): Promise<void> {
  try {
    await AsyncStorage.setItem(dismissedBuyerOffersStorageKey(memberId), JSON.stringify([...ids]));
  } catch {
    /* ignore */
  }
}

function buyerOfferStatusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "Waiting for seller";
    case "countered":
      return "Counter offer — respond";
    case "accepted":
      return "Accepted — checkout";
    case "declined":
      return "Declined";
    case "expired":
      return "Expired";
    default:
      return status;
  }
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function resolvePhotoUrl(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
}

function variantAsSelection(variant: unknown): Record<string, string> | null {
  if (!variant || typeof variant !== "object" || Array.isArray(variant)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(variant as Record<string, unknown>)) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s) out[k] = s;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function formatVariantLabel(variant: unknown): string | null {
  const sel = variantAsSelection(variant);
  if (!sel) return null;
  return Object.entries(sel)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" · ");
}

function cartLineUnitPriceCents(item: CartItem): number {
  if (item.resaleOfferId && typeof item.unitPriceCents === "number") {
    return item.unitPriceCents;
  }
  const sel = variantAsSelection(item.variant);
  if (sel && item.storeItem.variants != null) {
    return getSkuPriceCents(
      { priceCents: item.storeItem.priceCents, variants: item.storeItem.variants },
      sel
    );
  }
  if (typeof item.unitPriceCents === "number") return item.unitPriceCents;
  return item.storeItem.priceCents;
}

function cartLineMaxQuantity(item: CartItem): number {
  if (typeof item.availableQuantity === "number") {
    return Math.max(0, item.availableQuantity);
  }
  const sel = variantAsSelection(item.variant);
  if (sel) {
    return getAvailableQuantityForSelection(
      {
        quantity: item.storeItem.quantity,
        variants: item.storeItem.variants,
        inventoryTracking: item.storeItem.inventoryTracking,
      },
      sel
    );
  }
  return Math.max(0, item.storeItem.quantity);
}

function cartLinePhotoUrl(item: CartItem): string | undefined {
  const sel = variantAsSelection(item.variant);
  const photos =
    sel && item.storeItem.variants != null
      ? getSkuPhotos(
          { photos: item.storeItem.photos ?? [], variants: item.storeItem.variants },
          sel
        )
      : item.storeItem.photos;
  return resolvePhotoUrl(photos?.[0]);
}

function fulfillmentMeta(type: string | null | undefined): {
  label: string;
  icon: "bicycle-outline" | "storefront-outline" | "cube-outline";
} {
  if (type === "local_delivery") return { label: "Local delivery", icon: "bicycle-outline" };
  if (type === "pickup") return { label: "Pickup", icon: "storefront-outline" };
  return { label: "Ships to you", icon: "cube-outline" };
}

/** Stripe return URLs from storefront order-success. */
function parseOrderSuccessCheckoutParams(url: string): { orderIds: string[]; sessionId: string | null } {
  try {
    const qIdx = url.indexOf("?");
    if (qIdx < 0) return { orderIds: [], sessionId: null };
    const qs = url.slice(qIdx + 1).split("#")[0];
    const params = new URLSearchParams(qs);
    const o1 = params.get("order_ids");
    const raw = o1?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
    return { orderIds: [...new Set(raw)], sessionId: params.get("session_id") };
  } catch {
    return { orderIds: [], sessionId: null };
  }
}

function snapshotPurchaseItemsFromCart(cartItems: CartItem[]): OrderSuccessItem[] {
  const seen = new Set<string>();
  const out: OrderSuccessItem[] = [];
  for (const item of cartItems) {
    const id = item.storeItemId || item.storeItem.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      storeItemId: id,
      slug: item.storeItem.slug,
      title: item.storeItem.title,
      photoUrl: cartLinePhotoUrl(item),
    });
  }
  return out;
}

function mapSuccessSummaryItems(raw: unknown): OrderSuccessItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: OrderSuccessItem[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const storeItemId = typeof r.storeItemId === "string" ? r.storeItemId : "";
    const slug = typeof r.slug === "string" ? r.slug : "";
    if (!storeItemId || seen.has(storeItemId)) continue;
    seen.add(storeItemId);
    const photo = typeof r.photo === "string" ? r.photo : undefined;
    out.push({
      storeItemId,
      slug,
      title: typeof r.title === "string" ? r.title : "",
      photoUrl: resolvePhotoUrl(photo),
      orderId: typeof r.orderId === "string" ? r.orderId : undefined,
    });
  }
  return out;
}

/** Mirrors server `storeItemHasLocalDeliveryPolicy` in pickup-delivery-checkout.ts */
function storeItemHasLocalDeliveryPolicy(storeItem: CartItemStoreItem): boolean {
  const t = storeItem.localDeliveryTerms ?? storeItem.member?.sellerLocalDeliveryPolicy;
  return !!(t && String(t).trim());
}

type LoadCartArg = boolean | { refresh?: boolean; silent?: boolean } | undefined;

function parseLoadCartArg(arg: LoadCartArg): { refresh: boolean; silent: boolean } {
  if (arg === undefined) return { refresh: false, silent: false };
  if (typeof arg === "boolean") return { refresh: arg, silent: false };
  return { refresh: !!arg.refresh, silent: arg.silent === true };
}

export default function CartScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { member } = useAuth();
  const [items, setItems] = useState<CartItem[]>([]);
  const [buyerOffers, setBuyerOffers] = useState<CartBuyerOfferRow[]>([]);
  const [dismissedBuyerOfferIds, setDismissedBuyerOfferIds] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [error, setError] = useState("");
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [orderJustConfirmed, setOrderJustConfirmed] = useState(false);
  const [confirmedPurchaseItems, setConfirmedPurchaseItems] = useState<OrderSuccessItem[]>([]);
  const pendingPurchaseItemsRef = useRef<OrderSuccessItem[]>([]);
  const [shippingAddress, setShippingAddress] = useState({
    street: "",
    aptOrSuite: "",
    city: "",
    state: "",
    zip: "",
  });
  const [shippingAddressFromPlaces, setShippingAddressFromPlaces] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);
  const initialCartFocusLoadDoneRef = useRef(false);

  useEffect(() => {
    if (!member?.id) {
      setDismissedBuyerOfferIds(new Set());
      return;
    }
    let cancelled = false;
    AsyncStorage.getItem(dismissedBuyerOffersStorageKey(member.id))
      .then((raw) => {
        if (cancelled) return;
        try {
          const parsed = raw ? (JSON.parse(raw) as unknown) : [];
          if (Array.isArray(parsed)) {
            setDismissedBuyerOfferIds(new Set(parsed.filter((x): x is string => typeof x === "string")));
          } else {
            setDismissedBuyerOfferIds(new Set());
          }
        } catch {
          setDismissedBuyerOfferIds(new Set());
        }
      })
      .catch(() => {
        if (!cancelled) setDismissedBuyerOfferIds(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [member?.id]);

  useEffect(() => {
    const memberId = member?.id;
    if (!memberId || buyerOffers.length === 0) return;
    const valid = new Set(buyerOffers.map((o) => o.id));
    setDismissedBuyerOfferIds((prev) => {
      const next = new Set([...prev].filter((id) => valid.has(id)));
      if (next.size === prev.size) return prev;
      void persistDismissedBuyerOfferIds(memberId, next);
      return next;
    });
  }, [buyerOffers, member?.id]);

  const visibleBuyerOffers = useMemo(
    () => buyerOffers.filter((o) => !dismissedBuyerOfferIds.has(o.id)),
    [buyerOffers, dismissedBuyerOfferIds]
  );

  const dismissBuyerOfferFromCartList = useCallback(
    (offerId: string) => {
      const memberId = member?.id;
      if (!memberId) return;
      setDismissedBuyerOfferIds((prev) => {
        if (prev.has(offerId)) return prev;
        const next = new Set(prev);
        next.add(offerId);
        void persistDismissedBuyerOfferIds(memberId, next);
        return next;
      });
    },
    [member?.id]
  );

  const load = useCallback(async (arg?: LoadCartArg): Promise<CartItem[] | null> => {
    const { refresh, silent } = parseLoadCartArg(arg);
    if (!silent) {
      setError("");
      if (refresh) setRefreshing(true);
      else setLoading(true);
    }
    try {
      const [cartData, meData, offersRaw] = await Promise.all([
        apiGet<CartItem[]>("/api/cart"),
        silent
          ? Promise.resolve(null)
          : apiGet<{ deliveryAddress?: { street?: string; city?: string; state?: string; zip?: string } | null }>(
              "/api/me"
            ).catch(() => null),
        apiGet<CartBuyerOfferRow[]>(`/api/resale-offers?role=buyer`).catch(() => []),
      ]);
      const list = Array.isArray(cartData) ? cartData : [];
      setItems(list);
      const offersList = Array.isArray(offersRaw) ? offersRaw : [];
      setBuyerOffers(sortBuyerOffersForCart(offersList));
      if (!silent && meData) {
        const addr = meData.deliveryAddress;
        if (addr && (addr.street ?? addr.city ?? addr.state ?? addr.zip)) {
          setShippingAddress((prev) => {
            const empty = !prev.street?.trim() && !prev.city?.trim() && !prev.state?.trim() && !prev.zip?.trim();
            if (!empty) return prev;
            return {
              street: addr.street ?? "",
              aptOrSuite: prev.aptOrSuite ?? "",
              city: addr.city ?? "",
              state: addr.state ?? "",
              zip: addr.zip ?? "",
            };
          });
        }
      }
      return list;
    } catch (e) {
      if (!silent) {
        const err = e as { status?: number };
        if (err.status === 401) {
          setItems([]);
          setBuyerOffers([]);
        } else {
          setError("Could not load cart");
          setItems([]);
          setBuyerOffers([]);
        }
      }
      return null;
    } finally {
      if (!silent) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!initialCartFocusLoadDoneRef.current) {
        initialCartFocusLoadDoneRef.current = true;
        void load();
      } else {
        void load({ silent: true });
      }
    }, [load])
  );

  // When checkout errors are shown, scroll so the banner and checkout button are visible.
  useEffect(() => {
    if (error && error.includes("Payment session expired")) {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }
  }, [error]);

  const removeItem = async (itemId: string) => {
    try {
      await apiDelete(`/api/cart/${itemId}`);
      setItems((prev) => prev.filter((i) => i.id !== itemId));
    } catch {
      setError("Could not remove item");
    }
  };

  const updateQuantity = async (itemId: string, quantity: number) => {
    if (quantity < 1) return;
    try {
      await apiPatch(`/api/cart/${itemId}`, { quantity });
      setItems((prev) =>
        prev.map((i) => (i.id === itemId ? { ...i, quantity } : i))
      );
    } catch {
      setError("Could not update quantity");
    }
  };

  const [localDeliveryModalItemId, setLocalDeliveryModalItemId] = useState<string | null>(null);
  const [pickupModalItemId, setPickupModalItemId] = useState<string | null>(null);

  const hasShippedItem = items.some((i) => (i.fulfillmentType ?? "ship") === "ship");
  const hasLocalDelivery = items.some((i) => i.fulfillmentType === "local_delivery");
  const hasPickup = items.some((i) => i.fulfillmentType === "pickup");
  const localDeliveryDetails = hasLocalDelivery
    ? items.find((i) => i.fulfillmentType === "local_delivery" && i.localDeliveryDetails)?.localDeliveryDetails
    : undefined;
  const pickupDetails = hasPickup
    ? items.find((i) => i.fulfillmentType === "pickup" && i.pickupDetails)?.pickupDetails
    : undefined;
  const itemForLocalDeliveryModal = localDeliveryModalItemId
    ? items.find((i) => i.id === localDeliveryModalItemId && i.fulfillmentType === "local_delivery")
    : undefined;
  const itemForPickupModal = pickupModalItemId
    ? items.find((i) => i.id === pickupModalItemId && i.fulfillmentType === "pickup")
    : undefined;

  const localDeliveryRowComplete = (i: CartItem): boolean => {
    const d = i.localDeliveryDetails;
    if (
      !d?.firstName?.trim() ||
      !d?.lastName?.trim() ||
      !d?.phone?.trim() ||
      !d?.email?.trim() ||
      !d?.deliveryAddress?.street?.trim() ||
      !d?.deliveryAddress?.city?.trim() ||
      !d?.deliveryAddress?.state?.trim() ||
      !d?.deliveryAddress?.zip?.trim() ||
      !d?.availableDropOffTimes?.trim()
    ) {
      return false;
    }
    if (storeItemHasLocalDeliveryPolicy(i.storeItem)) {
      return !!d.termsAcceptedAt?.trim();
    }
    return true;
  };

  const pickupRowComplete = (i: CartItem) =>
    !!(
      i.pickupDetails?.firstName?.trim() &&
      i.pickupDetails?.lastName?.trim() &&
      i.pickupDetails?.phone?.trim() &&
      i.pickupDetails?.preferredPickupDate?.trim() &&
      i.pickupDetails?.preferredPickupTime?.trim()
    );

  const openLocalDeliveryModalForItem = async (itemId: string) => {
    const list = await load(true);
    const fresh = list ?? [];
    if (fresh.some((i) => i.id === itemId && i.fulfillmentType === "local_delivery")) {
      setLocalDeliveryModalItemId(itemId);
    }
  };

  const openFirstIncompleteLocalDeliveryModal = async () => {
    const list = await load(true);
    const fresh = list ?? [];
    const target = fresh.find((i) => i.fulfillmentType === "local_delivery" && !localDeliveryRowComplete(i));
    if (target) setLocalDeliveryModalItemId(target.id);
  };

  const openPickupModalForItem = async (itemId: string) => {
    const list = await load(true);
    const fresh = list ?? [];
    if (fresh.some((i) => i.id === itemId && i.fulfillmentType === "pickup")) {
      setPickupModalItemId(itemId);
    }
  };

  const openFirstIncompletePickupModal = async () => {
    const list = await load(true);
    const fresh = list ?? [];
    const target = fresh.find((i) => i.fulfillmentType === "pickup" && !pickupRowComplete(i));
    if (target) setPickupModalItemId(target.id);
  };

  const needsShippingForm = hasShippedItem && (
    !shippingAddress.street?.trim() ||
    !shippingAddress.city?.trim() ||
    !shippingAddress.state?.trim() ||
    !shippingAddress.zip?.trim()
  );

  const localDeliveryItems = items.filter((i) => i.fulfillmentType === "local_delivery");
  const localDeliveryFormComplete =
    localDeliveryItems.length === 0 || localDeliveryItems.every((i) => localDeliveryRowComplete(i));
  const needsLocalDeliveryForm = hasLocalDelivery && !localDeliveryFormComplete;

  const pickupItems = items.filter((i) => i.fulfillmentType === "pickup");
  const pickupFormComplete =
    pickupItems.length === 0 ||
    pickupItems.every(
      (i) =>
        i.pickupDetails?.firstName?.trim() &&
        i.pickupDetails?.lastName?.trim() &&
        i.pickupDetails?.phone?.trim() &&
        i.pickupDetails?.preferredPickupDate?.trim() &&
        i.pickupDetails?.preferredPickupTime?.trim()
    );
  const needsPickupForm = hasPickup && !pickupFormComplete;

  const pickupItemsWithPolicy = pickupItems.filter(
    (i) =>
      (i.storeItem.pickupTerms ?? i.storeItem.member?.sellerPickupPolicy) &&
      String(i.storeItem.pickupTerms ?? i.storeItem.member?.sellerPickupPolicy).trim()
  );
  const allPickupTermsAgreed =
    pickupItemsWithPolicy.length === 0 ||
    pickupItemsWithPolicy.every((i) => i.pickupDetails?.termsAcceptedAt);

  const hasUnavailableItems = items.some((i) => (i as CartItem).unavailableReason);
  const canCheckout =
    !hasUnavailableItems &&
    !needsShippingForm &&
    !needsLocalDeliveryForm &&
    !needsPickupForm &&
    allPickupTermsAgreed;

  const checkoutBlockedHints: string[] = [];
  if (items.length > 0 && !canCheckout) {
    if (hasUnavailableItems) {
      checkoutBlockedHints.push("Remove or fix unavailable items before checkout.");
    }
    if (needsShippingForm) {
      checkoutBlockedHints.push("Enter your full shipping address.");
    }
    if (needsLocalDeliveryForm) {
      checkoutBlockedHints.push(
        "Local delivery: you usually only fill this once on the product page before adding to cart. If checkout still looks blocked, pull down to refresh. Otherwise tap a delivery item to add missing info, agree to any seller terms, or edit."
      );
    }
    if (needsPickupForm) {
      checkoutBlockedHints.push("Complete the pickup form (tap the link under each pickup item).");
    }
    if (!allPickupTermsAgreed && pickupItemsWithPolicy.length > 0) {
      checkoutBlockedHints.push("Open each pickup item’s form and agree to the seller’s pickup terms.");
    }
  }

  /** All items are charged through Stripe at checkout. */
  const cardItems = items;

  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);
  const merchandiseCents = items.reduce((sum, i) => sum + cartLineUnitPriceCents(i) * i.quantity, 0);
  const shippingCents = items.reduce((sum, i) => {
    if ((i.fulfillmentType ?? "ship") === "ship" && i.storeItem.shippingCostCents != null) {
      return sum + i.storeItem.shippingCostCents * i.quantity;
    }
    return sum;
  }, 0);
  const localDeliveryFeeCents = items.reduce((sum, i) => {
    if (i.fulfillmentType === "local_delivery" && i.storeItem.localDeliveryFeeCents != null) {
      return sum + i.storeItem.localDeliveryFeeCents * i.quantity;
    }
    return sum;
  }, 0);
  const estimatedTotalCents = merchandiseCents + shippingCents + localDeliveryFeeCents;

  /** Fulfill pending orders when Stripe redirects back (webhook safety net). */
  const finalizeCheckoutAfterPayment = useCallback(
    async (sessionId: string | null, fulfilledOrderIds: string[]): Promise<OrderSuccessItem[]> => {
      const params = new URLSearchParams();
      if (sessionId) params.set("session_id", sessionId);
      if (fulfilledOrderIds.length > 0) params.set("order_ids", fulfilledOrderIds.join(","));
      if (!sessionId && fulfilledOrderIds.length === 0) return [];

      try {
        const data = await apiGet<{ orderIds?: string[]; items?: unknown }>(
          `/api/store-orders/success-summary?${params.toString()}`
        );
        return mapSuccessSummaryItems(data.items);
      } catch (err) {
        console.warn("[cart] success-summary failed:", err);
        return [];
      }
    },
    []
  );

  const rememberPurchaseItems = useCallback((list: CartItem[]) => {
    pendingPurchaseItemsRef.current = snapshotPurchaseItemsFromCart(list);
  }, []);

  const completeCheckoutSuccess = useCallback(
    async (sessionId: string | null, fulfilledOrderIds: string[]) => {
      const apiItems = await finalizeCheckoutAfterPayment(sessionId, fulfilledOrderIds);
      if (apiItems.length > 0) {
        setConfirmedPurchaseItems(apiItems);
      }
      try {
        await apiDelete("/api/cart");
      } catch {
        /* ignore */
      }
      await load(true);
    },
    [finalizeCheckoutAfterPayment, load]
  );

  const openPurchasedItem = useCallback(
    (item?: OrderSuccessItem) => {
      setOrderJustConfirmed(false);
      const target = item ?? confirmedPurchaseItems[0];
      if (target?.slug) {
        router.push(
          buildProductPath(
            target.slug,
            target.orderId
              ? { type: "order", orderId: target.orderId, orderKind: "buyer" }
              : { type: "storefront" }
          ) as never
        );
        return;
      }
      router.push("/community/my-orders" as never);
    },
    [confirmedPurchaseItems, router]
  );

  const updateLocalDeliveryDetails = async (
    form: LocalDeliveryDetails,
    contextItemId?: string | null
  ) => {
    const targetId = contextItemId ?? localDeliveryModalItemId;
    if (!targetId) {
      Alert.alert("Could not save", "Missing cart item. Try again.");
      return;
    }
    const details: NonNullable<CartItem["localDeliveryDetails"]> = {
      firstName: form.firstName,
      lastName: form.lastName,
      phone: form.phone,
      email: form.email,
      deliveryAddress: form.deliveryAddress,
      availableDropOffTimes: form.availableDropOffTimes,
      note: form.note,
      termsAcceptedAt: form.termsAcceptedAt,
    };
    try {
      await apiPatch(`/api/cart/${targetId}`, {
        fulfillmentType: "local_delivery",
        localDeliveryDetails: details,
      });
      setItems((prev) =>
        prev.map((i) =>
          i.id === targetId
            ? { ...i, fulfillmentType: "local_delivery", localDeliveryDetails: details }
            : i
        )
      );
      setLocalDeliveryModalItemId(null);
      await load(true);
    } catch (e) {
      const err = e as { error?: string };
      Alert.alert(
        "Could not save delivery details",
        err.error ?? "Something went wrong. Check your connection and try again."
      );
    }
  };

  const updatePickupDetails = async (form: PickupDetails, contextItemId?: string | null) => {
    const targetId = contextItemId ?? pickupModalItemId;
    if (!targetId) {
      Alert.alert("Could not save", "Missing cart item. Try again.");
      return;
    }
    const details: NonNullable<CartItem["pickupDetails"]> = {
      firstName: form.firstName,
      lastName: form.lastName,
      phone: form.phone,
      email: form.email,
      preferredPickupDate: form.preferredPickupDate,
      preferredPickupTime: form.preferredPickupTime,
      note: form.note,
      termsAcceptedAt: form.termsAcceptedAt,
    };
    try {
      await apiPatch(`/api/cart/${targetId}`, {
        fulfillmentType: "pickup",
        pickupDetails: details,
      });
      setItems((prev) =>
        prev.map((i) =>
          i.id === targetId ? { ...i, fulfillmentType: "pickup", pickupDetails: details } : i
        )
      );
      setPickupModalItemId(null);
      await load(true);
    } catch (e) {
      const err = e as { error?: string };
      Alert.alert(
        "Could not save pickup details",
        err.error ?? "Something went wrong. Check your connection and try again."
      );
    }
  };

  const getNativeCheckoutPayload = useCallback(async (): Promise<StorefrontCheckoutPayload> => {
    const lines = items;
    const hasShippedInner = lines.some((i) => (i.fulfillmentType ?? "ship") === "ship");
    const hasLocalInner = lines.some((i) => i.fulfillmentType === "local_delivery");
    const ldForStripe = hasLocalInner
      ? lines.find((i) => i.fulfillmentType === "local_delivery" && i.localDeliveryDetails)?.localDeliveryDetails
      : undefined;
    const shippingCostCentsInner = lines.reduce((sum, i) => {
      if (i.fulfillmentType === "ship" && i.storeItem?.shippingCostCents != null) {
        return sum + i.storeItem.shippingCostCents * i.quantity;
      }
      return sum;
    }, 0);

    const out: StorefrontCheckoutPayload = {
      items: lines.map((i) => ({
        storeItemId: i.storeItemId,
        quantity: i.quantity,
        variant: i.variant ?? undefined,
        fulfillmentType: i.fulfillmentType ?? "ship",
      })),
      shippingCostCents: shippingCostCentsInner,
      returnBaseUrl: siteBase,
    };
    if (hasShippedInner) {
      out.shippingAddress = shippingAddress;
      if (shippingAddressFromPlaces) {
        out.shippingAddressVerifiedFromPlaces = true;
      }
    }
    if (hasLocalInner && ldForStripe) {
      out.localDeliveryDetails = ldForStripe;
    }
    return out;
  }, [items, shippingAddress, shippingAddressFromPlaces, siteBase]);

  const doCheckout = async () => {
    const token = await getToken();
    if (!token) {
      Alert.alert(
        "Sign in required",
        "Please sign in to checkout.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Sign in", onPress: () => router.push("/(tabs)/my-community") },
        ]
      );
      return;
    }

    if (items.length === 0) {
      Alert.alert("Cart is empty", "Add items to your cart before checkout.");
      return;
    }

    if (needsShippingForm || needsLocalDeliveryForm || needsPickupForm) {
      if (needsLocalDeliveryForm) void openFirstIncompleteLocalDeliveryModal();
      else if (needsPickupForm) void openFirstIncompletePickupModal();
      Alert.alert(
        "Complete details",
        needsLocalDeliveryForm
          ? "Please complete your local delivery details."
          : needsPickupForm
            ? "Please complete the pick up form."
            : "Please enter your shipping address.",
        [{ text: "OK" }]
      );
      return;
    }

    setCheckingOut(true);
    setError("");
    try {
      const makePayload = (list: CartItem[]) => {
        const shippingCostCentsInner = list.reduce((sum, i) => {
          if (i.fulfillmentType === "ship" && i.storeItem?.shippingCostCents != null) {
            return sum + i.storeItem.shippingCostCents * i.quantity;
          }
          return sum;
        }, 0);
        const ld =
          list.some((i) => i.fulfillmentType === "local_delivery") &&
          list.find((i) => i.fulfillmentType === "local_delivery" && i.localDeliveryDetails)?.localDeliveryDetails;
        const body: Record<string, unknown> = {
          items: list.map((i) => ({
            storeItemId: i.storeItemId,
            quantity: i.quantity,
            variant: i.variant ?? undefined,
            fulfillmentType: i.fulfillmentType ?? "ship",
          })),
          shippingCostCents: shippingCostCentsInner,
          returnBaseUrl: siteBase,
        };
        if (ld) body.localDeliveryDetails = ld;
        return body;
      };

      const linesForStripe = cardItems;

      let resolvedShippingAddress = shippingAddress;
      const hasShippedCardItem = linesForStripe.some((i) => (i.fulfillmentType ?? "ship") === "ship");
      if (hasShippedCardItem) {
        type ValidateRes = {
          valid?: boolean;
          formatted?: { street: string; city: string; state: string; zip: string };
          suggestedFormatted?: { street: string; city: string; state: string; zip: string };
          error?: string;
        };
        try {
          let validateData = await apiPost<ValidateRes>("/api/validate-address", {
            street: shippingAddress.street,
            city: shippingAddress.city,
            state: shippingAddress.state,
            zip: shippingAddress.zip,
            requireCarrierVerification: true,
          });
          if (!validateData.valid && validateData.suggestedFormatted) {
            validateData = await apiPost<ValidateRes>("/api/validate-address", {
              street: validateData.suggestedFormatted.street,
              city: validateData.suggestedFormatted.city,
              state: validateData.suggestedFormatted.state,
              zip: validateData.suggestedFormatted.zip,
              requireCarrierVerification: true,
            });
          }
          if (!validateData.valid) {
            setError(
              validateData.error ??
                "This address cannot be used for shipping. Please check street, city, state, and ZIP."
            );
            return;
          }
          resolvedShippingAddress = {
            ...validateData.formatted!,
            aptOrSuite: shippingAddress.aptOrSuite?.trim() ?? "",
          };
        } catch (validateErr: unknown) {
          const err = validateErr as { error?: string; status?: number };
          if (err.status === 503 && (err.error ?? "").toLowerCase().includes("temporarily unavailable")) {
            resolvedShippingAddress = {
              street: shippingAddress.street.trim(),
              aptOrSuite: shippingAddress.aptOrSuite?.trim() ?? "",
              city: shippingAddress.city.trim(),
              state: shippingAddress.state.trim(),
              zip: shippingAddress.zip.trim().replace(/\D/g, "").slice(0, 5),
            };
          } else {
            setError(err.error ?? "Address verification failed. Please try again.");
            return;
          }
        }
      }

      const stripeBody = makePayload(linesForStripe) as Record<string, unknown>;
      if (hasShippedCardItem) {
        stripeBody.shippingAddress = resolvedShippingAddress;
      }

      const data = await apiPost<{ url?: string; error?: string }>("/api/stripe/storefront-checkout", stripeBody);

      if (data.url) {
        rememberPurchaseItems(linesForStripe);
        setCheckoutUrl(data.url);
      } else {
        setError(data.error ?? "Checkout could not be started.");
      }
    } catch (e) {
      const err = e as { error?: string; status?: number };
      if (err.status === 401) {
        Alert.alert("Sign in required", "Please sign in to checkout.", [
          { text: "OK", onPress: () => router.push("/(tabs)/my-community") },
        ]);
      } else {
        setError(err.error ?? "Checkout failed");
      }
    } finally {
      setCheckingOut(false);
    }
  };

  const onCheckoutWebViewNav = (nav: { url: string }) => {
    if (nav.url.includes("order-success")) {
      const cartSnapshot =
        pendingPurchaseItemsRef.current.length > 0
          ? pendingPurchaseItemsRef.current
          : snapshotPurchaseItemsFromCart(items);
      setConfirmedPurchaseItems(cartSnapshot);
      setOrderJustConfirmed(true);
      setCheckoutUrl(null);
      const { orderIds: successOrderIds, sessionId: successSessionId } = parseOrderSuccessCheckoutParams(
        nav.url
      );
      void completeCheckoutSuccess(successSessionId, successOrderIds);
    }
    if (nav.url.includes("canceled=1")) {
      setCheckoutUrl(null);
    }
  };

  if (checkoutUrl) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <Pressable onPress={() => setCheckoutUrl(null)} style={styles.backBtn}>
            <Ionicons name="close" size={24} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Checkout</Text>
        </View>
        <WebView
          source={{ uri: checkoutUrl }}
          style={styles.webview}
          onNavigationStateChange={(nav) => onCheckoutWebViewNav(nav)}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <OrderSuccessOverlay
        visible={orderJustConfirmed}
        items={confirmedPurchaseItems}
        onViewItem={openPurchasedItem}
        onKeepShopping={() => {
          setOrderJustConfirmed(false);
          router.push("/(tabs)/store" as never);
        }}
      />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Cart</Text>
        {itemCount > 0 ? (
          <View style={styles.headerBadge}>
            <Text style={styles.headerBadgeText}>{itemCount}</Text>
          </View>
        ) : null}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.earth} />
        </View>
      ) : (
        <ScrollView
          ref={scrollViewRef}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              tintColor={theme.colors.earth}
              colors={[theme.colors.earth]}
            />
          }
        >
          {hasUnavailableItems ? (
            <View style={styles.warningBanner}>
              <Text style={styles.warningText}>
                Some items cannot be purchased (seller setup or quantity). Remove them or reduce quantity to checkout.
              </Text>
            </View>
          ) : null}
          {error ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{error}</Text>
              {error.includes("Payment session expired") ? (
                <Text style={styles.errorHint}>Tap the Checkout button below to start a new payment session.</Text>
              ) : (error.includes("sign in") || error.includes("Session expired")) ? (
                <Text style={styles.errorHint}>Sign in above, then return to your cart and tap Checkout.</Text>
              ) : null}
            </View>
          ) : null}

          {visibleBuyerOffers.length > 0 ? (
            <View style={styles.offersSection}>
              <Text style={styles.offersSectionTitle}>Your offers</Text>
              <Text style={styles.offersSectionHint}>
                Tap an offer for details. Swipe left to remove it from this list (your offer is unchanged).
              </Text>
              {visibleBuyerOffers.map((off) => {
                const photoUrl = resolvePhotoUrl(off.storeItem.photos?.[0]);
                const displayCents =
                  off.status === "countered" && typeof off.counterAmountCents === "number"
                    ? off.counterAmountCents
                    : off.status === "accepted" && typeof off.finalAmountCents === "number"
                      ? off.finalAmountCents
                      : off.amountCents;
                return (
                  <Swipeable
                    key={off.id}
                    renderRightActions={() => (
                      <View style={styles.offerSwipeRight}>
                        <Pressable
                          style={({ pressed }) => [
                            styles.offerSwipeDeleteBtn,
                            pressed && { opacity: 0.9 },
                          ]}
                          onPress={() => dismissBuyerOfferFromCartList(off.id)}
                          accessibilityRole="button"
                          accessibilityLabel="Remove offer from cart list"
                        >
                          <Ionicons name="trash-outline" size={22} color="#fff" />
                          <Text style={styles.offerSwipeDeleteLabel}>Remove</Text>
                        </Pressable>
                      </View>
                    )}
                  >
                    <Pressable
                      style={({ pressed }) => [styles.offerRow, pressed && { opacity: 0.85 }]}
                      onPress={() => router.push(`/offers/${off.id}` as never)}
                    >
                      {photoUrl ? (
                        <Image source={{ uri: photoUrl }} style={styles.offerRowImage} />
                      ) : (
                        <View style={[styles.offerRowImage, styles.offerRowImagePlaceholder]}>
                          <Ionicons name="pricetag-outline" size={22} color={theme.colors.primary} />
                        </View>
                      )}
                      <View style={styles.offerRowBody}>
                        <Text style={styles.offerRowTitle} numberOfLines={2}>
                          {off.storeItem.title}
                        </Text>
                        <Text style={styles.offerRowStatus}>{buyerOfferStatusLabel(off.status)}</Text>
                        <Text style={styles.offerRowAmount}>{formatPrice(displayCents)}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={20} color="#999" />
                    </Pressable>
                  </Swipeable>
                );
              })}
            </View>
          ) : null}

          {items.length === 0 ? (
            <View style={styles.empty}>
              <View style={styles.emptyIconWrap}>
                <Ionicons name="cart-outline" size={48} color={theme.colors.earth} />
              </View>
              <Text style={styles.emptyText}>Your cart is empty</Text>
              <Text style={styles.emptyHint}>Browse the store and add something you like.</Text>
              <Pressable
                style={styles.shopBtn}
                onPress={() => router.push("/(tabs)/store" as never)}
              >
                <Text style={styles.shopBtnText}>Continue shopping</Text>
              </Pressable>
            </View>
          ) : (
            <>
              {items.map((item) => {
                const photoUrl = cartLinePhotoUrl(item);
                const unitCents = cartLineUnitPriceCents(item);
                const lineCents = unitCents * item.quantity;
                const variantLabel = formatVariantLabel(item.variant);
                const fulfillment = fulfillmentMeta(item.fulfillmentType);
                const maxQty = cartLineMaxQuantity(item);
                return (
                  <View key={item.id} style={styles.itemCard}>
                    <Pressable
                      onPress={() =>
                        router.push(buildProductPath(item.storeItem.slug, { type: "cart" }) as never)
                      }
                      style={({ pressed }) => [styles.itemMain, pressed && { opacity: 0.88 }]}
                    >
                      {photoUrl ? (
                        <Image source={{ uri: photoUrl }} style={styles.itemImage} />
                      ) : (
                        <View style={[styles.itemImage, styles.itemImagePlaceholder]}>
                          <Ionicons name="image-outline" size={24} color={theme.colors.gold} />
                        </View>
                      )}
                      <View style={styles.itemBody}>
                        <Text style={styles.itemTitle} numberOfLines={2}>
                          {item.storeItem.title}
                        </Text>
                        {variantLabel ? (
                          <Text style={styles.itemVariant} numberOfLines={2}>
                            {variantLabel}
                          </Text>
                        ) : null}
                        <View style={styles.fulfillmentChip}>
                          <Ionicons name={fulfillment.icon} size={13} color={theme.colors.earth} />
                          <Text style={styles.fulfillmentChipText}>{fulfillment.label}</Text>
                        </View>
                        <Text style={styles.itemLineTotal}>{formatPrice(lineCents)}</Text>
                        {item.quantity > 1 ? (
                          <Text style={styles.itemUnitPrice}>
                            {formatPrice(unitCents)} each
                          </Text>
                        ) : null}
                        {item.resaleOfferId ? (
                          <Text style={styles.offerHint}>
                            Agreed offer (list {formatPrice(item.storeItem.priceCents)})
                          </Text>
                        ) : null}
                      </View>
                    </Pressable>
                    {item.fulfillmentType === "local_delivery" ? (
                      <Pressable
                        onPress={() => openLocalDeliveryModalForItem(item.id)}
                        style={({ pressed }) => [styles.itemDetailLinkWrap, pressed && { opacity: 0.7 }]}
                      >
                        <Text style={styles.itemDetailLink}>
                          {localDeliveryRowComplete(item)
                            ? "Edit delivery details"
                            : "Confirm or edit delivery details"}
                        </Text>
                      </Pressable>
                    ) : null}
                    {item.fulfillmentType === "pickup" ? (
                      <Pressable
                        onPress={() => openPickupModalForItem(item.id)}
                        style={({ pressed }) => [styles.itemDetailLinkWrap, pressed && { opacity: 0.7 }]}
                      >
                        <Text style={styles.itemDetailLink}>
                          {pickupRowComplete(item) ? "Edit pickup form" : "Complete pickup form"}
                        </Text>
                      </Pressable>
                    ) : null}
                    {item.unavailableReason ? (
                      <Text style={styles.unavailableReason}>{item.unavailableReason}</Text>
                    ) : null}
                    <View style={styles.itemActions}>
                      <View style={styles.qtyRow}>
                        <Pressable
                          style={[styles.qtyBtn, item.quantity <= 1 && styles.qtyBtnDisabled]}
                          onPress={() => updateQuantity(item.id, item.quantity - 1)}
                          disabled={item.quantity <= 1}
                        >
                          <Ionicons name="remove" size={16} color={theme.colors.earth} />
                        </Pressable>
                        <Text style={styles.qtyText}>{item.quantity}</Text>
                        <Pressable
                          style={[styles.qtyBtn, item.quantity >= maxQty && styles.qtyBtnDisabled]}
                          onPress={() =>
                            updateQuantity(item.id, Math.min(item.quantity + 1, maxQty))
                          }
                          disabled={item.quantity >= maxQty}
                        >
                          <Ionicons name="add" size={16} color={theme.colors.earth} />
                        </Pressable>
                      </View>
                      <Pressable
                        style={styles.removeBtn}
                        onPress={() =>
                          Alert.alert("Remove", "Remove from cart?", [
                            { text: "Cancel", style: "cancel" },
                            { text: "Remove", style: "destructive", onPress: () => removeItem(item.id) },
                          ])
                        }
                      >
                        <Ionicons name="trash-outline" size={18} color="#8a3a3a" />
                      </Pressable>
                    </View>
                  </View>
                );
              })}

              {hasShippedItem && (
                <View style={styles.shippingCard}>
                  <View style={styles.shippingHeader}>
                    <View style={styles.shippingIconWrap}>
                      <Ionicons name="location-outline" size={20} color={theme.colors.earth} />
                    </View>
                    <View style={styles.shippingHeaderText}>
                      <Text style={styles.formTitle}>Ship to</Text>
                      <Text style={styles.shippingHint}>
                        This is the address postage labels use when the seller ships your order.
                      </Text>
                    </View>
                  </View>
                  <AddressSearchInput
                    value={shippingAddress}
                    onChange={(addr, meta) => {
                      setShippingAddress({
                        street: addr.street ?? "",
                        aptOrSuite: addr.aptOrSuite ?? "",
                        city: addr.city ?? "",
                        state: addr.state ?? "",
                        zip: addr.zip ?? "",
                      });
                      if (meta?.fromPlaces !== undefined) setShippingAddressFromPlaces(meta.fromPlaces);
                    }}
                    placeholder="Search for your address"
                    showManualFallback={true}
                  />
                </View>
              )}

              {(needsLocalDeliveryForm || needsPickupForm) && (
                <View style={styles.formSection}>
                  {needsLocalDeliveryForm && (
                    <>
                      <Text style={styles.completeDetailsHint}>
                        If you already entered delivery on the product page, pull down to refresh—no need to fill the form again unless something is missing or you want to edit.
                      </Text>
                      <Pressable
                        style={({ pressed }) => [
                          styles.completeDetailsBtn,
                          pressed && { opacity: 0.8 },
                        ]}
                        onPress={() => openFirstIncompleteLocalDeliveryModal()}
                      >
                        <Text style={styles.completeDetailsBtnText}>
                          Open delivery form (first incomplete item)
                        </Text>
                      </Pressable>
                    </>
                  )}
                  {needsPickupForm && (
                    <Pressable
                      style={({ pressed }) => [
                        styles.completeDetailsBtn,
                        pressed && { opacity: 0.8 },
                      ]}
                      onPress={() => openFirstIncompletePickupModal()}
                    >
                      <Text style={styles.completeDetailsBtnText}>
                        Complete pickup form
                      </Text>
                    </Pressable>
                  )}
                </View>
              )}

              <View style={styles.summaryCard}>
                <Text style={styles.summaryTitle}>Order summary</Text>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Items</Text>
                  <Text style={styles.summaryValue}>{formatPrice(merchandiseCents)}</Text>
                </View>
                {shippingCents > 0 ? (
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Shipping</Text>
                    <Text style={styles.summaryValue}>{formatPrice(shippingCents)}</Text>
                  </View>
                ) : hasShippedItem ? (
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Shipping</Text>
                    <Text style={styles.summaryMuted}>Included or calculated at checkout</Text>
                  </View>
                ) : null}
                {localDeliveryFeeCents > 0 ? (
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Local delivery</Text>
                    <Text style={styles.summaryValue}>{formatPrice(localDeliveryFeeCents)}</Text>
                  </View>
                ) : null}
                <View style={styles.summaryDivider} />
                <View style={styles.summaryRow}>
                  <Text style={styles.totalLabel}>Estimated total</Text>
                  <Text style={styles.totalValue}>{formatPrice(estimatedTotalCents)}</Text>
                </View>
                <Text style={styles.taxHint}>Tax is calculated at checkout.</Text>
              </View>

              {checkoutBlockedHints.length > 0 ? (
                <View style={styles.checkoutHintBox}>
                  <Text style={styles.checkoutHintTitle}>Before you can check out</Text>
                  {checkoutBlockedHints.map((h) => (
                    <Text key={h} style={styles.checkoutHintLine}>
                      • {h}
                    </Text>
                  ))}
                </View>
              ) : null}
            </>
          )}
        </ScrollView>
      )}

      {!loading && items.length > 0 ? (
        <View style={[styles.checkoutBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={styles.checkoutBarTotals}>
            <Text style={styles.checkoutBarLabel}>Estimated total</Text>
            <Text style={styles.checkoutBarValue}>{formatPrice(estimatedTotalCents)}</Text>
          </View>
          {useNativeStorefrontCheckout ? (
            <StorefrontNativeCheckoutButton
              getPayload={getNativeCheckoutPayload}
              onShippingAddressFormatted={
                hasShippedItem
                  ? (addr) =>
                      setShippingAddress({
                        street: addr.street ?? "",
                        city: addr.city ?? "",
                        state: addr.state ?? "",
                        zip: addr.zip ?? "",
                        aptOrSuite: addr.aptOrSuite ?? "",
                      })
                  : undefined
              }
              onHostedCheckoutUrl={(url) => {
                rememberPurchaseItems(items);
                setCheckoutUrl(url);
              }}
              onError={setError}
              setCheckingOut={setCheckingOut}
              disabled={!canCheckout || checkingOut}
              buttonStyle={styles.checkoutBtn}
              buttonDisabledStyle={styles.checkoutBtnDisabled}
            />
          ) : (
            <Pressable
              style={[styles.checkoutBtn, (checkingOut || !canCheckout) && styles.checkoutBtnDisabled]}
              onPress={doCheckout}
              disabled={checkingOut || !canCheckout}
            >
              {checkingOut ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.checkoutBtnText}>Checkout</Text>
              )}
            </Pressable>
          )}
        </View>
      ) : null}

      {itemForLocalDeliveryModal && (
        <LocalDeliveryModal
          key={`ld-${localDeliveryModalItemId}`}
          visible={!!localDeliveryModalItemId}
          onClose={() => setLocalDeliveryModalItemId(null)}
          contextItemId={localDeliveryModalItemId}
          policyText={
            (itemForLocalDeliveryModal.storeItem as CartItemStoreItem).localDeliveryTerms?.trim()
              ? (itemForLocalDeliveryModal.storeItem as CartItemStoreItem).localDeliveryTerms ?? undefined
              : (itemForLocalDeliveryModal.storeItem as CartItemStoreItem).member?.sellerLocalDeliveryPolicy ??
                undefined
          }
          initialForm={
            itemForLocalDeliveryModal.localDeliveryDetails
              ? {
                  firstName: itemForLocalDeliveryModal.localDeliveryDetails.firstName ?? "",
                  lastName: itemForLocalDeliveryModal.localDeliveryDetails.lastName ?? "",
                  phone: itemForLocalDeliveryModal.localDeliveryDetails.phone ?? "",
                  email: itemForLocalDeliveryModal.localDeliveryDetails.email ?? "",
                  deliveryAddress: {
                    street: itemForLocalDeliveryModal.localDeliveryDetails.deliveryAddress?.street ?? "",
                    city: itemForLocalDeliveryModal.localDeliveryDetails.deliveryAddress?.city ?? "",
                    state: itemForLocalDeliveryModal.localDeliveryDetails.deliveryAddress?.state ?? "",
                    zip: itemForLocalDeliveryModal.localDeliveryDetails.deliveryAddress?.zip ?? "",
                  },
                  availableDropOffTimes:
                    itemForLocalDeliveryModal.localDeliveryDetails.availableDropOffTimes ?? "",
                  note: itemForLocalDeliveryModal.localDeliveryDetails.note ?? "",
                }
              : undefined
          }
          onSave={updateLocalDeliveryDetails}
        />
      )}
      {itemForPickupModal && (
        <PickupTermsModal
          key={`pu-${pickupModalItemId}`}
          visible={!!pickupModalItemId}
          onClose={() => setPickupModalItemId(null)}
          contextItemId={pickupModalItemId}
          policyText={
            (itemForPickupModal.storeItem as CartItemStoreItem).pickupTerms ??
            (itemForPickupModal.storeItem as CartItemStoreItem).member
              ?.sellerPickupPolicy ?? undefined
          }
          initialForm={
            itemForPickupModal.pickupDetails
              ? {
                  firstName: itemForPickupModal.pickupDetails.firstName ?? "",
                  lastName: itemForPickupModal.pickupDetails.lastName ?? "",
                  phone: itemForPickupModal.pickupDetails.phone ?? "",
                  email: itemForPickupModal.pickupDetails.email ?? "",
                  preferredPickupDate: itemForPickupModal.pickupDetails.preferredPickupDate ?? "",
                  preferredPickupTime: itemForPickupModal.pickupDetails.preferredPickupTime ?? "",
                  note: itemForPickupModal.pickupDetails.note ?? "",
                  termsAcceptedAt: itemForPickupModal.pickupDetails.termsAcceptedAt,
                }
              : undefined
          }
          onSave={updatePickupDetails}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.pageBackground,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.pageBackground,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 12,
    backgroundColor: theme.colors.primary,
    gap: 12,
  },
  backBtn: {
    padding: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "600",
    color: "#fff",
  },
  headerBadge: {
    minWidth: 28,
    height: 28,
    paddingHorizontal: 8,
    borderRadius: 14,
    backgroundColor: theme.colors.gold,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  headerBadgeText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 28,
  },
  errorBanner: {
    backgroundColor: "#fee",
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  errorText: {
    color: "#c00",
    fontSize: 14,
  },
  errorHint: {
    color: "#c00",
    fontSize: 13,
    marginTop: 6,
    opacity: 0.9,
  },
  warningBanner: {
    backgroundColor: "#fef3cd",
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  warningText: {
    color: "#856404",
    fontSize: 14,
  },
  offersSection: {
    marginBottom: 20,
  },
  offersSectionTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: theme.colors.heading,
    marginBottom: 6,
  },
  offersSectionHint: {
    fontSize: 13,
    color: theme.colors.text,
    marginBottom: 12,
    opacity: 0.85,
  },
  offerRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    marginBottom: 10,
    borderRadius: theme.radii.card,
    backgroundColor: theme.colors.surface,
    gap: 10,
    ...theme.shadows.card,
  },
  offerRowImage: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: theme.colors.cardImageWell,
  },
  offerRowImagePlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  offerRowBody: {
    flex: 1,
    minWidth: 0,
  },
  offerRowTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: theme.colors.heading,
  },
  offerRowStatus: {
    fontSize: 13,
    color: theme.colors.earth,
    marginTop: 2,
    fontWeight: "500",
  },
  offerRowAmount: {
    fontSize: 14,
    color: theme.colors.heading,
    marginTop: 4,
    fontWeight: "700",
  },
  offerSwipeRight: {
    justifyContent: "center",
    marginBottom: 10,
    borderRadius: theme.radii.card,
    overflow: "hidden",
  },
  offerSwipeDeleteBtn: {
    backgroundColor: "#b00020",
    justifyContent: "center",
    alignItems: "center",
    width: 88,
    flex: 1,
    paddingVertical: 12,
    gap: 4,
  },
  offerSwipeDeleteLabel: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  unavailableReason: {
    fontSize: 12,
    color: "#8a3a3a",
    marginTop: 8,
    paddingHorizontal: 12,
  },
  empty: {
    alignItems: "center",
    paddingVertical: 64,
    paddingHorizontal: 24,
  },
  emptyIconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: theme.colors.cream,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.colors.gold,
  },
  emptyText: {
    fontSize: 20,
    fontWeight: "700",
    color: theme.colors.heading,
    marginTop: 18,
  },
  emptyHint: {
    fontSize: 14,
    color: theme.colors.text,
    marginTop: 8,
    textAlign: "center",
    opacity: 0.85,
  },
  shopBtn: {
    marginTop: 20,
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: theme.colors.primary,
    borderRadius: theme.radii.button,
  },
  shopBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  itemCard: {
    marginBottom: 14,
    borderRadius: theme.radii.card,
    backgroundColor: theme.colors.surface,
    overflow: "hidden",
    ...theme.shadows.card,
  },
  itemMain: {
    flexDirection: "row",
    padding: 12,
    paddingBottom: 4,
  },
  itemImage: {
    width: 88,
    height: 88,
    borderRadius: 10,
    backgroundColor: theme.colors.cardImageWell,
  },
  itemImagePlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  itemBody: {
    flex: 1,
    marginLeft: 12,
  },
  itemTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: theme.colors.heading,
  },
  itemVariant: {
    fontSize: 13,
    color: theme.colors.earth,
    marginTop: 4,
    lineHeight: 18,
  },
  fulfillmentChip: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: theme.radii.chip,
    backgroundColor: theme.colors.cream,
  },
  fulfillmentChipText: {
    fontSize: 12,
    fontWeight: "600",
    color: theme.colors.earth,
  },
  itemLineTotal: {
    fontSize: 17,
    fontWeight: "700",
    color: theme.colors.heading,
    marginTop: 8,
  },
  itemUnitPrice: {
    fontSize: 12,
    color: theme.colors.text,
    marginTop: 2,
    opacity: 0.85,
  },
  offerHint: {
    fontSize: 12,
    color: theme.colors.text,
    marginTop: 4,
  },
  itemDetailLinkWrap: {
    paddingHorizontal: 12,
    paddingTop: 4,
  },
  itemDetailLink: {
    fontSize: 13,
    fontWeight: "600",
    color: theme.colors.earth,
    textDecorationLine: "underline",
  },
  paymentMethodRow: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#eee",
  },
  paymentMethodLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: theme.colors.heading,
    marginBottom: 8,
  },
  paymentMethodChoices: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  paymentChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#ddd",
    backgroundColor: "#fff",
  },
  paymentChipActive: {
    borderColor: theme.colors.primary,
    backgroundColor: "rgba(80, 85, 66, 0.08)",
  },
  paymentChipText: {
    fontSize: 12,
    color: "#666",
  },
  paymentChipTextActive: {
    color: theme.colors.primary,
    fontWeight: "600",
  },
  itemActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
    paddingHorizontal: 12,
    paddingBottom: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderMuted,
  },
  qtyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  qtyBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: theme.colors.earth,
    backgroundColor: theme.colors.cream,
    alignItems: "center",
    justifyContent: "center",
  },
  qtyBtnDisabled: {
    opacity: 0.4,
  },
  qtyText: {
    fontSize: 15,
    fontWeight: "700",
    color: theme.colors.heading,
    minWidth: 22,
    textAlign: "center",
  },
  removeBtn: {
    padding: 6,
  },
  completeDetailsHint: {
    fontSize: 13,
    color: theme.colors.text,
    lineHeight: 19,
    marginBottom: 10,
    opacity: 0.9,
  },
  completeDetailsBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: theme.radii.button,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    marginBottom: 12,
  },
  completeDetailsBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  formSection: {
    marginTop: 8,
    marginBottom: 16,
  },
  formTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: theme.colors.heading,
  },
  shippingCard: {
    marginTop: 8,
    marginBottom: 16,
    padding: 14,
    borderRadius: theme.radii.card,
    backgroundColor: theme.colors.surface,
    ...theme.shadows.card,
  },
  shippingHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 12,
  },
  shippingIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.cream,
    alignItems: "center",
    justifyContent: "center",
  },
  shippingHeaderText: {
    flex: 1,
  },
  shippingHint: {
    fontSize: 13,
    color: theme.colors.text,
    marginTop: 4,
    lineHeight: 18,
    opacity: 0.9,
  },
  summaryCard: {
    marginTop: 4,
    marginBottom: 16,
    padding: 16,
    borderRadius: theme.radii.card,
    backgroundColor: theme.colors.surface,
    ...theme.shadows.card,
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: theme.colors.heading,
    marginBottom: 12,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
    gap: 12,
  },
  summaryLabel: {
    fontSize: 14,
    color: theme.colors.text,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.heading,
  },
  summaryMuted: {
    fontSize: 13,
    color: theme.colors.text,
    opacity: 0.75,
    flexShrink: 1,
    textAlign: "right",
  },
  summaryDivider: {
    height: 1,
    backgroundColor: theme.colors.borderMuted,
    marginVertical: 8,
  },
  taxHint: {
    fontSize: 12,
    color: theme.colors.text,
    marginTop: 6,
    opacity: 0.75,
  },
  checkoutBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: theme.colors.surface,
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderMuted,
    ...theme.shadows.card,
  },
  checkoutBarTotals: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 10,
  },
  checkoutBarLabel: {
    fontSize: 14,
    color: theme.colors.text,
  },
  checkoutBarValue: {
    fontSize: 18,
    fontWeight: "700",
    color: theme.colors.heading,
  },
  input: {
    borderWidth: 2,
    borderColor: "#ddd",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: "#000",
    marginBottom: 8,
  },
  inputHalf: {
    flex: 1,
  },
  row2: {
    flexDirection: "row",
    gap: 8,
  },
  browserHint: {
    marginTop: 16,
    padding: 16,
    backgroundColor: theme.colors.creamAlt,
    borderRadius: 8,
  },
  browserHintText: {
    fontSize: 14,
    color: theme.colors.text,
    marginBottom: 12,
  },
  browserBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: theme.colors.primary,
    borderRadius: 8,
    alignSelf: "flex-start",
  },
  browserBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  checkoutHintBox: {
    backgroundColor: theme.colors.cream,
    borderWidth: 1,
    borderColor: theme.colors.gold,
    borderRadius: theme.radii.card,
    padding: 12,
    marginBottom: 8,
  },
  checkoutHintTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: theme.colors.heading,
    marginBottom: 8,
  },
  checkoutHintLine: {
    fontSize: 13,
    color: theme.colors.text,
    lineHeight: 20,
    marginBottom: 4,
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: "700",
    color: theme.colors.heading,
  },
  totalValue: {
    fontSize: 18,
    fontWeight: "700",
    color: theme.colors.earth,
  },
  checkoutBtn: {
    width: "100%",
    paddingVertical: 14,
    borderRadius: theme.radii.button,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
  },
  checkoutBtnDisabled: {
    opacity: 0.55,
  },
  checkoutBtnText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
  webview: {
    flex: 1,
  },
});
