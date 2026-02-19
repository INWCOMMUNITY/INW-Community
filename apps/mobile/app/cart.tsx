import { useEffect, useState, useCallback } from "react";
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
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { WebView } from "react-native-webview";
import { theme } from "@/lib/theme";
import { apiGet, apiPost, apiPatch, apiDelete, getToken } from "@/lib/api";
import {
  LocalDeliveryModal,
  type LocalDeliveryDetails,
} from "@/components/LocalDeliveryModal";
import {
  PickupTermsModal,
  type PickupDetails,
} from "@/components/PickupTermsModal";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

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
  fulfillmentType?: string | null;
  localDeliveryDetails?: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    deliveryAddress?: { street?: string; city?: string; state?: string; zip?: string };
  } | null;
  pickupDetails?: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    email?: string;
    preferredPickupTime?: string;
    note?: string;
  } | null;
  storeItem: CartItemStoreItem;
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function resolvePhotoUrl(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
}

export default function CartScreen() {
  const router = useRouter();
  const [items, setItems] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [error, setError] = useState("");
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [shippingAddress, setShippingAddress] = useState({
    street: "",
    aptOrSuite: "",
    city: "",
    state: "",
    zip: "",
  });

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const data = await apiGet<CartItem[]>("/api/cart");
      setItems(Array.isArray(data) ? data : []);
    } catch (e) {
      const err = e as { status?: number };
      if (err.status === 401) {
        setItems([]);
      } else {
        setError("Could not load cart");
        setItems([]);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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

  const [localDeliveryModalOpen, setLocalDeliveryModalOpen] = useState(false);
  const [pickupModalOpen, setPickupModalOpen] = useState(false);

  const hasShippedItem = items.some((i) => (i.fulfillmentType ?? "ship") === "ship");
  const hasLocalDelivery = items.some((i) => i.fulfillmentType === "local_delivery");
  const hasPickup = items.some((i) => i.fulfillmentType === "pickup");
  const localDeliveryDetails = hasLocalDelivery
    ? items.find((i) => i.fulfillmentType === "local_delivery" && i.localDeliveryDetails)?.localDeliveryDetails
    : undefined;
  const pickupDetails = hasPickup
    ? items.find((i) => i.fulfillmentType === "pickup" && i.pickupDetails)?.pickupDetails
    : undefined;
  const itemForLocalDeliveryModal = items.find(
    (i) => i.fulfillmentType === "local_delivery"
  );
  const itemForPickupModal = items.find((i) => i.fulfillmentType === "pickup");

  const needsShippingForm = hasShippedItem && (
    !shippingAddress.street?.trim() ||
    !shippingAddress.city?.trim() ||
    !shippingAddress.state?.trim() ||
    !shippingAddress.zip?.trim()
  );

  const needsLocalDeliveryForm =
    hasLocalDelivery &&
    !localDeliveryDetails?.firstName?.trim() &&
    !localDeliveryDetails?.lastName?.trim() &&
    !localDeliveryDetails?.phone?.trim() &&
    !localDeliveryDetails?.deliveryAddress?.street?.trim() &&
    !localDeliveryDetails?.deliveryAddress?.city?.trim() &&
    !localDeliveryDetails?.deliveryAddress?.state?.trim() &&
    !localDeliveryDetails?.deliveryAddress?.zip?.trim();

  const needsPickupForm =
    hasPickup &&
    !pickupDetails?.firstName?.trim() &&
    !pickupDetails?.lastName?.trim() &&
    !pickupDetails?.phone?.trim();

  const canCheckout =
    !needsShippingForm && !needsLocalDeliveryForm && !needsPickupForm;

  const updateLocalDeliveryDetails = async (form: LocalDeliveryDetails) => {
    const details = {
      firstName: form.firstName,
      lastName: form.lastName,
      phone: form.phone,
      deliveryAddress: form.deliveryAddress,
      note: form.note,
      termsAcceptedAt: form.termsAcceptedAt,
    };
    const toUpdate = items.filter((i) => i.fulfillmentType === "local_delivery");
    for (const item of toUpdate) {
      await apiPatch(`/api/cart/${item.id}`, {
        fulfillmentType: "local_delivery",
        localDeliveryDetails: details,
      });
    }
    setLocalDeliveryModalOpen(false);
    load(true);
  };

  const updatePickupDetails = async (form: PickupDetails) => {
    const details = {
      firstName: form.firstName,
      lastName: form.lastName,
      phone: form.phone,
      email: form.email,
      preferredPickupTime: form.preferredPickupTime,
      note: form.note,
      termsAcceptedAt: form.termsAcceptedAt,
    };
    const toUpdate = items.filter((i) => i.fulfillmentType === "pickup");
    for (const item of toUpdate) {
      await apiPatch(`/api/cart/${item.id}`, {
        fulfillmentType: "pickup",
        pickupDetails: details,
      });
    }
    setPickupModalOpen(false);
    load(true);
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
      if (needsLocalDeliveryForm) setLocalDeliveryModalOpen(true);
      else if (needsPickupForm) setPickupModalOpen(true);
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
      const shippingCostCents = items.reduce((sum, i) => {
        if (i.fulfillmentType === "ship" && i.storeItem?.shippingCostCents != null) {
          return sum + i.storeItem.shippingCostCents * i.quantity;
        }
        return sum;
      }, 0);

      const payload: Record<string, unknown> = {
        items: items.map((i) => ({
          storeItemId: i.storeItemId,
          quantity: i.quantity,
          variant: i.variant ?? undefined,
          fulfillmentType: i.fulfillmentType ?? "ship",
        })),
        shippingCostCents,
      };

      if (hasShippedItem) {
        payload.shippingAddress = shippingAddress;
      }
      if (hasLocalDelivery && localDeliveryDetails) {
        payload.localDeliveryDetails = localDeliveryDetails;
      }
      payload.returnBaseUrl = siteBase;

      const data = await apiPost<{ url?: string; error?: string }>(
        "/api/stripe/storefront-checkout",
        payload
      );

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
      router.back();
    }
    if (nav.url.includes("canceled=1")) {
      setCheckoutUrl(null);
    }
  };

  if (checkoutUrl) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
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
      <View style={styles.header}>
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
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />
          }
        >
          {error ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{error}</Text>
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
                        {formatPrice(item.storeItem.priceCents)} x {item.quantity}
                      </Text>
                      <Text style={styles.itemFulfillment}>{fulfillmentLabel}</Text>
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
                  <TextInput
                    style={styles.input}
                    placeholder="Street address"
                    placeholderTextColor={theme.colors.placeholder}
                    value={shippingAddress.street}
                    onChangeText={(t) => setShippingAddress((s) => ({ ...s, street: t }))}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Apt, suite (optional)"
                    placeholderTextColor={theme.colors.placeholder}
                    value={shippingAddress.aptOrSuite}
                    onChangeText={(t) => setShippingAddress((s) => ({ ...s, aptOrSuite: t }))}
                  />
                  <View style={styles.row2}>
                    <TextInput
                      style={[styles.input, styles.inputHalf]}
                      placeholder="City"
                      placeholderTextColor={theme.colors.placeholder}
                      value={shippingAddress.city}
                      onChangeText={(t) => setShippingAddress((s) => ({ ...s, city: t }))}
                    />
                    <TextInput
                      style={[styles.input, styles.inputHalf]}
                      placeholder="State"
                      placeholderTextColor={theme.colors.placeholder}
                      value={shippingAddress.state}
                      onChangeText={(t) => setShippingAddress((s) => ({ ...s, state: t }))}
                    />
                  </View>
                  <TextInput
                    style={styles.input}
                    placeholder="ZIP code"
                    placeholderTextColor={theme.colors.placeholder}
                    value={shippingAddress.zip}
                    onChangeText={(t) => setShippingAddress((s) => ({ ...s, zip: t }))}
                    keyboardType="numeric"
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
                      onPress={() => setLocalDeliveryModalOpen(true)}
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
                      onPress={() => setPickupModalOpen(true)}
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
                  {formatPrice(
                    items.reduce((s, i) => s + i.storeItem.priceCents * i.quantity, 0)
                  )}
                </Text>
              </View>

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
            </>
          )}
        </ScrollView>
      )}

      {itemForLocalDeliveryModal && (
        <LocalDeliveryModal
          visible={localDeliveryModalOpen}
          onClose={() => setLocalDeliveryModalOpen(false)}
          policyText={
            (itemForLocalDeliveryModal.storeItem as CartItemStoreItem).member
              ?.sellerLocalDeliveryPolicy ?? undefined
          }
          initialForm={
            localDeliveryDetails
              ? {
                  firstName: localDeliveryDetails.firstName ?? "",
                  lastName: localDeliveryDetails.lastName ?? "",
                  phone: localDeliveryDetails.phone ?? "",
                  deliveryAddress: {
                    street: localDeliveryDetails.deliveryAddress?.street ?? "",
                    city: localDeliveryDetails.deliveryAddress?.city ?? "",
                    state: localDeliveryDetails.deliveryAddress?.state ?? "",
                    zip: localDeliveryDetails.deliveryAddress?.zip ?? "",
                  },
                  note: localDeliveryDetails.note ?? "",
                }
              : undefined
          }
          onSave={updateLocalDeliveryDetails}
        />
      )}
      {itemForPickupModal && (
        <PickupTermsModal
          visible={pickupModalOpen}
          onClose={() => setPickupModalOpen(false)}
          policyText={
            (itemForPickupModal.storeItem as CartItemStoreItem).pickupTerms ??
            (itemForPickupModal.storeItem as CartItemStoreItem).member
              ?.sellerPickupPolicy ?? undefined
          }
          initialForm={
            pickupDetails
              ? {
                  firstName: pickupDetails.firstName ?? "",
                  lastName: pickupDetails.lastName ?? "",
                  phone: pickupDetails.phone ?? "",
                  email: pickupDetails.email ?? "",
                  preferredPickupTime: pickupDetails.preferredPickupTime ?? "",
                  note: pickupDetails.note ?? "",
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
    paddingTop: 48,
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
  itemFulfillment: {
    fontSize: 12,
    color: "#666",
    marginTop: 2,
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
    marginBottom: 12,
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
});
