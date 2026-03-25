import { useEffect, useState, useCallback, useRef } from "react";
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
  TextInput,
  Linking,
} from "react-native";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
import { PointsEarnedPopup } from "@/components/PointsEarnedPopup";
import { useAuth } from "@/contexts/AuthContext";

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
  shippingCostCents?: number | null;
  localDeliveryFeeCents?: number | null;
  localDeliveryAvailable?: boolean;
  inStorePickupAvailable?: boolean;
  shippingDisabled?: boolean;
  pickupTerms?: string | null;
  localDeliveryTerms?: string | null;
  member?: {
    acceptCashForPickupDelivery?: boolean;
    sellerLocalDeliveryPolicy?: string | null;
    sellerPickupPolicy?: string | null;
  };
}

interface CartItem {
  id: string;
  storeItemId: string;
  quantity: number;
  variant: unknown;
  /** From GET /api/cart — agreed resale offer unit price when applicable */
  unitPriceCents?: number;
  fulfillmentType?: string | null;
  localDeliveryDetails?: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    email?: string;
    deliveryAddress?: { street?: string; city?: string; state?: string; zip?: string };
    availableDropOffTimes?: string;
    note?: string;
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

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function cartLineUnitPriceCents(item: CartItem): number {
  return typeof item.unitPriceCents === "number" ? item.unitPriceCents : item.storeItem.priceCents;
}

function resolvePhotoUrl(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
}

export default function CartScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { member } = useAuth();
  const [items, setItems] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [error, setError] = useState("");
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [orderJustConfirmed, setOrderJustConfirmed] = useState(false);
  const [shippingAddress, setShippingAddress] = useState({
    street: "",
    aptOrSuite: "",
    city: "",
    state: "",
    zip: "",
  });
  const [shippingAddressFromPlaces, setShippingAddressFromPlaces] = useState(false);
  const [pointsPopup, setPointsPopup] = useState<{
    pointsAwarded: number;
    previousTotal: number;
    newTotal: number;
  } | null>(null);
  const [paymentMethodByItemId, setPaymentMethodByItemId] = useState<Record<string, "card" | "cash">>({});
  const mixedCashOrderIdsRef = useRef<string[]>([]);
  const scrollViewRef = useRef<ScrollView>(null);

  const load = useCallback(async (refresh = false): Promise<CartItem[] | null> => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const [cartData, meData] = await Promise.all([
        apiGet<CartItem[]>("/api/cart"),
        apiGet<{ deliveryAddress?: { street?: string; city?: string; state?: string; zip?: string } | null }>("/api/me").catch(() => null),
      ]);
      const list = Array.isArray(cartData) ? cartData : [];
      setItems(list);
      const addr = meData?.deliveryAddress;
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
      return list;
    } catch (e) {
      const err = e as { status?: number };
      if (err.status === 401) {
        setItems([]);
      } else {
        setError("Could not load cart");
        setItems([]);
      }
      return null;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // When checkout errors are shown, scroll so the banner and checkout button are visible.
  useEffect(() => {
    if (
      error &&
      (error.includes("Payment session expired") ||
        error.includes("Pay in Cash") ||
        error.toLowerCase().includes("cash checkout"))
    ) {
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

  const localDeliveryRowComplete = (i: CartItem) =>
    !!(
      i.localDeliveryDetails?.firstName?.trim() &&
      i.localDeliveryDetails?.lastName?.trim() &&
      i.localDeliveryDetails?.phone?.trim() &&
      i.localDeliveryDetails?.email?.trim() &&
      i.localDeliveryDetails?.deliveryAddress?.street?.trim() &&
      i.localDeliveryDetails?.deliveryAddress?.city?.trim() &&
      i.localDeliveryDetails?.deliveryAddress?.state?.trim() &&
      i.localDeliveryDetails?.deliveryAddress?.zip?.trim() &&
      i.localDeliveryDetails?.availableDropOffTimes?.trim()
    );

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
    localDeliveryItems.length === 0 ||
    localDeliveryItems.every(
      (i) =>
        i.localDeliveryDetails?.firstName?.trim() &&
        i.localDeliveryDetails?.lastName?.trim() &&
        i.localDeliveryDetails?.phone?.trim() &&
        i.localDeliveryDetails?.email?.trim() &&
        i.localDeliveryDetails?.deliveryAddress?.street?.trim() &&
        i.localDeliveryDetails?.deliveryAddress?.city?.trim() &&
        i.localDeliveryDetails?.deliveryAddress?.state?.trim() &&
        i.localDeliveryDetails?.deliveryAddress?.zip?.trim() &&
        i.localDeliveryDetails?.availableDropOffTimes?.trim()
    );
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
      checkoutBlockedHints.push("Complete local delivery details (tap the link under each delivery item).");
    }
    if (needsPickupForm) {
      checkoutBlockedHints.push("Complete the pickup form (tap the link under each pickup item).");
    }
    if (!allPickupTermsAgreed && pickupItemsWithPolicy.length > 0) {
      checkoutBlockedHints.push("Open each pickup item’s form and agree to the seller’s pickup terms.");
    }
  }

  const allPickupOrLocalDelivery =
    items.length > 0 &&
    items.every((i) => i.fulfillmentType === "pickup" || i.fulfillmentType === "local_delivery");
  const allSellersAcceptCash =
    items.length > 0 && items.every((i) => i.storeItem.member?.acceptCashForPickupDelivery !== false);
  const showPayInCash = allPickupOrLocalDelivery && allSellersAcceptCash;
  const cashItems = showPayInCash
    ? items.filter(
        (i) =>
          (i.fulfillmentType === "pickup" || i.fulfillmentType === "local_delivery") &&
          (paymentMethodByItemId[i.id] ?? "card") === "cash" &&
          i.storeItem.member?.acceptCashForPickupDelivery !== false
      )
    : [];
  const cardItems = items.filter((i) => !cashItems.some((c) => c.id === i.id));

  /** Same post-checkout flow as native Stripe success (no WebView). */
  const finalizeCashCheckoutSuccess = useCallback(
    async (orderIds: string[]) => {
      if (!orderIds.length) return;
      try {
        await apiDelete("/api/cart");
      } catch {
        /* ignore; load() refreshes */
      }
      await load(true);
      setOrderJustConfirmed(true);
      const orderIdsQuery = orderIds.join(",");
      try {
        const [summaryRes, meRes] = await Promise.all([
          apiGet<{ pointsAwarded?: number }>(
            `/api/store-orders/success-summary?order_ids=${encodeURIComponent(orderIdsQuery)}`
          ),
          apiGet<{ points?: number }>("/api/me"),
        ]);
        const pointsAwarded = summaryRes?.pointsAwarded ?? 0;
        const newTotal = typeof meRes?.points === "number" ? meRes.points : 0;
        if (pointsAwarded > 0 && newTotal >= pointsAwarded) {
          setPointsPopup({
            pointsAwarded,
            previousTotal: newTotal - pointsAwarded,
            newTotal,
          });
          return;
        }
      } catch {
        /* ignore; fall through */
      }
      router.back();
    },
    [load, router]
  );

  const updateLocalDeliveryDetails = async (form: LocalDeliveryDetails) => {
    const targetId = localDeliveryModalItemId;
    if (!targetId) return;
    const details = {
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
      setLocalDeliveryModalItemId(null);
      load(true);
    } catch (e) {
      const err = e as { error?: string };
      Alert.alert(
        "Could not save delivery details",
        err.error ?? "Something went wrong. Check your connection and try again."
      );
    }
  };

  const updatePickupDetails = async (form: PickupDetails) => {
    const targetId = pickupModalItemId;
    if (!targetId) return;
    const details = {
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
      setPickupModalItemId(null);
      load(true);
    } catch (e) {
      const err = e as { error?: string };
      Alert.alert(
        "Could not save pickup details",
        err.error ?? "Something went wrong. Check your connection and try again."
      );
    }
  };

  const getNativeCheckoutPayload = useCallback(async (): Promise<StorefrontCheckoutPayload> => {
    mixedCashOrderIdsRef.current = [];
    let lines = items;
    if (cashItems.length > 0) {
      const ldSource = hasLocalDelivery
        ? items.find((i) => i.fulfillmentType === "local_delivery" && i.localDeliveryDetails)?.localDeliveryDetails
        : undefined;
      const body: Record<string, unknown> = {
        items: cashItems.map((i) => ({
          storeItemId: i.storeItemId,
          quantity: i.quantity,
          variant: i.variant ?? undefined,
          fulfillmentType: i.fulfillmentType ?? "ship",
        })),
      };
      if (hasLocalDelivery && ldSource) {
        body.localDeliveryDetails = ldSource;
      }
      const data = await apiPost<{ orderIds?: string[] }>("/api/store-orders/cash-checkout", body);
      mixedCashOrderIdsRef.current = data.orderIds ?? [];
      // Server cash-checkout already removes matching cart rows; refetch only.
      const refreshed = await apiGet<CartItem[]>("/api/cart").catch(() => []);
      lines = Array.isArray(refreshed) ? refreshed : [];
      setItems(lines);
    }

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
    if (mixedCashOrderIdsRef.current.length > 0) {
      out.cashOrderIds = [...mixedCashOrderIdsRef.current];
    }
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
  }, [items, cashItems, hasLocalDelivery, shippingAddress, shippingAddressFromPlaces, siteBase]);

  const handleCashOnlyCheckout = async () => {
    const token = await getToken();
    if (!token) {
      Alert.alert("Sign in required", "Please sign in to checkout.", [
        { text: "Cancel", style: "cancel" },
        { text: "Sign in", onPress: () => router.push("/(tabs)/my-community") },
      ]);
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

    const ldSource = hasLocalDelivery
      ? items.find((i) => i.fulfillmentType === "local_delivery" && i.localDeliveryDetails)?.localDeliveryDetails
      : undefined;
    const body: Record<string, unknown> = {
      items: cashItems.map((i) => ({
        storeItemId: i.storeItemId,
        quantity: i.quantity,
        variant: i.variant ?? undefined,
        fulfillmentType: i.fulfillmentType ?? "ship",
      })),
    };
    if (hasLocalDelivery && ldSource) {
      body.localDeliveryDetails = ldSource;
    }

    setCheckingOut(true);
    setError("");
    try {
      const data = await apiPost<{ url?: string; orderIds?: string[]; error?: string }>(
        "/api/store-orders/cash-checkout",
        body
      );
      if (data.orderIds?.length) {
        await finalizeCashCheckoutSuccess(data.orderIds);
      } else if (data.url) {
        setCheckoutUrl(data.url);
      } else {
        const msg = data.error ?? "Checkout failed";
        setError(msg);
        Alert.alert("Could not complete order (Pay in Cash)", msg);
      }
    } catch (e) {
      const err = e as { error?: string; status?: number };
      if (err.status === 401) {
        Alert.alert("Sign in required", "Please sign in to checkout.", [
          { text: "OK", onPress: () => router.push("/(tabs)/my-community") },
        ]);
      } else {
        const msg = err.error ?? "Checkout failed";
        setError(msg);
        Alert.alert("Could not complete order (Pay in Cash)", msg);
      }
    } finally {
      setCheckingOut(false);
    }
  };

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

      const ldForCash = hasLocalDelivery
        ? items.find((i) => i.fulfillmentType === "local_delivery" && i.localDeliveryDetails)?.localDeliveryDetails
        : undefined;
      const makeCashBody = (list: CartItem[]) => {
        const body: Record<string, unknown> = {
          items: list.map((i) => ({
            storeItemId: i.storeItemId,
            quantity: i.quantity,
            variant: i.variant ?? undefined,
            fulfillmentType: i.fulfillmentType ?? "ship",
          })),
        };
        if (hasLocalDelivery && ldForCash) {
          body.localDeliveryDetails = ldForCash;
        }
        return body;
      };

      if (cardItems.length === 0 && cashItems.length > 0) {
        const data = await apiPost<{ url?: string; orderIds?: string[]; error?: string }>(
          "/api/store-orders/cash-checkout",
          makeCashBody(cashItems)
        );
        if (data.orderIds?.length) {
          await finalizeCashCheckoutSuccess(data.orderIds);
        } else if (data.url) {
          setCheckoutUrl(data.url);
        } else {
          const msg = data.error ?? "Checkout failed";
          setError(msg);
          Alert.alert("Could not complete order (Pay in Cash)", msg);
        }
        return;
      }

      let cashOrderIds: string[] | undefined;
      if (cashItems.length > 0) {
        const cashRes = await apiPost<{ orderIds?: string[]; error?: string }>(
          "/api/store-orders/cash-checkout",
          makeCashBody(cashItems)
        );
        if (cashRes.error || !cashRes.orderIds?.length) {
          const msg = cashRes.error ?? "Cash checkout failed";
          setError(msg);
          Alert.alert("Could not complete order (Pay in Cash)", msg);
          return;
        }
        cashOrderIds = cashRes.orderIds;
        // Cart lines for cash items are cleared on the server by cash-checkout.
      }

      if (cardItems.length === 0) {
        return;
      }

      let linesForStripe = cardItems;
      if (cashItems.length > 0) {
        const refreshed = await apiGet<CartItem[]>("/api/cart").catch(() => []);
        linesForStripe = Array.isArray(refreshed) ? refreshed : [];
        setItems(linesForStripe);
      }

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
      if (cashOrderIds?.length) {
        stripeBody.cashOrderIds = cashOrderIds;
      }
      if (hasShippedCardItem) {
        stripeBody.shippingAddress = resolvedShippingAddress;
      }

      const data = await apiPost<{ url?: string; error?: string }>("/api/stripe/storefront-checkout", stripeBody);

      if (data.url) {
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
      setCheckoutUrl(null);
      load();
      setOrderJustConfirmed(true);
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
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Cart</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : (
        <ScrollView
          ref={scrollViewRef}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />
          }
        >
          {orderJustConfirmed ? (
            <View style={styles.orderConfirmedCard}>
              <Ionicons name="checkmark-circle" size={48} color={theme.colors.primary} style={{ marginBottom: 8 }} />
              <Text style={styles.orderConfirmedTitle}>Order confirmed!</Text>
              <Text style={styles.orderConfirmedSubtext}>Sellers will ship or contact you to arrange pickup or delivery.</Text>
              <View style={styles.orderConfirmedActions}>
                <Pressable
                  style={[styles.orderConfirmedBtn, styles.orderConfirmedBtnPrimary]}
                  onPress={() => {
                    setOrderJustConfirmed(false);
                    router.push("/community/my-orders" as never);
                  }}
                >
                  <Text style={styles.orderConfirmedBtnPrimaryText}>View my orders</Text>
                </Pressable>
                <Pressable
                  style={[styles.orderConfirmedBtn, styles.orderConfirmedBtnSecondary]}
                  onPress={() => {
                    setOrderJustConfirmed(false);
                    router.back();
                  }}
                >
                  <Text style={styles.orderConfirmedBtnSecondaryText}>Continue shopping</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
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

          {items.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="cart-outline" size={64} color={theme.colors.primary} />
              <Text style={styles.emptyText}>Your cart is empty</Text>
              <Pressable
                style={styles.shopBtn}
                onPress={() => router.back()}
              >
                <Text style={styles.shopBtnText}>Continue shopping</Text>
              </Pressable>
            </View>
          ) : (
            <>
              {items.map((item) => {
                const photoUrl = resolvePhotoUrl(item.storeItem.photos?.[0]);
                const fulfillmentLabel =
                  item.fulfillmentType === "local_delivery"
                    ? "Local delivery"
                    : item.fulfillmentType === "pickup"
                      ? "Pickup"
                      : "Ship";
                return (
                  <View key={item.id} style={styles.itemCard}>
                    {photoUrl ? (
                      <Image source={{ uri: photoUrl }} style={styles.itemImage} />
                    ) : (
                      <View style={[styles.itemImage, styles.itemImagePlaceholder]}>
                        <Ionicons name="image-outline" size={24} color={theme.colors.primary} />
                      </View>
                    )}
                    <View style={styles.itemBody}>
                      <Text style={styles.itemTitle} numberOfLines={2}>
                        {item.storeItem.title}
                      </Text>
                      <Text style={styles.itemPrice}>
                        {formatPrice(cartLineUnitPriceCents(item))} x {item.quantity}
                      </Text>
                      {cartLineUnitPriceCents(item) !== item.storeItem.priceCents ? (
                        <Text style={styles.offerHint}>
                          Agreed offer (list {formatPrice(item.storeItem.priceCents)})
                        </Text>
                      ) : null}
                      <Text style={styles.itemFulfillment}>{fulfillmentLabel}</Text>
                      {item.fulfillmentType === "local_delivery" ? (
                        <Pressable
                          onPress={() => openLocalDeliveryModalForItem(item.id)}
                          style={({ pressed }) => [pressed && { opacity: 0.7 }]}
                        >
                          <Text style={styles.itemDetailLink}>
                            {localDeliveryRowComplete(item)
                              ? "Edit delivery details"
                              : "Add delivery details"}
                          </Text>
                        </Pressable>
                      ) : null}
                      {item.fulfillmentType === "pickup" ? (
                        <Pressable
                          onPress={() => openPickupModalForItem(item.id)}
                          style={({ pressed }) => [pressed && { opacity: 0.7 }]}
                        >
                          <Text style={styles.itemDetailLink}>
                            {pickupRowComplete(item) ? "Edit pickup form" : "Complete pickup form"}
                          </Text>
                        </Pressable>
                      ) : null}
                      {(item as CartItem).unavailableReason ? (
                        <Text style={styles.unavailableReason}>{(item as CartItem).unavailableReason}</Text>
                      ) : null}
                      {showPayInCash &&
                      (item.fulfillmentType === "pickup" || item.fulfillmentType === "local_delivery") &&
                      item.storeItem.member?.acceptCashForPickupDelivery !== false ? (
                        <View style={styles.paymentMethodRow}>
                          <Text style={styles.paymentMethodLabel}>Payment for this item</Text>
                          <View style={styles.paymentMethodChoices}>
                            <Pressable
                              style={[
                                styles.paymentChip,
                                (paymentMethodByItemId[item.id] ?? "card") === "card" && styles.paymentChipActive,
                              ]}
                              onPress={() =>
                                setPaymentMethodByItemId((p) => ({ ...p, [item.id]: "card" }))
                              }
                            >
                              <Text
                                style={[
                                  styles.paymentChipText,
                                  (paymentMethodByItemId[item.id] ?? "card") === "card" &&
                                    styles.paymentChipTextActive,
                                ]}
                              >
                                Card (charged now)
                              </Text>
                            </Pressable>
                            <Pressable
                              style={[
                                styles.paymentChip,
                                (paymentMethodByItemId[item.id] ?? "card") === "cash" && styles.paymentChipActive,
                              ]}
                              onPress={() =>
                                setPaymentMethodByItemId((p) => ({ ...p, [item.id]: "cash" }))
                              }
                            >
                              <Text
                                style={[
                                  styles.paymentChipText,
                                  (paymentMethodByItemId[item.id] ?? "card") === "cash" &&
                                    styles.paymentChipTextActive,
                                ]}
                              >
                                Pay in Cash
                              </Text>
                            </Pressable>
                          </View>
                        </View>
                      ) : null}
                      <View style={styles.itemActions}>
                        <View style={styles.qtyRow}>
                          <Pressable
                            style={styles.qtyBtn}
                            onPress={() => updateQuantity(item.id, item.quantity - 1)}
                            disabled={item.quantity <= 1}
                          >
                            <Ionicons name="remove" size={16} color={theme.colors.primary} />
                          </Pressable>
                          <Text style={styles.qtyText}>{item.quantity}</Text>
                          <Pressable
                            style={styles.qtyBtn}
                            onPress={() =>
                              updateQuantity(item.id, Math.min(item.quantity + 1, item.storeItem.quantity))
                            }
                            disabled={item.quantity >= item.storeItem.quantity}
                          >
                            <Ionicons name="add" size={16} color={theme.colors.primary} />
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
                          <Ionicons name="trash-outline" size={18} color="#c00" />
                        </Pressable>
                      </View>
                    </View>
                  </View>
                );
              })}

              {hasShippedItem && (
                <View style={styles.formSection}>
                  <Text style={styles.formTitle}>Shipping address</Text>
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
                    showManualFallback={false}
                  />
                </View>
              )}

              {(needsLocalDeliveryForm || needsPickupForm) && (
                <View style={styles.formSection}>
                  {needsLocalDeliveryForm && (
                    <Pressable
                      style={({ pressed }) => [
                        styles.completeDetailsBtn,
                        pressed && { opacity: 0.8 },
                      ]}
                      onPress={() => openFirstIncompleteLocalDeliveryModal()}
                    >
                      <Text style={styles.completeDetailsBtnText}>
                        Complete delivery details
                      </Text>
                    </Pressable>
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

              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Subtotal</Text>
                <Text style={styles.totalValue}>
                  {formatPrice(items.reduce((s, i) => s + cartLineUnitPriceCents(i) * i.quantity, 0))}
                </Text>
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

              {useNativeStorefrontCheckout ? (
                showPayInCash && cashItems.length > 0 && cardItems.length === 0 ? (
                  <Pressable
                    style={[styles.checkoutBtn, (checkingOut || !canCheckout) && styles.checkoutBtnDisabled]}
                    onPress={handleCashOnlyCheckout}
                    disabled={checkingOut || !canCheckout}
                  >
                    {checkingOut ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.checkoutBtnText}>Complete order (Pay in Cash)</Text>
                    )}
                  </Pressable>
                ) : (
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
                    onSuccess={async (orderIds) => {
                      const preorder = [...mixedCashOrderIdsRef.current];
                      mixedCashOrderIdsRef.current = [];
                      const merged = [...new Set([...preorder, ...(orderIds ?? [])])];
                      try {
                        await apiDelete("/api/cart");
                      } catch {
                        // ignore; load() will still refresh
                      }
                      await load();
                      if (merged.length > 0) {
                        try {
                          const orderIdsQuery = merged.join(",");
                          const [summaryRes, meRes] = await Promise.all([
                            apiGet<{ pointsAwarded?: number }>(
                              `/api/store-orders/success-summary?order_ids=${encodeURIComponent(orderIdsQuery)}`
                            ),
                            apiGet<{ points?: number }>("/api/me"),
                          ]);
                          const pointsAwarded = summaryRes?.pointsAwarded ?? 0;
                          const newTotal = typeof meRes?.points === "number" ? meRes.points : 0;
                          if (pointsAwarded > 0 && newTotal >= pointsAwarded) {
                            setPointsPopup({
                              pointsAwarded,
                              previousTotal: newTotal - pointsAwarded,
                              newTotal,
                            });
                            return;
                          }
                        } catch {
                          // ignore; fall through to router.back()
                        }
                      }
                      router.back();
                    }}
                    onError={setError}
                    setCheckingOut={setCheckingOut}
                    disabled={!canCheckout || checkingOut}
                    buttonStyle={styles.checkoutBtn}
                    buttonDisabledStyle={styles.checkoutBtnDisabled}
                  />
                )
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
            </>
          )}
        </ScrollView>
      )}

      {itemForLocalDeliveryModal && (
        <LocalDeliveryModal
          key={`ld-${localDeliveryModalItemId}`}
          visible={!!localDeliveryModalItemId}
          onClose={() => setLocalDeliveryModalItemId(null)}
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
      {pointsPopup && (
        <PointsEarnedPopup
          visible={true}
          onClose={() => {
            setPointsPopup(null);
            router.back();
          }}
          businessName="Your purchase"
          pointsAwarded={pointsPopup.pointsAwarded}
          previousTotal={pointsPopup.previousTotal}
          newTotal={pointsPopup.newTotal}
          category="store"
          message="Thanks for supporting local! You earned points on this purchase."
          buttonText="Awesome!"
          applyDoubleMultiplierAnimation={member?.hasPaidSubscription === true}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
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
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 48,
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
  unavailableReason: {
    fontSize: 12,
    color: "#c00",
    marginTop: 4,
  },
  empty: {
    alignItems: "center",
    paddingVertical: 48,
  },
  emptyText: {
    fontSize: 18,
    color: theme.colors.text,
    marginTop: 16,
  },
  shopBtn: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: theme.colors.primary,
    borderRadius: 8,
  },
  shopBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  itemCard: {
    flexDirection: "row",
    padding: 12,
    marginBottom: 12,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#eee",
    backgroundColor: "#fff",
  },
  itemImage: {
    width: 80,
    height: 80,
    borderRadius: 8,
    backgroundColor: "#f5f5f5",
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
    fontSize: 15,
    fontWeight: "600",
    color: theme.colors.heading,
  },
  itemPrice: {
    fontSize: 14,
    color: theme.colors.primary,
    marginTop: 4,
  },
  offerHint: {
    fontSize: 12,
    color: "#666",
    marginTop: 2,
  },
  itemFulfillment: {
    fontSize: 12,
    color: "#666",
    marginTop: 2,
  },
  itemDetailLink: {
    fontSize: 13,
    fontWeight: "600",
    color: theme.colors.primary,
    marginTop: 6,
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
  },
  qtyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  qtyBtn: {
    width: 32,
    height: 32,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  qtyText: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.heading,
    minWidth: 20,
    textAlign: "center",
  },
  removeBtn: {
    padding: 4,
  },
  completeDetailsBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
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
    marginTop: 16,
    marginBottom: 16,
  },
  formTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.heading,
    marginBottom: 10,
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
    backgroundColor: "#f9f6f0",
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
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
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 16,
    marginBottom: 16,
  },
  totalLabel: {
    fontSize: 18,
    fontWeight: "600",
    color: theme.colors.heading,
  },
  totalValue: {
    fontSize: 18,
    fontWeight: "700",
    color: theme.colors.primary,
  },
  checkoutBtn: {
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
    borderWidth: 2,
    borderColor: "#000",
    alignItems: "center",
  },
  checkoutBtnDisabled: {
    opacity: 0.6,
  },
  checkoutBtnText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
  webview: {
    flex: 1,
  },
  orderConfirmedCard: {
    marginHorizontal: 16,
    marginBottom: 24,
    padding: 24,
    backgroundColor: "#f0fdf4",
    borderRadius: 12,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    alignItems: "center",
  },
  orderConfirmedTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: theme.colors.heading,
    marginBottom: 4,
  },
  orderConfirmedSubtext: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    marginBottom: 16,
  },
  orderConfirmedActions: {
    flexDirection: "row",
    gap: 12,
    flexWrap: "wrap",
    justifyContent: "center",
  },
  orderConfirmedBtn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    minWidth: 140,
    alignItems: "center",
  },
  orderConfirmedBtnPrimary: {
    backgroundColor: theme.colors.primary,
    borderWidth: 2,
    borderColor: "#000",
  },
  orderConfirmedBtnPrimaryText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  orderConfirmedBtnSecondary: {
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: "#ddd",
  },
  orderConfirmedBtnSecondaryText: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: "600",
  },
});
