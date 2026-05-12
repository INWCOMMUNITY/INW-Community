import { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Image,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPatch } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

interface OfferDetail {
  id: string;
  buyerId: string;
  amountCents: number;
  counterAmountCents?: number | null;
  message: string | null;
  sellerResponse?: string | null;
  status: string;
  createdAt: string;
  respondedAt?: string | null;
  acceptedAt?: string | null;
  checkoutDeadlineAt?: string | null;
  finalAmountCents?: number | null;
  buyer?: { id: string; firstName: string; lastName: string };
  storeItem: {
    id: string;
    title: string;
    slug: string;
    photos: string[];
    priceCents: number;
    listingType: string;
    memberId: string;
    status: string;
    quantity: number;
    member?: { id: string; firstName: string; lastName: string };
  };
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function resolvePhoto(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
}

export default function BuyerOfferDetailScreen() {
  const { id: offerId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { member } = useAuth();
  const [offer, setOffer] = useState<OfferDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!offerId) return;
    setLoading(true);
    setError("");
    try {
      const data = await apiGet<OfferDetail>(`/api/resale-offers/${encodeURIComponent(offerId)}`);
      setOffer(data);
    } catch (e) {
      const err = e as { error?: string };
      setError(err?.error ?? "Could not load offer.");
      setOffer(null);
    } finally {
      setLoading(false);
    }
  }, [offerId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const respondCounter = async (status: "accepted" | "declined") => {
    if (!offerId) return;
    if (status === "declined") {
      Alert.alert("Decline counter?", "The seller will be notified.", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Decline",
          style: "destructive",
          onPress: async () => {
            setSubmitting(true);
            try {
              await apiPatch(`/api/resale-offers/${encodeURIComponent(offerId)}`, { status: "declined" });
              await load();
            } catch (e) {
              const err = e as { error?: string };
              Alert.alert("Error", err?.error ?? "Could not update offer.");
            } finally {
              setSubmitting(false);
            }
          },
        },
      ]);
      return;
    }
    setSubmitting(true);
    try {
      await apiPatch(`/api/resale-offers/${encodeURIComponent(offerId)}`, { status: "accepted" });
      Alert.alert("Offer accepted", "This item was added to your cart at the agreed price.", [
        { text: "Later", style: "cancel" },
        { text: "View cart", onPress: () => (router.push as (h: string) => void)("/cart") },
      ]);
      await load();
    } catch (e) {
      const err = e as { error?: string };
      Alert.alert("Error", err?.error ?? "Could not accept offer.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && !offer) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (error || !offer) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Offer</Text>
        </View>
        <View style={styles.center}>
          <Text style={styles.errorText}>{error || "Offer not found"}</Text>
        </View>
      </View>
    );
  }

  const isBuyer = member?.id === offer.buyerId;
  const isSeller = member?.id === offer.storeItem.memberId;
  const photo = resolvePhoto(offer.storeItem.photos?.[0]);
  const lt = offer.storeItem.listingType === "resale" ? "resale" : "new";

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Resale Offer
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Pressable
          onPress={() =>
            (router.push as (h: string) => void)(
              `/product/${offer.storeItem.slug}?listingType=${encodeURIComponent(lt)}`
            )
          }
        >
          <View style={styles.heroRow}>
            {photo ? (
              <Image source={{ uri: photo }} style={styles.thumb} />
            ) : (
              <View style={[styles.thumb, styles.thumbPlaceholder]}>
                <Ionicons name="bag-outline" size={32} color="#888" />
              </View>
            )}
            <View style={styles.heroBody}>
              <Text style={styles.title} numberOfLines={2}>
                {offer.storeItem.title}
              </Text>
              <Text style={styles.listPrice}>Listed at {formatPrice(offer.storeItem.priceCents)}</Text>
            </View>
          </View>
        </Pressable>

        <View style={styles.section}>
          <Text style={styles.label}>Status</Text>
          <Text style={styles.value}>{offer.status}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Your offer</Text>
          <Text style={styles.amount}>{formatPrice(offer.amountCents)}</Text>
          {offer.message ? (
            <Text style={styles.note}>&ldquo;{offer.message}&rdquo;</Text>
          ) : null}
        </View>

        {offer.status === "countered" && offer.counterAmountCents != null ? (
          <View style={styles.section}>
            <Text style={styles.label}>Seller counter</Text>
            <Text style={styles.amount}>{formatPrice(offer.counterAmountCents)}</Text>
            {offer.sellerResponse ? (
              <Text style={styles.note}>&ldquo;{offer.sellerResponse}&rdquo;</Text>
            ) : null}
          </View>
        ) : null}

        {offer.status === "accepted" && offer.finalAmountCents != null ? (
          <View style={styles.section}>
            <Text style={styles.label}>Agreed price</Text>
            <Text style={styles.amount}>{formatPrice(offer.finalAmountCents)}</Text>
            {offer.checkoutDeadlineAt ? (
              <Text style={styles.deadline}>
                Checkout by {new Date(offer.checkoutDeadlineAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
              </Text>
            ) : null}
          </View>
        ) : null}

        {isBuyer && offer.status === "countered" ? (
          <View style={styles.actions}>
            <Pressable
              style={({ pressed }) => [styles.btnDecline, pressed && { opacity: 0.85 }]}
              onPress={() => respondCounter("declined")}
              disabled={submitting}
            >
              <Text style={styles.btnDeclineText}>Decline Counter</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.btnAccept, pressed && { opacity: 0.85 }]}
              onPress={() => respondCounter("accepted")}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.btnAcceptText}>Accept Counter & Add to Cart</Text>
              )}
            </Pressable>
          </View>
        ) : null}

        {isBuyer && offer.status === "pending" ? (
          <Text style={styles.hint}>Waiting for the seller to respond.</Text>
        ) : null}

        {isBuyer && offer.status === "accepted" ? (
          <Pressable
            style={({ pressed }) => [styles.btnCart, pressed && { opacity: 0.9 }]}
            onPress={() => (router.push as (h: string) => void)("/cart")}
          >
            <Ionicons name="cart" size={20} color="#fff" />
            <Text style={styles.btnCartText}>Open cart / checkout</Text>
          </Pressable>
        ) : null}

        {isSeller ? (
          <View style={styles.section}>
            <Text style={styles.hint}>
              To accept, decline, or send a counter offer, use Seller Hub offers.
            </Text>
            <Pressable
              style={({ pressed }) => [styles.btnCart, pressed && { opacity: 0.9 }]}
              onPress={() => (router.push as (h: string) => void)("/seller-hub/offers")}
            >
              <Text style={styles.btnCartText}>Go to Seller Hub offers</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingBottom: 10,
    backgroundColor: theme.colors.primary,
    gap: 8,
  },
  backBtn: { padding: 8 },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: "700", color: "#fff" },
  scroll: { padding: 16, paddingBottom: 40 },
  heroRow: { flexDirection: "row", gap: 12, marginBottom: 20 },
  thumb: { width: 88, height: 88, borderRadius: 8, backgroundColor: "#eee" },
  thumbPlaceholder: { alignItems: "center", justifyContent: "center" },
  heroBody: { flex: 1, minWidth: 0 },
  title: { fontSize: 18, fontWeight: "700", color: theme.colors.heading },
  listPrice: { fontSize: 14, color: "#666", marginTop: 4 },
  section: { marginBottom: 16 },
  label: { fontSize: 12, fontWeight: "600", color: "#666", marginBottom: 4 },
  value: { fontSize: 16, color: theme.colors.text, textTransform: "capitalize" },
  amount: { fontSize: 22, fontWeight: "700", color: theme.colors.primary },
  note: { fontSize: 14, color: theme.colors.text, marginTop: 8, fontStyle: "italic" },
  deadline: { fontSize: 13, color: "#92400e", marginTop: 8 },
  hint: { fontSize: 14, color: "#666", marginBottom: 12 },
  actions: { gap: 10, marginTop: 8 },
  btnAccept: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
  },
  btnAcceptText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  btnDecline: {
    borderWidth: 2,
    borderColor: theme.colors.primary,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  btnDeclineText: { color: theme.colors.primary, fontWeight: "600", fontSize: 15 },
  btnCart: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: theme.colors.primary,
    paddingVertical: 14,
    borderRadius: 8,
    marginTop: 8,
  },
  btnCartText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  errorText: { fontSize: 16, color: "#b91c1c", textAlign: "center" },
});
