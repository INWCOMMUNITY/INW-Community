import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Pressable,
  RefreshControl,
  Alert,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { theme } from "@/lib/theme";
import { apiGet, apiPatch } from "@/lib/api";

interface Offer {
  id: string;
  amountCents: number;
  message: string | null;
  status: string;
  sellerResponse: string | null;
  createdAt: string;
  storeItem: { id: string; title: string; slug: string; priceCents: number };
  buyer: { id: string; firstName: string; lastName: string };
}

export default function ResaleHubOffersScreen() {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);

  const load = useCallback(() => {
    apiGet<Offer[] | { error: string }>("/api/resale-offers?role=seller")
      .then((data) => setOffers(Array.isArray(data) ? data : []))
      .catch(() => setOffers([]))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const respond = async (offerId: string, status: "accepted" | "declined") => {
    setActingId(offerId);
    try {
      await apiPatch(`/api/resale-offers/${offerId}`, { status });
      setOffers((prev) =>
        prev.map((o) => (o.id === offerId ? { ...o, status } : o))
      );
    } catch (e) {
      const err = e as { error?: string };
      Alert.alert("Error", err.error ?? "Failed to update offer");
    } finally {
      setActingId(null);
    }
  };

  if (loading && offers.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  const pending = offers.filter((o) => o.status === "pending");
  const responded = offers.filter((o) => o.status !== "pending");

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
      }
    >
      <Text style={styles.intro}>
        When buyers make an offer on your resale items, you can accept or decline here.
      </Text>
      {pending.length === 0 && responded.length === 0 ? (
        <Text style={styles.empty}>No pending offers right now.</Text>
      ) : (
        <>
          {pending.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Pending</Text>
              {pending.map((o) => (
                <View key={o.id} style={styles.card}>
                  <Text style={styles.itemTitle}>{o.storeItem.title}</Text>
                  <Text style={styles.amount}>
                    ${(o.amountCents / 100).toFixed(2)} from {o.buyer.firstName} {o.buyer.lastName}
                  </Text>
                  {o.message ? (
                    <Text style={styles.message}>{o.message}</Text>
                  ) : null}
                  <View style={styles.actions}>
                    <Pressable
                      style={({ pressed }) => [styles.acceptBtn, pressed && { opacity: 0.8 }]}
                      onPress={() => respond(o.id, "accepted")}
                      disabled={actingId !== null}
                    >
                      {actingId === o.id ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.acceptBtnText}>Accept</Text>
                      )}
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [styles.declineBtn, pressed && { opacity: 0.8 }]}
                      onPress={() => respond(o.id, "declined")}
                      disabled={actingId !== null}
                    >
                      <Text style={styles.declineBtnText}>Decline</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          )}
          {responded.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Responded</Text>
              {responded.map((o) => (
                <View key={o.id} style={styles.respondedCard}>
                  <Text style={styles.itemTitle}>{o.storeItem.title}</Text>
                  <Text style={styles.respondedText}>
                    ${(o.amountCents / 100).toFixed(2)} from {o.buyer.firstName} {o.buyer.lastName} — {o.status}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff" },
  intro: { fontSize: 14, color: theme.colors.text, marginBottom: 16 },
  empty: { padding: 24, textAlign: "center", color: theme.colors.placeholder },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 18, fontWeight: "600", color: theme.colors.heading, marginBottom: 12 },
  card: {
    padding: 16,
    backgroundColor: "#f9f9f9",
    borderRadius: 8,
    marginBottom: 12,
  },
  itemTitle: { fontSize: 16, fontWeight: "600", color: theme.colors.heading },
  amount: { fontSize: 14, color: theme.colors.text, marginTop: 4 },
  message: { fontSize: 14, color: "#555", marginTop: 8 },
  actions: { flexDirection: "row", gap: 12, marginTop: 12 },
  acceptBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 6,
  },
  acceptBtnText: { color: "#fff", fontWeight: "600" },
  declineBtn: {
    borderWidth: 1,
    borderColor: "#ccc",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 6,
  },
  declineBtnText: { color: theme.colors.text },
  respondedCard: {
    padding: 12,
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
    marginBottom: 8,
  },
  respondedText: { fontSize: 14, color: theme.colors.text },
});
