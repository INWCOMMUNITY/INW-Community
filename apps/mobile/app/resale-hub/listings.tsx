import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Image,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPatch, apiDelete } from "@/lib/api";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

function resolveUrl(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
}

interface StoreItem {
  id: string;
  title: string;
  slug: string;
  photos: string[];
  priceCents: number;
  quantity: number;
  status: string;
  category: string | null;
  createdAt: string;
}

export default function ResaleHubListingsScreen() {
  const router = useRouter();
  const [items, setItems] = useState<StoreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const data = await apiGet<StoreItem[] | { error: string }>(
        "/api/store-items?mine=1&listingType=resale"
      );
      const list = Array.isArray(data) ? data : [];
      setItems(list);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const markAsSold = async (id: string) => {
    setActingId(id);
    try {
      await apiPatch(`/api/store-items/${id}`, { status: "sold_out" });
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch (e) {
      const err = e as { error?: string };
      Alert.alert("Error", err.error ?? "Failed to mark as sold");
    } finally {
      setActingId(null);
    }
  };

  const deleteItem = (id: string) => {
    Alert.alert(
      "Remove listing",
      "Remove this listing? This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            setActingId(id);
            try {
              await apiDelete(`/api/store-items/${id}`);
              setItems((prev) => prev.filter((i) => i.id !== id));
            } catch (e) {
              const err = e as { error?: string };
              Alert.alert("Error", err.error ?? "Failed to delete");
            } finally {
              setActingId(null);
            }
          },
        },
      ]
    );
  };

  const openEdit = (id: string) => {
    router.push(`/resale-hub/list?edit=${id}` as never);
  };

  if (loading && items.length === 0) {
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
        <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />
      }
    >
      {items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>You don&apos;t have any resale listings yet.</Text>
          <Pressable
            style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.8 }]}
            onPress={() => router.push("/resale-hub/list")}
          >
            <Text style={styles.addBtnText}>List an item</Text>
          </Pressable>
        </View>
      ) : (
        items.map((item) => (
          <View key={item.id} style={styles.card}>
            <View style={styles.cardRow}>
              <View style={styles.thumbWrap}>
                {item.photos?.length > 0 ? (
                  <Image
                    source={{ uri: resolveUrl(item.photos[0]) ?? item.photos[0] }}
                    style={styles.thumb}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={styles.thumbPlaceholder}>
                    <Ionicons name="image-outline" size={32} color={theme.colors.placeholder} />
                  </View>
                )}
              </View>
              <View style={styles.cardBody}>
                <Text style={styles.title} numberOfLines={2}>
                  {item.title}
                </Text>
                <Text style={styles.price}>
                  ${(item.priceCents / 100).toFixed(2)}
                  {item.quantity > 1 ? ` · Qty ${item.quantity}` : ""}
                </Text>
                {item.category ? (
                  <Text style={styles.category}>{item.category}</Text>
                ) : null}
                <Text style={styles.status}>Status: {item.status === "sold_out" ? "Sold" : item.status}</Text>
              </View>
            </View>
            <View style={styles.actions}>
              <Pressable
                style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.7 }]}
                onPress={() => openEdit(item.id)}
                disabled={actingId !== null}
              >
                <Ionicons name="pencil" size={18} color={theme.colors.primary} />
                <Text style={styles.actionBtnText}>Edit</Text>
              </Pressable>
              {item.status !== "sold_out" && (
                <Pressable
                  style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.7 }]}
                  onPress={() => markAsSold(item.id)}
                  disabled={actingId !== null}
                >
                  {actingId === item.id ? (
                    <ActivityIndicator size="small" color={theme.colors.primary} />
                  ) : (
                    <>
                      <Ionicons name="checkmark-done" size={18} color={theme.colors.primary} />
                      <Text style={styles.actionBtnText}>Mark as sold</Text>
                    </>
                  )}
                </Pressable>
              )}
              <Pressable
                style={({ pressed }) => [styles.actionBtn, styles.deleteBtn, pressed && { opacity: 0.7 }]}
                onPress={() => deleteItem(item.id)}
                disabled={actingId !== null}
              >
                <Ionicons name="trash-outline" size={18} color="#c00" />
                <Text style={[styles.actionBtnText, styles.deleteBtnText]}>Delete</Text>
              </Pressable>
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 16, paddingBottom: 32 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  empty: { paddingVertical: 32, alignItems: "center" },
  emptyText: {
    fontSize: 16,
    color: theme.colors.text,
    marginBottom: 16,
    textAlign: "center",
  },
  addBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  addBtnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  card: {
    borderWidth: 1,
    borderColor: "#eee",
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    backgroundColor: "#fff",
  },
  cardRow: { flexDirection: "row", marginBottom: 12 },
  thumbWrap: { width: 80, height: 80, borderRadius: 8, overflow: "hidden", backgroundColor: "#f0f0f0" },
  thumb: { width: "100%", height: "100%" },
  thumbPlaceholder: {
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
  },
  cardBody: { flex: 1, marginLeft: 12, justifyContent: "center" },
  title: { fontSize: 16, fontWeight: "600", color: theme.colors.heading },
  price: { fontSize: 15, color: theme.colors.text, marginTop: 4 },
  category: { fontSize: 13, color: theme.colors.placeholder, marginTop: 2 },
  status: { fontSize: 13, color: theme.colors.placeholder, marginTop: 2 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  actionBtnText: { fontSize: 14, color: theme.colors.primary },
  deleteBtn: {},
  deleteBtnText: { color: "#c00" },
});
