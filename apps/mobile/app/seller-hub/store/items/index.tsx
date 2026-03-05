import React, { useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  ActivityIndicator,
  Pressable,
  Image,
  RefreshControl,
  Alert,
  Modal,
} from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

interface StoreItem {
  id: string;
  title: string;
  slug: string;
  priceCents: number;
  quantity: number;
  status: string;
  photos: string[];
}

interface ConnectStatus {
  onboarded: boolean;
  chargesEnabled: boolean;
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function MyItemsScreen() {
  const router = useRouter();
  const [items, setItems] = useState<StoreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [connectStatus, setConnectStatus] = useState<ConnectStatus | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [menuItemId, setMenuItemId] = useState<string | null>(null);

  const load = () => {
    setFetchError(null);
    Promise.allSettled([
      apiGet<StoreItem[] | { error: string }>("/api/store-items?mine=1"),
      apiGet<ConnectStatus | { error: string }>("/api/stripe/connect/status"),
    ])
      .then(([itemsResult, statusResult]) => {
        if (itemsResult.status === "fulfilled") {
          const data = itemsResult.value;
          if (Array.isArray(data)) {
            setItems(data);
          } else {
            setFetchError(
              (data as { error?: string })?.error ?? "Failed to load items."
            );
            setItems([]);
          }
        } else {
          setItems([]);
          setFetchError(
            (itemsResult.reason as { error?: string })?.error ??
              "Failed to load items."
          );
        }

        if (statusResult.status === "fulfilled") {
          const data = statusResult.value;
          if (data && "chargesEnabled" in data) {
            setConnectStatus(data as ConnectStatus);
          } else {
            setConnectStatus(null);
          }
        } else {
          setConnectStatus(null);
        }
      })
      .catch(() => {
        setItems([]);
        setConnectStatus(null);
        setFetchError("Connection failed. Check that the server is running.");
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  };

  useFocusEffect(useCallback(() => {
    load();
  }, []));

  const handleOnboard = async () => {
    try {
      const data = await apiPost<{ url?: string; error?: string }>(
        "/api/stripe/connect/onboard",
        { returnBaseUrl: siteBase }
      );
      if (data.url) {
        const webUrl =
          `/web?url=${encodeURIComponent(data.url)}&title=Payment setup` +
          `&successPattern=${encodeURIComponent("seller-hub/store")}` +
          `&successRoute=${encodeURIComponent("/seller-hub/store/payouts")}` +
          "&refreshOnSuccess=1";
        router.push(webUrl as never);
      } else {
        setFetchError(
          data.error ?? "Payment setup failed. Check Stripe configuration."
        );
      }
    } catch (e) {
      setFetchError(
        (e as { error?: string })?.error ?? "Payment setup failed."
      );
    }
  };

  const openEdit = (itemId: string) => {
    router.push(`/seller-hub/store/new?edit=${itemId}` as never);
  };

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
    setMenuItemId(null);
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

  const openMenu = (id: string) => {
    setMenuItemId(id);
  };

  if (loading && items.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.pageTitle}>My Items</Text>
      <View style={styles.header}>
        <View>
          <Text style={styles.hint}>Manage your storefront listings.</Text>
          <Pressable
            onPress={() => router.push("/seller-hub/store/sold")}
            style={({ pressed }) => [styles.soldLink, pressed && { opacity: 0.8 }]}
          >
            <Text style={styles.soldLinkText}>Sold items</Text>
          </Pressable>
        </View>
        <Pressable
          style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.8 }]}
          onPress={() => router.push("/seller-hub/store/new")}
        >
          <Text style={styles.addBtnText}>List an Item</Text>
        </Pressable>
      </View>

      {fetchError && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{fetchError}</Text>
        </View>
      )}

      {connectStatus && !connectStatus.chargesEnabled && (
        <View style={styles.connectBanner}>
          <Text style={styles.connectBannerTitle}>Complete payment setup</Text>
          <Text style={styles.connectBannerText}>
            To list items and receive payments, you need to complete Stripe
            Connect onboarding.
          </Text>
          <Pressable
            style={({ pressed }) => [
              styles.connectBtn,
              pressed && { opacity: 0.8 },
            ]}
            onPress={handleOnboard}
          >
            <Text style={styles.connectBtnText}>Complete payment setup</Text>
          </Pressable>
        </View>
      )}

      {items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            No items yet. Add your first item to start selling.
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
            />
          }
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Pressable
                style={({ pressed }) => [
                  styles.cardMain,
                  pressed && { opacity: 0.9 },
                ]}
                onPress={() => router.push(`/product/${item.slug}` as any)}
              >
                {item.photos?.[0] ? (
                  <Image
                    source={{ uri: item.photos[0] }}
                    style={styles.thumb}
                  />
                ) : (
                  <View style={[styles.thumb, styles.thumbPlaceholder]} />
                )}
                <View style={styles.cardBody}>
                  <Text style={styles.cardTitle} numberOfLines={2}>
                    {item.title}
                  </Text>
                  <Text style={styles.cardPrice}>
                    {formatPrice(item.priceCents)} · {item.quantity} in stock ·{" "}
                    {item.status}
                  </Text>
                </View>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.menuBtn,
                  pressed && { opacity: 0.8 },
                ]}
                onPress={() => openMenu(item.id)}
                disabled={!!actingId}
              >
                <Ionicons name="ellipsis-vertical" size={22} color={theme.colors.heading} />
              </Pressable>
            </View>
          )}
        />
      )}

      <Modal
        visible={!!menuItemId}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuItemId(null)}
      >
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuItemId(null)}>
          <View style={styles.menuPanel} onStartShouldSetResponder={() => true}>
            <Pressable
              style={styles.menuOption}
              onPress={() => {
                if (menuItemId) {
                  openEdit(menuItemId);
                  setMenuItemId(null);
                }
              }}
            >
              <Text style={[styles.menuOptionText, { color: theme.colors.primary }]}>Edit</Text>
            </Pressable>
            <Pressable
              style={styles.menuOption}
              onPress={() => {
                if (menuItemId) {
                  setMenuItemId(null);
                  markAsSold(menuItemId);
                }
              }}
            >
              <Text style={styles.menuOptionTextGreen}>Mark sold</Text>
            </Pressable>
            <Pressable
              style={styles.menuOption}
              onPress={() => menuItemId && deleteItem(menuItemId)}
            >
              <Text style={styles.menuOptionTextRed}>Delete</Text>
            </Pressable>
            <Pressable style={styles.menuOption} onPress={() => setMenuItemId(null)}>
              <Text style={styles.menuOptionText}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff",
  },
  pageTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: theme.colors.heading,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
  },
  hint: { fontSize: 14, color: "#666" },
  soldLink: { marginTop: 4 },
  soldLinkText: { fontSize: 14, fontWeight: "600", color: theme.colors.primary },
  addBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: theme.colors.primary,
    borderRadius: 8,
  },
  addBtnText: { color: "#fff", fontWeight: "600" },
  errorBanner: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    backgroundColor: "#fef2f2",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#fecaca",
  },
  errorText: { fontSize: 14, color: "#b91c1c" },
  connectBanner: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    backgroundColor: "#fffbeb",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#fde68a",
  },
  connectBannerTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#92400e",
    marginBottom: 8,
  },
  connectBannerText: {
    fontSize: 14,
    color: "#92400e",
    marginBottom: 12,
  },
  connectBtn: {
    alignSelf: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: theme.colors.primary,
    borderRadius: 8,
  },
  connectBtnText: { color: "#fff", fontWeight: "600" },
  empty: { flex: 1, padding: 16, justifyContent: "flex-start" },
  emptyText: { fontSize: 14, color: "#666" },
  list: { padding: 16, paddingBottom: 40 },
  card: {
    flexDirection: "row",
    padding: 12,
    backgroundColor: "#f9f9f9",
    borderRadius: 8,
    marginBottom: 12,
    alignItems: "center",
  },
  cardMain: { flex: 1, flexDirection: "row" },
  thumb: { width: 48, height: 48, borderRadius: 8 },
  thumbPlaceholder: { backgroundColor: "#ddd" },
  cardBody: { flex: 1, marginLeft: 12, justifyContent: "center" },
  cardTitle: { fontSize: 16, fontWeight: "600", color: "#333" },
  cardPrice: { fontSize: 12, color: "#666", marginTop: 4 },
  menuBtn: {
    padding: 8,
    marginLeft: 4,
  },
  menuBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  menuPanel: {
    backgroundColor: "#fff",
    borderRadius: 12,
    minWidth: 200,
    paddingVertical: 8,
  },
  menuOption: {
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  menuOptionText: {
    fontSize: 16,
    color: "#333",
  },
  menuOptionTextGreen: {
    fontSize: 16,
    color: "#059669",
    fontWeight: "600",
  },
  menuOptionTextRed: {
    fontSize: 16,
    color: "#dc2626",
    fontWeight: "600",
  },
});
