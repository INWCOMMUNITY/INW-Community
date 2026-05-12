import { useEffect, useState, useCallback, useMemo } from "react";
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Image,
  Pressable,
  ActivityIndicator,
  Alert,
  useWindowDimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Linking,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPost, apiDelete, getToken } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { ShareToChatModal } from "@/components/ShareToChatModal";
import {
  LocalDeliveryModal,
  type LocalDeliveryDetails,
} from "@/components/LocalDeliveryModal";
import {
  PickupTermsModal,
  type PickupDetails,
} from "@/components/PickupTermsModal";
import { ImageGalleryViewer } from "@/components/ImageGalleryViewer";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

interface VariantOption {
  name: string;
  options: string[];
}

interface StoreItem {
  id: string;
  title: string;
  slug: string;
  status?: string;
  description: string | null;
  photos: string[];
  category: string | null;
  priceCents: number;
  quantity: number;
  variants?: VariantOption[] | null;
  shippingDisabled?: boolean;
  localDeliveryAvailable?: boolean;
  inStorePickupAvailable?: boolean;
  localDeliveryFeeCents?: number | null;
  shippingCostCents?: number | null;
  localDeliveryTerms?: string | null;
  shippingPolicy?: string | null;
  member?: {
    id: string;
    firstName: string;
    lastName: string;
    sellerShippingPolicy?: string | null;
    sellerLocalDeliveryPolicy?: string | null;
    sellerPickupPolicy?: string | null;
    sellerReturnPolicy?: string | null;
  };
  business?: {
    id: string;
    name: string;
    slug: string;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    address?: string | null;
    logoUrl?: string | null;
    fullDescription?: string | null;
  };
  soldAt?: string;
  acceptOffers?: boolean;
  minOfferCents?: number | null;
  memberId?: string;
  listingType?: "new" | "resale";
}

type FulfillmentType = "ship" | "local_delivery" | "pickup";

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Decimal pad UX: treat input as cents digits only (e.g. 2250 → "22.50"). */
function formatOfferDollarInput(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  const cents = Math.min(parseInt(digits, 10), 99_999_999);
  return (cents / 100).toFixed(2);
}

function offerDollarsToCents(formatted: string): number {
  const n = parseFloat(formatted);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

function resolvePhotoUrl(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
}

export default function ProductScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const listingType = (useLocalSearchParams<{ listingType?: string }>().listingType as "new" | "resale") || "new";

  const [item, setItem] = useState<StoreItem | null>(null);
  const [itemUnavailable, setItemUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [selectedVariant, setSelectedVariant] = useState<Record<string, string>>({});
  const [photoIndex, setPhotoIndex] = useState(0);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [addingToCart, setAddingToCart] = useState(false);
  const [fulfillmentType, setFulfillmentType] = useState<FulfillmentType>("ship");
  const [localDeliveryModalOpen, setLocalDeliveryModalOpen] = useState(false);
  const [pickupModalOpen, setPickupModalOpen] = useState(false);
  const [localDeliveryForm, setLocalDeliveryForm] = useState<
    Partial<LocalDeliveryDetails>
  >({});
  const [pickupForm, setPickupForm] = useState<Partial<PickupDetails>>({});
  const [localDeliveryDetailsSaved, setLocalDeliveryDetailsSaved] =
    useState(false);
  const [pickupDetailsSaved, setPickupDetailsSaved] = useState(false);
  const [messageSellerModalOpen, setMessageSellerModalOpen] = useState(false);
  const [messageSellerText, setMessageSellerText] = useState("");
  const [makeOfferModalOpen, setMakeOfferModalOpen] = useState(false);
  const [offerAmountDollars, setOfferAmountDollars] = useState("");
  const [offerMessage, setOfferMessage] = useState("");
  const [offerSubmitting, setOfferSubmitting] = useState(false);
  const [offerError, setOfferError] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showSavedNote, setShowSavedNote] = useState(false);
  const [showMessageSentToast, setShowMessageSentToast] = useState(false);

  const { member } = useAuth();

  const load = useCallback(async () => {
    if (!slug) return;
    setLoading(true);
    setError("");
    setItemUnavailable(false);
    let data: (StoreItem & { unavailable?: boolean; soldAt?: string }) | null = null;
    try {
      data = await apiGet<StoreItem & { unavailable?: boolean; soldAt?: string }>(
        `/api/store-items?slug=${encodeURIComponent(slug)}&listingType=${listingType}`
      );
    } catch {
      // not found or error
    }
    if (data && typeof data.id === "string") {
      setItem(data);
      if (data.unavailable) {
        setItemUnavailable(true);
      } else {
        if (data.shippingDisabled) {
          if (data.localDeliveryAvailable) setFulfillmentType("local_delivery");
          else if (data.inStorePickupAvailable) setFulfillmentType("pickup");
        } else {
          setFulfillmentType("ship");
        }
      }
      setLoading(false);
      return;
    }
    try {
      const data2 = await apiGet<StoreItem & { unavailable?: boolean; soldAt?: string }>(
        `/api/store-items?slug=${encodeURIComponent(slug)}&listingType=${listingType}&includeUnavailable=1`
      );
      if (data2 && typeof data2.id === "string" && data2.unavailable) {
        setItem(data2);
        setItemUnavailable(true);
        if (data2.shippingDisabled) {
          if (data2.localDeliveryAvailable) setFulfillmentType("local_delivery");
          else if (data2.inStorePickupAvailable) setFulfillmentType("pickup");
        } else {
          setFulfillmentType("ship");
        }
      } else {
        setItem(null);
        setError("Product not found");
      }
    } catch {
      setItem(null);
      setError("Product not found");
    } finally {
      setLoading(false);
    }
  }, [slug, listingType]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setMessageSellerModalOpen(false);
    setMessageSellerText("");
    setMakeOfferModalOpen(false);
  }, [slug, listingType]);

  useEffect(() => {
    if (!member || !item) return;
    apiGet<{ type: string; referenceId: string }[]>(`/api/saved?type=store_item`)
      .then((items) => setSaved(items.some((i) => i.referenceId === item.id)))
      .catch(() => setSaved(false));
  }, [member, item?.id]);

  useEffect(() => {
    if (!showSavedNote) return;
    const timer = setTimeout(() => setShowSavedNote(false), 3000);
    return () => clearTimeout(timer);
  }, [showSavedNote]);

  useEffect(() => {
    if (!showMessageSentToast) return;
    const timer = setTimeout(() => setShowMessageSentToast(false), 1000);
    return () => clearTimeout(timer);
  }, [showMessageSentToast]);

  const handleSaveToggle = async () => {
    if (!member || !item) return;
    const token = await getToken();
    if (!token) {
      router.push("/(auth)/login");
      return;
    }
    setSaving(true);
    try {
      if (saved) {
        await apiDelete(`/api/saved?type=store_item&referenceId=${encodeURIComponent(item.id)}`);
        setSaved(false);
      } else {
        await apiPost("/api/saved", { type: "store_item", referenceId: item.id });
        setSaved(true);
        setShowSavedNote(true);
      }
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  const canAddToCart =
    (fulfillmentType !== "local_delivery" || localDeliveryDetailsSaved) &&
    (fulfillmentType !== "pickup" || pickupDetailsSaved);

  const localDeliveryModalInitial = useMemo(
    (): Partial<LocalDeliveryDetails> => ({
      firstName: localDeliveryForm.firstName ?? "",
      lastName: localDeliveryForm.lastName ?? "",
      phone: localDeliveryForm.phone ?? "",
      email: localDeliveryForm.email ?? "",
      deliveryAddress: {
        street: localDeliveryForm.deliveryAddress?.street ?? "",
        city: localDeliveryForm.deliveryAddress?.city ?? "",
        state: localDeliveryForm.deliveryAddress?.state ?? "",
        zip: localDeliveryForm.deliveryAddress?.zip ?? "",
      },
      availableDropOffTimes: localDeliveryForm.availableDropOffTimes ?? "",
      note: localDeliveryForm.note ?? "",
    }),
    [
      localDeliveryForm.firstName,
      localDeliveryForm.lastName,
      localDeliveryForm.phone,
      localDeliveryForm.email,
      localDeliveryForm.deliveryAddress?.street,
      localDeliveryForm.deliveryAddress?.city,
      localDeliveryForm.deliveryAddress?.state,
      localDeliveryForm.deliveryAddress?.zip,
      localDeliveryForm.availableDropOffTimes,
      localDeliveryForm.note,
    ]
  );

  const messageSeller = async () => {
    if (!item || !messageSellerText.trim()) return;
    const token = await getToken();
    if (!token) {
      Alert.alert(
        "Sign in required",
        "Please sign in to message the seller.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Sign in", onPress: () => router.push("/(tabs)/my-community") },
        ]
      );
      return;
    }
    setSendingMessage(true);
    try {
      await apiPost<{ conversationId: string }>(
        "/api/resale-messages",
        { storeItemId: item.id, content: messageSellerText.trim() }
      );
      setMessageSellerModalOpen(false);
      setMessageSellerText("");
      setShowMessageSentToast(true);
    } catch (e) {
      const err = e as { error?: string; status?: number };
      if (err.status === 401) {
        Alert.alert("Sign in required", "Please sign in to message the seller.", [
          { text: "Cancel", style: "cancel" },
          { text: "Sign in", onPress: () => router.push("/(tabs)/my-community") },
        ]);
      } else {
        Alert.alert("Error", err.error ?? "Could not send message.");
      }
    } finally {
      setSendingMessage(false);
    }
  };

  const submitMakeOffer = async () => {
    if (!item) return;
    const amountCents = offerDollarsToCents(offerAmountDollars);
    if (!Number.isFinite(amountCents) || amountCents < 1) {
      setOfferError("Enter a valid amount");
      return;
    }
    const minC = item.minOfferCents;
    if (minC != null && minC > 0 && amountCents < minC) {
      setOfferError(`Offer must be at least ${formatPrice(minC)}`);
      return;
    }
    const token = await getToken();
    if (!token) {
      Alert.alert("Sign in required", "Please sign in to make an offer.", [
        { text: "Cancel", style: "cancel" },
        { text: "Sign in", onPress: () => router.push("/(tabs)/my-community") },
      ]);
      return;
    }
    setOfferError("");
    setOfferSubmitting(true);
    try {
      await apiPost("/api/resale-offers", {
        storeItemId: item.id,
        amountCents,
        message: offerMessage.trim() || undefined,
      });
      setMakeOfferModalOpen(false);
      setOfferAmountDollars("");
      setOfferMessage("");
      Alert.alert(
        "Offer sent",
        "The seller will review your offer. You’ll get a notification when they respond."
      );
    } catch (e) {
      const err = e as { error?: string };
      setOfferError(err?.error ?? "Could not submit offer.");
    } finally {
      setOfferSubmitting(false);
    }
  };

  const addToCart = async () => {
    if (!item) return;
    const token = await getToken();
    if (!token) {
      Alert.alert(
        "Sign in required",
        "Please sign in to add items to your cart.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Sign in", onPress: () => router.push("/(tabs)/my-community") },
        ]
      );
      return;
    }

    if (!canAddToCart) {
      if (fulfillmentType === "local_delivery") {
        setLocalDeliveryModalOpen(true);
        Alert.alert(
          "Complete delivery details",
          "Please complete your local delivery details before adding to cart."
        );
      } else if (fulfillmentType === "pickup") {
        setPickupModalOpen(true);
        Alert.alert(
          "Complete pickup details",
          "Please complete the pick up form before adding to cart."
        );
      }
      return;
    }

    const hasVariants = item.variants && item.variants.length > 0;
    const allSelected = hasVariants
      ? item.variants!.every((v) => selectedVariant[v.name] != null && selectedVariant[v.name] !== "")
      : true;

    if (hasVariants && !allSelected) {
      Alert.alert("Select options", "Please select all required options (e.g. size) before adding to cart.");
      return;
    }

    const payload: Record<string, unknown> = {
      storeItemId: item.id,
      quantity,
      variant: Object.keys(selectedVariant).length > 0 ? selectedVariant : undefined,
      fulfillmentType,
    };
    if (fulfillmentType === "local_delivery" && localDeliveryForm) {
      payload.localDeliveryDetails = localDeliveryForm;
    }
    if (fulfillmentType === "pickup" && pickupForm) {
      payload.pickupDetails = pickupForm;
    }

    setAddingToCart(true);
    try {
      await apiPost("/api/cart", payload);
      Alert.alert("Added to cart", "Item added successfully.", [
        { text: "Keep shopping", style: "cancel" },
        { text: "View cart", onPress: () => router.push("/cart") },
      ]);
    } catch (e) {
      const err = e as { error?: string; status?: number };
      if (err.status === 401) {
        Alert.alert(
          "Sign in required",
          "Please sign in to add items to your cart.",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Sign in", onPress: () => router.push("/(tabs)/my-community") },
          ]
        );
      } else {
        Alert.alert("Error", err.error ?? "Could not add to cart.");
      }
    } finally {
      setAddingToCart(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.cream} />
      </View>
    );
  }

  if (error || !item) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Product</Text>
        </View>
        <View style={styles.center}>
          <Text style={styles.errorText}>{error || "Product not found"}</Text>
        </View>
      </View>
    );
  }

  const photos = item.photos ?? [];
  const photoUrl = resolvePhotoUrl(photos[photoIndex]);
  const canShip = !item.shippingDisabled;
  const canLocalDelivery = !!item.localDeliveryAvailable;
  const canPickup = !!item.inStorePickupAvailable;

  const effectiveShippingPolicy =
    item.shippingPolicy ?? item.member?.sellerShippingPolicy ?? null;
  const effectiveLocalDeliveryPolicy =
    item.localDeliveryTerms ??
    item.member?.sellerLocalDeliveryPolicy ??
    null;
  const hasSellerPolicy =
    !!effectiveLocalDeliveryPolicy ||
    !!effectiveShippingPolicy ||
    !!item.member?.sellerReturnPolicy;

  const isResaleListing = item.listingType === "resale" || listingType === "resale";
  const isOwnListing = !!(
    member &&
    (item.memberId === member.id || item.member?.id === member.id)
  );
  const sellerAcceptsOffers = item.acceptOffers !== false;
  const showResaleBuyerActions = isResaleListing && !itemUnavailable && !isOwnListing;
  const showSendOfferButton = showResaleBuyerActions && sellerAcceptsOffers;

  const openSendOfferModal = () => {
    setMessageSellerModalOpen(false);
    setOfferError("");
    setOfferAmountDollars("");
    setOfferMessage("");
    setMakeOfferModalOpen(true);
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {item.title}
        </Text>
        {member && (
          <View style={styles.headerActions}>
            <Pressable
              onPress={handleSaveToggle}
              disabled={saving}
              style={({ pressed }) => [styles.headerActionBtn, pressed && { opacity: 0.8 }]}
            >
              <Ionicons
                name={saved ? "heart" : "heart-outline"}
                size={26}
                color="#fff"
              />
            </Pressable>
            <Pressable
              onPress={() => setShareModalOpen(true)}
              style={({ pressed }) => [styles.headerActionBtn, pressed && { opacity: 0.8 }]}
            >
              <Ionicons name="share-outline" size={26} color="#fff" />
            </Pressable>
          </View>
        )}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
      >
        {itemUnavailable && item && (
          <View style={styles.soldBanner}>
            <Text style={styles.soldBannerText}>
              {item.status === "sold_out" || item.soldAt
                ? item.soldAt
                  ? `This item was sold on ${new Date(item.soldAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.`
                  : "This item was sold."
                : item.status === "inactive"
                  ? "This listing has ended."
                  : "This listing is not available for purchase right now."}
            </Text>
          </View>
        )}
        <View style={[styles.galleryWrap, { width }]}>
          {photos.length > 0 ? (
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
                const idx = Math.round(e.nativeEvent.contentOffset.x / width);
                if (idx >= 0 && idx < photos.length) setPhotoIndex(idx);
              }}
              scrollEventThrottle={16}
            >
              {photos.map((p, i) => {
                const url = resolvePhotoUrl(p);
                return (
                  <Pressable
                    key={i}
                    style={[styles.gallerySlide, { width }]}
                    onPress={() => {
                      setGalleryIndex(i);
                      setGalleryOpen(true);
                    }}
                  >
                    {url ? (
                      <Image source={{ uri: url }} style={styles.galleryImage} resizeMode="contain" />
                    ) : (
                      <View style={[styles.galleryImage, styles.placeholder]}>
                        <Ionicons name="image-outline" size={48} color={theme.colors.primary} />
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : (
            <View style={[styles.galleryImage, styles.placeholder]}>
              <Ionicons name="image-outline" size={48} color={theme.colors.primary} />
            </View>
          )}
          {photos.length > 1 && (
            <View style={styles.dots}>
              {photos.map((_, i) => (
                <View
                  key={i}
                  style={[styles.dot, i === photoIndex && styles.dotActive]}
                />
              ))}
            </View>
          )}
        </View>

        {photos.length > 0 && (
          <ImageGalleryViewer
            visible={galleryOpen}
            images={photos.map((p) => resolvePhotoUrl(p)).filter((u): u is string => !!u)}
            initialIndex={galleryIndex}
            onClose={() => setGalleryOpen(false)}
          />
        )}

        <View style={styles.body}>
          <Text style={styles.title}>{item.title}</Text>
          <Text style={styles.price}>{formatPrice(item.priceCents)}</Text>
          {item.category && (
            <View style={styles.categoryChip}>
              <Text style={styles.categoryText}>{item.category}</Text>
            </View>
          )}

          {item.variants && item.variants.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Options</Text>
              {item.variants.map((v) => (
                <View key={v.name} style={styles.variantRow}>
                  <Text style={styles.variantLabel}>{v.name}:</Text>
                  <View style={styles.variantOptions}>
                    {v.options.map((opt) => (
                      <Pressable
                        key={opt}
                        style={[
                          styles.variantBtn,
                          selectedVariant[v.name] === opt && styles.variantBtnActive,
                        ]}
                        onPress={() => setSelectedVariant((s) => ({ ...s, [v.name]: opt }))}
                      >
                        <Text
                          style={[
                            styles.variantBtnText,
                            selectedVariant[v.name] === opt && styles.variantBtnTextActive,
                          ]}
                        >
                          {opt}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Quantity</Text>
            <View style={styles.quantityRow}>
              <Pressable
                style={styles.qtyBtn}
                onPress={() => setQuantity((q) => Math.max(1, q - 1))}
                disabled={quantity <= 1}
              >
                <Ionicons name="remove" size={20} color={theme.colors.primary} />
              </Pressable>
              <Text style={styles.qtyText}>{quantity}</Text>
              <Pressable
                style={styles.qtyBtn}
                onPress={() => setQuantity((q) => Math.min(item.quantity, q + 1))}
                disabled={quantity >= item.quantity}
              >
                <Ionicons name="add" size={20} color={theme.colors.primary} />
              </Pressable>
            </View>
            {item.quantity < 10 && (
              <Text style={styles.stockHint}>Only {item.quantity} left</Text>
            )}
          </View>

          {(canShip || canLocalDelivery || canPickup) && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Delivery</Text>
              <View style={styles.fulfillmentRow}>
                {canShip && (
                  <Pressable
                    style={[
                      styles.fulfillmentBtn,
                      fulfillmentType === "ship" && styles.fulfillmentBtnActive,
                    ]}
                    onPress={() => setFulfillmentType("ship")}
                  >
                    <Text
                      style={[
                        styles.fulfillmentBtnText,
                        fulfillmentType === "ship" && styles.fulfillmentBtnTextActive,
                      ]}
                    >
                      Ship
                    </Text>
                  </Pressable>
                )}
                {canLocalDelivery && (
                  <Pressable
                    style={[
                      styles.fulfillmentBtn,
                      fulfillmentType === "local_delivery" && styles.fulfillmentBtnActive,
                    ]}
                    onPress={() => {
                      setFulfillmentType("local_delivery");
                      setLocalDeliveryModalOpen(true);
                    }}
                  >
                    <Text
                      style={[
                        styles.fulfillmentBtnText,
                        fulfillmentType === "local_delivery" && styles.fulfillmentBtnTextActive,
                      ]}
                    >
                      Local delivery
                    </Text>
                  </Pressable>
                )}
                {canPickup && (
                  <Pressable
                    style={[
                      styles.fulfillmentBtn,
                      fulfillmentType === "pickup" && styles.fulfillmentBtnActive,
                    ]}
                    onPress={() => {
                      setFulfillmentType("pickup");
                      setPickupModalOpen(true);
                    }}
                  >
                    <Text
                      style={[
                        styles.fulfillmentBtnText,
                        fulfillmentType === "pickup" && styles.fulfillmentBtnTextActive,
                      ]}
                    >
                      Pickup
                    </Text>
                  </Pressable>
                )}
              </View>
              {(fulfillmentType === "local_delivery" || fulfillmentType === "pickup") && (
                <View style={styles.fulfillmentHintRow}>
                  <Text style={styles.fulfillmentHint}>
                    {(fulfillmentType === "local_delivery" && localDeliveryDetailsSaved) ||
                    (fulfillmentType === "pickup" && pickupDetailsSaved)
                      ? "Details saved. You can add to cart."
                      : "Complete the form to add to cart."}
                  </Text>
                  {((fulfillmentType === "local_delivery" && !localDeliveryDetailsSaved) ||
                    (fulfillmentType === "pickup" && !pickupDetailsSaved)) && (
                    <Pressable
                      style={({ pressed }) => [
                        styles.completeDetailsBtn,
                        pressed && { opacity: 0.8 },
                      ]}
                      onPress={() =>
                        fulfillmentType === "local_delivery"
                          ? setLocalDeliveryModalOpen(true)
                          : setPickupModalOpen(true)
                      }
                    >
                      <Text style={styles.completeDetailsBtnText}>
                        Complete details
                      </Text>
                    </Pressable>
                  )}
                </View>
              )}
            </View>
          )}

          {item.description ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Description</Text>
              <Text style={styles.description}>{item.description}</Text>
            </View>
          ) : null}

          {showResaleBuyerActions ? (
            <View style={styles.section}>
              <View style={styles.resaleActionsRow}>
                <Pressable
                  style={({ pressed }) => [
                    styles.messageSellerBtn,
                    pressed && { opacity: 0.8 },
                  ]}
                  onPress={() => setMessageSellerModalOpen(true)}
                >
                  <Ionicons name="chatbubble-outline" size={18} color="#fff" />
                  <Text style={styles.messageSellerBtnText}>Message Seller</Text>
                </Pressable>
                {showSendOfferButton ? (
                  <Pressable
                    style={({ pressed }) => [
                      styles.makeOfferBtn,
                      pressed && { opacity: 0.8 },
                    ]}
                    onPress={openSendOfferModal}
                  >
                    <Ionicons name="pricetag-outline" size={18} color={theme.colors.primary} />
                    <Text style={styles.makeOfferBtnText}>Send Offer</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ) : null}

          {/* Store Information */}
          {item.business && (
            <View style={[styles.section, styles.sellerCard]}>
              <View style={styles.sellerCardHeader}>
                <Text style={styles.sellerCardTitle}>Store Information</Text>
              </View>
              <View style={styles.sellerCardBody}>
                {item.business.logoUrl ? (
                  <Image
                    source={{ uri: resolvePhotoUrl(item.business.logoUrl) }}
                    style={styles.storeLogo}
                  />
                ) : null}
                <Text style={styles.storeName}>{item.business.name || "—"}</Text>
                {item.business.fullDescription ? (
                  <Text style={styles.storeDescription}>
                    {item.business.fullDescription}
                  </Text>
                ) : null}
                {item.business.phone ? (
                  <Text style={styles.storeDetail}>
                    Phone: {item.business.phone}
                  </Text>
                ) : null}
                {item.business.email ? (
                  <Text style={styles.storeDetail}>
                    Email: {item.business.email}
                  </Text>
                ) : null}
                {item.business.website ? (
                  <Pressable
                    onPress={() =>
                      Linking.openURL(
                        item.business!.website!.startsWith("http")
                          ? item.business!.website!
                          : `https://${item.business!.website!}`
                      )
                    }
                  >
                    <Text style={styles.storeLink}>Website</Text>
                  </Pressable>
                ) : null}
                {item.business.address ? (
                  <Text style={styles.storeDetail}>
                    Address: {item.business.address}
                  </Text>
                ) : null}
                {item.business.slug ? (
                  <Pressable
                    style={styles.viewBusinessBtn}
                    onPress={() =>
                      router.push(`/business/${item.business!.slug}`)
                    }
                  >
                    <Text style={styles.viewBusinessBtnText}>
                      View Business Page
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          )}

          {/* Seller Policy */}
          {hasSellerPolicy && (
            <View style={[styles.section, styles.sellerCard]}>
              <View style={styles.sellerCardHeader}>
                <Text style={styles.sellerCardTitle}>Seller Policy</Text>
              </View>
              <View style={styles.sellerCardBody}>
                {effectiveLocalDeliveryPolicy ? (
                  <View style={styles.policyBlock}>
                    <Text style={styles.policyLabel}>
                      Local Delivery / Pick Up Policy
                    </Text>
                    <Text style={styles.policyText}>
                      {effectiveLocalDeliveryPolicy}
                    </Text>
                  </View>
                ) : null}
                {effectiveShippingPolicy ? (
                  <View style={styles.policyBlock}>
                    <Text style={styles.policyLabel}>Shipping Policy</Text>
                    <Text style={styles.policyText}>
                      {effectiveShippingPolicy}
                    </Text>
                  </View>
                ) : null}
                {item.member?.sellerReturnPolicy ? (
                  <View style={styles.policyBlock}>
                    <Text style={styles.policyLabel}>Return Policy</Text>
                    <Text style={styles.policyText}>
                      {item.member.sellerReturnPolicy}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      {!itemUnavailable && (
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) + 10 }]}>
          {showResaleBuyerActions ? (
            <View style={styles.footerResaleRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.footerSecondaryBtn,
                  pressed && { opacity: 0.85 },
                ]}
                onPress={() => setMessageSellerModalOpen(true)}
              >
                <Ionicons name="chatbubble-outline" size={18} color={theme.colors.primary} />
                <Text style={styles.footerSecondaryBtnText}>Message Seller</Text>
              </Pressable>
              {showSendOfferButton ? (
                <Pressable
                  style={({ pressed }) => [
                    styles.footerSecondaryBtn,
                    styles.footerSendOfferBtn,
                    pressed && { opacity: 0.85 },
                  ]}
                  onPress={openSendOfferModal}
                >
                  <Ionicons name="pricetag-outline" size={18} color={theme.colors.primary} />
                  <Text style={styles.footerSecondaryBtnText}>Send Offer</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          <Pressable
            style={[styles.addBtn, addingToCart && styles.addBtnDisabled]}
            onPress={addToCart}
            disabled={addingToCart}
          >
            {addingToCart ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="cart" size={20} color="#fff" />
                <Text style={styles.addBtnText}>Add to Cart</Text>
              </>
            )}
          </Pressable>
        </View>
      )}

      {item && (
        <>
          <LocalDeliveryModal
            visible={localDeliveryModalOpen}
            onClose={() => setLocalDeliveryModalOpen(false)}
            policyText={effectiveLocalDeliveryPolicy ?? undefined}
            initialForm={localDeliveryModalInitial}
            onSave={(form) => {
              setLocalDeliveryForm(form);
              setLocalDeliveryDetailsSaved(true);
              setLocalDeliveryModalOpen(false);
            }}
          />
          <PickupTermsModal
            visible={pickupModalOpen}
            onClose={() => setPickupModalOpen(false)}
            policyText={(item as { pickupTerms?: string }).pickupTerms ?? item.member?.sellerPickupPolicy ?? undefined}
            initialForm={{
              firstName: pickupForm.firstName ?? "",
              lastName: pickupForm.lastName ?? "",
              phone: pickupForm.phone ?? "",
              email: pickupForm.email ?? "",
              preferredPickupDate: pickupForm.preferredPickupDate ?? "",
              preferredPickupTime: pickupForm.preferredPickupTime ?? "",
              note: pickupForm.note ?? "",
              termsAcceptedAt: pickupForm.termsAcceptedAt,
            }}
            onSave={(form) => {
              setPickupForm(form);
              setPickupDetailsSaved(true);
              setPickupModalOpen(false);
            }}
          />
          <Modal
            visible={messageSellerModalOpen}
            transparent
            animationType="slide"
            onRequestClose={() => !sendingMessage && setMessageSellerModalOpen(false)}
          >
            <Pressable
              style={styles.modalBackdrop}
              onPress={() => !sendingMessage && setMessageSellerModalOpen(false)}
            >
              <KeyboardAvoidingView
                behavior={Platform.OS === "ios" ? "padding" : undefined}
                style={styles.modalContentWrap}
              >
                <Pressable
                  style={styles.messageSellerModal}
                  onPress={(e) => e.stopPropagation()}
                >
                  <Text style={styles.messageSellerModalTitle}>Message Seller</Text>
                  <TextInput
                    style={styles.messageSellerInput}
                    placeholder="Type your message..."
                    placeholderTextColor="#999"
                    multiline
                    numberOfLines={4}
                    value={messageSellerText}
                    onChangeText={setMessageSellerText}
                    editable={!sendingMessage}
                    autoCorrect
                  />
                  <View style={styles.messageSellerModalActions}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.messageSellerCancelBtn,
                        pressed && { opacity: 0.8 },
                      ]}
                      onPress={() => setMessageSellerModalOpen(false)}
                      disabled={sendingMessage}
                    >
                      <Text style={styles.messageSellerCancelText}>Cancel</Text>
                    </Pressable>
                    <Pressable
                      style={[
                        styles.messageSellerSendBtn,
                        sendingMessage && styles.addBtnDisabled,
                      ]}
                      onPress={messageSeller}
                      disabled={sendingMessage || !messageSellerText.trim()}
                    >
                      {sendingMessage ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.messageSellerSendText}>Send</Text>
                      )}
                    </Pressable>
                  </View>
                </Pressable>
              </KeyboardAvoidingView>
            </Pressable>
          </Modal>
          <Modal
            visible={makeOfferModalOpen}
            transparent
            animationType="slide"
            onRequestClose={() => !offerSubmitting && setMakeOfferModalOpen(false)}
          >
            <Pressable
              style={styles.modalBackdrop}
              onPress={() => !offerSubmitting && setMakeOfferModalOpen(false)}
            >
              <KeyboardAvoidingView
                behavior={Platform.OS === "ios" ? "padding" : undefined}
                style={styles.modalContentWrap}
              >
                <Pressable
                  style={styles.messageSellerModal}
                  onPress={(e) => e.stopPropagation()}
                >
                  <Text style={styles.messageSellerModalTitle}>Send Offer</Text>
                  {item?.minOfferCents != null && item.minOfferCents > 0 && (
                    <Text style={styles.makeOfferMinHint}>
                      Minimum: ${(item.minOfferCents / 100).toFixed(2)}
                    </Text>
                  )}
                  <TextInput
                    style={styles.makeOfferAmountInput}
                    placeholder="0.00"
                    placeholderTextColor="#999"
                    keyboardType="decimal-pad"
                    value={offerAmountDollars}
                    onChangeText={(t) => {
                      setOfferAmountDollars(formatOfferDollarInput(t));
                      setOfferError("");
                    }}
                    editable={!offerSubmitting}
                  />
                  <TextInput
                    style={styles.makeOfferMessageInput}
                    placeholder="Message (optional)"
                    placeholderTextColor="#999"
                    multiline
                    numberOfLines={3}
                    value={offerMessage}
                    onChangeText={setOfferMessage}
                    editable={!offerSubmitting}
                  />
                  {offerError ? (
                    <Text style={styles.makeOfferError}>{offerError}</Text>
                  ) : null}
                  <View style={styles.messageSellerModalActions}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.messageSellerCancelBtn,
                        pressed && { opacity: 0.8 },
                      ]}
                      onPress={() => setMakeOfferModalOpen(false)}
                      disabled={offerSubmitting}
                    >
                      <Text style={styles.messageSellerCancelText}>Cancel</Text>
                    </Pressable>
                    <Pressable
                      style={[
                        styles.messageSellerSendBtn,
                        offerSubmitting && styles.addBtnDisabled,
                      ]}
                      onPress={submitMakeOffer}
                      disabled={offerSubmitting}
                    >
                      {offerSubmitting ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.messageSellerSendText}>Send Offer</Text>
                      )}
                    </Pressable>
                  </View>
                </Pressable>
              </KeyboardAvoidingView>
            </Pressable>
          </Modal>
          <ShareToChatModal
            visible={shareModalOpen}
            onClose={() => setShareModalOpen(false)}
            sharedContent={{
              type: "store_item",
              id: item.id,
              slug: item.slug,
              listingType,
              title: item.title,
              previewPhotoUrl: (item.photos ?? []).find((p) => p && String(p).trim() !== "") ?? undefined,
            }}
          />
          <Modal visible={showSavedNote} transparent animationType="fade">
            <Pressable style={styles.savedNoteBackdrop} onPress={() => setShowSavedNote(false)}>
              <Pressable style={styles.savedNoteBox} onPress={() => {}}>
                <Text style={styles.savedNoteText}>Added to Wishlist!</Text>
              </Pressable>
            </Pressable>
          </Modal>
          <Modal visible={showMessageSentToast} transparent animationType="fade">
            <View style={styles.toastWrap} pointerEvents="none">
              <View style={styles.toastBox}>
                <Text style={styles.toastText}>Message Sent!</Text>
              </View>
            </View>
          </Modal>
        </>
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
    paddingVertical: 6,
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
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 0,
  },
  headerActionBtn: { paddingVertical: 10, paddingHorizontal: 4 },
  savedNoteBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
  },
  savedNoteBox: {
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 14,
    marginHorizontal: 24,
  },
  toastWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  toastBox: {
    backgroundColor: "rgba(0,0,0,0.75)",
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  toastText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#fff",
  },
  savedNoteText: {
    fontSize: 14,
    color: theme.colors.primary,
    fontWeight: "600",
    textAlign: "center",
  },
  errorText: {
    fontSize: 16,
    color: theme.colors.text,
  },
  scroll: {
    flex: 1,
    backgroundColor: "#fff",
  },
  scrollContent: {
    paddingBottom: 168,
    backgroundColor: "#fff",
  },
  galleryWrap: {
    aspectRatio: 1,
    backgroundColor: "#fff",
  },
  gallerySlide: {
    aspectRatio: 1,
  },
  galleryImage: {
    width: "100%",
    height: "100%",
  },
  placeholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  dots: {
    position: "absolute",
    bottom: 12,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(0,0,0,0.3)",
  },
  dotActive: {
    backgroundColor: theme.colors.primary,
  },
  body: {
    padding: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: "#000",
    marginBottom: 8,
  },
  price: {
    fontSize: 24,
    fontWeight: "700",
    color: "#000",
    marginBottom: 12,
  },
  categoryChip: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: theme.colors.creamAlt,
    marginBottom: 16,
  },
  categoryText: {
    fontSize: 12,
    color: theme.colors.heading,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.heading,
    marginBottom: 8,
  },
  variantRow: {
    marginBottom: 8,
  },
  variantLabel: {
    fontSize: 14,
    color: theme.colors.text,
    marginBottom: 4,
  },
  variantOptions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  variantBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    backgroundColor: "#fff",
  },
  variantBtnActive: {
    backgroundColor: theme.colors.primary,
  },
  variantBtnText: {
    fontSize: 14,
    color: theme.colors.primary,
  },
  variantBtnTextActive: {
    color: "#fff",
  },
  quantityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  qtyBtn: {
    width: 40,
    height: 40,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  qtyText: {
    fontSize: 18,
    fontWeight: "600",
    color: theme.colors.heading,
    minWidth: 24,
    textAlign: "center",
  },
  stockHint: {
    fontSize: 12,
    color: "#999",
    marginTop: 4,
  },
  fulfillmentRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  fulfillmentBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    backgroundColor: "#fff",
  },
  fulfillmentBtnActive: {
    backgroundColor: theme.colors.primary,
  },
  fulfillmentBtnText: {
    fontSize: 14,
    color: theme.colors.primary,
  },
  fulfillmentBtnTextActive: {
    color: "#fff",
  },
  fulfillmentHintRow: {
    marginTop: 8,
    gap: 8,
  },
  fulfillmentHint: {
    fontSize: 12,
    color: "#666",
  },
  completeDetailsBtn: {
    alignSelf: "flex-start",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: theme.colors.primary,
  },
  completeDetailsBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#fff",
  },
  description: {
    fontSize: 15,
    color: theme.colors.text,
    lineHeight: 22,
  },
  resaleActionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  messageSellerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
  },
  messageSellerBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#fff",
  },
  makeOfferBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: theme.colors.cream,
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },
  makeOfferBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.heading,
  },
  makeOfferAmountInput: {
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 16,
    color: theme.colors.text,
    minHeight: 44,
    maxHeight: 44,
    marginBottom: 16,
  },
  makeOfferMessageInput: {
    borderWidth: 2,
    borderColor: theme.colors.cream,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: theme.colors.text,
    minHeight: 72,
    textAlignVertical: "top",
  },
  makeOfferMinHint: {
    fontSize: 12,
    color: "#666",
    marginBottom: 8,
  },
  makeOfferError: {
    fontSize: 12,
    color: "#b91c1c",
    marginBottom: 8,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalContentWrap: {
    width: "100%",
  },
  messageSellerModal: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    paddingBottom: 40,
  },
  messageSellerModalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: theme.colors.heading,
    marginBottom: 12,
  },
  messageSellerInput: {
    borderWidth: 2,
    borderColor: theme.colors.cream,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: theme.colors.text,
    minHeight: 80,
    textAlignVertical: "top",
  },
  messageSellerModalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
    marginTop: 16,
  },
  messageSellerCancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  messageSellerCancelText: {
    fontSize: 16,
    color: theme.colors.text,
  },
  messageSellerSendBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
    minWidth: 80,
    alignItems: "center",
  },
  messageSellerSendText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  sellerCard: {
    marginTop: 8,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 8,
    overflow: "hidden",
  },
  sellerCardHeader: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: theme.colors.primary,
  },
  sellerCardTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  sellerCardBody: {
    padding: 16,
    backgroundColor: "#f9f9f9",
  },
  storeLogo: {
    width: 72,
    height: 72,
    borderRadius: 36,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: theme.colors.cream,
  },
  storeName: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.heading,
    marginBottom: 8,
  },
  storeDescription: {
    fontSize: 14,
    color: theme.colors.text,
    lineHeight: 20,
    marginBottom: 8,
  },
  storeDetail: {
    fontSize: 14,
    color: theme.colors.text,
    marginBottom: 4,
  },
  storeLink: {
    fontSize: 14,
    color: theme.colors.primary,
    textDecorationLine: "underline",
    marginBottom: 4,
  },
  viewBusinessBtn: {
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
    alignSelf: "flex-start",
  },
  viewBusinessBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#fff",
  },
  policyBlock: {
    marginBottom: 16,
  },
  policyLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: theme.colors.heading,
    marginBottom: 4,
  },
  policyText: {
    fontSize: 14,
    color: theme.colors.text,
    lineHeight: 20,
  },
  soldBanner: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#fffbeb",
    borderWidth: 1,
    borderColor: "#fde68a",
  },
  soldBannerText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#92400e",
  },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    paddingTop: 12,
    backgroundColor: "#fff",
    borderTopWidth: 2,
    borderTopColor: "#eee",
  },
  footerResaleRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 10,
  },
  footerSecondaryBtn: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },
  footerSendOfferBtn: {
    backgroundColor: theme.colors.cream,
  },
  footerSecondaryBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.heading,
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
    borderWidth: 2,
    borderColor: "#000",
  },
  addBtnDisabled: {
    opacity: 0.7,
  },
  addBtnText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#fff",
  },
});
