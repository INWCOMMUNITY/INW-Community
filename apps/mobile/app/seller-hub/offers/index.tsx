import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Image,
  ActivityIndicator,
  RefreshControl,
  Modal,
  TextInput,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { theme } from "@/lib/theme";
import { apiGet, apiPatch } from "@/lib/api";

interface Buyer {
  id: string;
  firstName: string;
  lastName: string;
}

interface StoreItem {
  id: string;
  title: string;
  slug: string;
  priceCents: number;
  photos: string[];
}

interface ResaleOffer {
  id: string;
  amountCents: number;
  counterAmountCents?: number | null;
  message: string | null;
  sellerResponse?: string | null;
  status: string;
  createdAt: string;
  storeItem: StoreItem;
  buyer: Buyer;
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function OfferCard({
  item,
  onRespond,
  onCounter,
  responding,
}: {
  item: ResaleOffer;
  onRespond: (id: string, status: "accepted" | "declined") => void;
  onCounter: (item: ResaleOffer) => void;
  responding: string | null;
}) {
  const router = useRouter();
  const buyerName = `${item.buyer?.firstName ?? ""} ${item.buyer?.lastName ?? ""}`.trim() || "Buyer";
  const isPending = item.status === "pending";
  const busy = responding === item.id;

  return (
    <View style={styles.card}>
      <Pressable
        onPress={() =>
          (router.push as (href: string) => void)(`/product/${item.storeItem?.slug}`)
        }
      >
        <View style={styles.cardRow}>
          {item.storeItem?.photos?.[0] ? (
            <Image source={{ uri: item.storeItem.photos[0] }} style={styles.thumb} />
          ) : (
            <View style={[styles.thumb, styles.thumbPlaceholder]} />
          )}
          <View style={styles.cardBody}>
            <Text style={styles.itemTitle} numberOfLines={2}>
              {item.storeItem?.title ?? "Item"}
            </Text>
            <Text style={styles.buyer}>{buyerName}</Text>
            <Text style={styles.offer}>Offer: {formatPrice(item.amountCents)}</Text>
            {item.message && (
              <Text style={styles.message} numberOfLines={2}>
                &ldquo;{item.message}&rdquo;
              </Text>
            )}
          </View>
        </View>
      </Pressable>
      {isPending && (
        <View style={styles.actions}>
          <Pressable
            style={({ pressed }) => [styles.acceptBtn, pressed && { opacity: 0.8 }]}
            onPress={() => onRespond(item.id, "accepted")}
            disabled={busy}
          >
            {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.btnText}>Accept</Text>}
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.counterBtn, pressed && { opacity: 0.8 }]}
            onPress={() => onCounter(item)}
            disabled={busy}
          >
            <Text style={[styles.btnText, { color: theme.colors.primary }]}>Counter</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.declineBtn, pressed && { opacity: 0.8 }]}
            onPress={() => onRespond(item.id, "declined")}
            disabled={busy}
          >
            <Text style={[styles.btnText, { color: theme.colors.primary }]}>Decline</Text>
          </Pressable>
        </View>
      )}
      {item.status === "countered" && (
        <View style={styles.counteredRow}>
          <Text style={styles.counteredLabel}>Your counter: {formatPrice(item.counterAmountCents ?? 0)}</Text>
          {item.sellerResponse && (
            <Text style={styles.counteredMsg} numberOfLines={2}>&ldquo;{item.sellerResponse}&rdquo;</Text>
          )}
        </View>
      )}
      {!isPending && item.status !== "countered" && <Text style={styles.status}>{item.status}</Text>}
    </View>
  );
}

export default function OffersScreen() {
  const router = useRouter();
  const [offers, setOffers] = useState<ResaleOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [responding, setResponding] = useState<string | null>(null);
  const [counteringOffer, setCounteringOffer] = useState<ResaleOffer | null>(null);
  const [counterAmount, setCounterAmount] = useState("");
  const [counterMessage, setCounterMessage] = useState("");

  const load = useCallback(() => {
    apiGet<ResaleOffer[]>("/api/resale-offers?role=seller")
      .then((data) => setOffers(Array.isArray(data) ? data : []))
      .catch(() => setOffers([]))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleRespond = async (offerId: string, status: "accepted" | "declined") => {
    setResponding(offerId);
    try {
      await apiPatch(`/api/resale-offers/${offerId}`, { status });
      load();
    } catch {
      // error
    } finally {
      setResponding(null);
    }
  };

  const handleCounter = (item: ResaleOffer) => {
    setCounteringOffer(item);
    setCounterAmount((item.amountCents / 100).toFixed(2));
    setCounterMessage("");
  };

  const submitCounter = async () => {
    if (!counteringOffer) return;
    const dollars = parseFloat(counterAmount);
    if (isNaN(dollars) || dollars < 0.01) {
      Alert.alert("Invalid amount", "Enter a valid price (e.g. 25.00)");
      return;
    }
    const cents = Math.round(dollars * 100);
    setResponding(counteringOffer.id);
    try {
      await apiPatch(`/api/resale-offers/${counteringOffer.id}`, {
        status: "countered",
        counterAmountCents: cents,
        sellerResponse: counterMessage.trim() || undefined,
      });
      setCounteringOffer(null);
      setCounterAmount("");
      setCounterMessage("");
      load();
    } catch (e) {
      const err = e as { error?: string };
      Alert.alert("Error", err?.error ?? "Failed to send counter offer");
    } finally {
      setResponding(null);
    }
  };

  const pending = offers.filter((o) => o.status === "pending");
  const countered = offers.filter((o) => o.status === "countered");
  const responded = offers.filter((o) => o.status !== "pending" && o.status !== "countered");

  if (loading && offers.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
      }
    >
      <Text style={styles.title}>New Offers</Text>
      <Text style={styles.hint}>Resale offers on your items.</Text>

      {offers.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No offers yet</Text>
        </View>
      ) : (
        <>
          {pending.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Pending</Text>
              {pending.map((item) => (
                <OfferCard
                  key={item.id}
                  item={item}
                  onRespond={handleRespond}
                  onCounter={handleCounter}
                  responding={responding}
                />
              ))}
            </>
          )}
          {countered.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Countered (awaiting buyer)</Text>
              {countered.map((item) => (
                <OfferCard
                  key={item.id}
                  item={item}
                  onRespond={handleRespond}
                  onCounter={handleCounter}
                  responding={responding}
                />
              ))}
            </>
          )}
          {responded.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Responded</Text>
              {responded.map((item) => (
                <OfferCard
                  key={item.id}
                  item={item}
                  onRespond={handleRespond}
                  onCounter={handleCounter}
                  responding={responding}
                />
              ))}
            </>
          )}
        </>
      )}

      {counteringOffer && (
        <Modal visible transparent animationType="slide">
          <Pressable style={styles.modalBackdrop} onPress={() => setCounteringOffer(null)}>
            <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
              <Text style={styles.modalTitle}>Send counter offer</Text>
              <Text style={styles.modalItem}>{counteringOffer.storeItem?.title}</Text>
              <Text style={styles.modalLabel}>Your counter price ($)</Text>
              <TextInput
                style={styles.modalInput}
                value={counterAmount}
                onChangeText={setCounterAmount}
                keyboardType="decimal-pad"
                placeholder="0.00"
              />
              <Text style={styles.modalLabel}>Message to buyer (optional)</Text>
              <TextInput
                style={[styles.modalInput, styles.modalTextArea]}
                value={counterMessage}
                onChangeText={setCounterMessage}
                placeholder="e.g. That's my best price including shipping"
                multiline
              />
              <View style={styles.modalActions}>
                <Pressable
                  style={({ pressed }) => [styles.modalCancel, pressed && { opacity: 0.8 }]}
                  onPress={() => setCounteringOffer(null)}
                >
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.modalSubmit, pressed && { opacity: 0.8 }]}
                  onPress={submitCounter}
                  disabled={responding === counteringOffer.id}
                >
                  {responding === counteringOffer.id ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.modalSubmitText}>Send counter</Text>
                  )}
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff" },
  title: { fontSize: 20, fontWeight: "700", marginBottom: 8, color: theme.colors.heading },
  hint: { fontSize: 14, color: "#666", marginBottom: 24 },
  empty: { flex: 1, justifyContent: "center", alignItems: "center", paddingVertical: 48 },
  emptyText: { fontSize: 16, color: "#888" },
  sectionTitle: { fontSize: 16, fontWeight: "600", marginTop: 16, marginBottom: 8, color: "#333" },
  card: {
    backgroundColor: "#f9f9f9",
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  cardRow: { flexDirection: "row" },
  thumb: { width: 60, height: 60, borderRadius: 8 },
  thumbPlaceholder: { backgroundColor: "#ddd" },
  cardBody: { flex: 1, marginLeft: 12, justifyContent: "center" },
  itemTitle: { fontSize: 16, fontWeight: "600", color: "#333" },
  buyer: { fontSize: 14, color: "#666", marginTop: 4 },
  offer: { fontSize: 14, color: theme.colors.primary, marginTop: 4 },
  message: { fontSize: 12, color: "#888", marginTop: 4, fontStyle: "italic" },
  actions: { flexDirection: "row", marginTop: 12, gap: 8 },
  acceptBtn: {
    flex: 1,
    backgroundColor: theme.colors.primary,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: "center",
  },
  counterBtn: {
    flex: 1,
    backgroundColor: theme.colors.cream,
    borderWidth: 1,
    borderColor: theme.colors.primary,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: "center",
  },
  declineBtn: {
    flex: 1,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: theme.colors.primary,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: "center",
  },
  btnText: { color: "#fff", fontWeight: "600" },
  counteredRow: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: "#eee" },
  counteredLabel: { fontSize: 14, fontWeight: "600", color: theme.colors.primary },
  counteredMsg: { fontSize: 12, color: "#666", marginTop: 4, fontStyle: "italic" },
  status: { fontSize: 12, color: "#888", marginTop: 8 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: 24,
  },
  modalContent: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
  },
  modalTitle: { fontSize: 18, fontWeight: "700", marginBottom: 12 },
  modalItem: { fontSize: 14, color: "#666", marginBottom: 16 },
  modalLabel: { fontSize: 14, fontWeight: "600", marginBottom: 6 },
  modalInput: {
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 16,
  },
  modalTextArea: { minHeight: 60 },
  modalActions: { flexDirection: "row", gap: 12, justifyContent: "flex-end", marginTop: 8 },
  modalCancel: { paddingVertical: 10, paddingHorizontal: 16 },
  modalCancelText: { color: "#666", fontSize: 16 },
  modalSubmit: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  modalSubmitText: { color: "#fff", fontWeight: "600", fontSize: 16 },
});
