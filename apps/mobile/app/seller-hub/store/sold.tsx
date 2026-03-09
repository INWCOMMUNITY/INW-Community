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
} from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { theme } from "@/lib/theme";
import { apiGet } from "@/lib/api";

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
  listingType: string | null;
  createdAt?: string;
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function resolveUrl(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
}

export default function SoldItemsScreen() {
  const router = useRouter();
  const [items, setItems] = useState<StoreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const load = useCallback(() => {
    setFetchError(null);
    apiGet<StoreItem[] | { error: string }>("/api/store-items?mine=1&sold=1")
      .then((data) => {
        if (Array.isArray(data)) {
          setItems(data);
        } else {
          setFetchError((data as { error?: string })?.error ?? "Failed to load.");
          setItems([]);
        }
      })
      .catch(() => {
        setItems([]);
        setFetchError("Failed to load sold items.");
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, []);

  useFocusEffect(useCallback(() => {
    load();
  }, [load]));

  if (loading && items.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.pageTitle}>Sold Items</Text>
      <Text style={styles.hint}>Items you’ve sold — they no longer appear in My Items (storefront and resale).</Text>

      {fetchError && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{fetchError}</Text>
        </View>
      )}

      {items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No sold items yet.</Text>
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
            <Pressable
              style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
              onPress={() => router.push(`/product/${item.slug}` as never)}
            >
              {item.photos?.[0] ? (
                <Image
                  source={{ uri: resolveUrl(item.photos[0]) ?? item.photos[0] }}
                  style={styles.thumb}
                />
              ) : (
                <View style={[styles.thumb, styles.thumbPlaceholder]} />
              )}
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle} numberOfLines={2}>
                  {item.title}
                </Text>
                <Text style={styles.cardMeta}>
                  {formatPrice(item.priceCents)} · Sold
                </Text>
              </View>
            </Pressable>
          )}
        />
      )}
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
    paddingBottom: 4,
  },
  hint: {
    fontSize: 14,
    color: "#666",
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
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
  thumb: { width: 48, height: 48, borderRadius: 8 },
  thumbPlaceholder: { backgroundColor: "#ddd" },
  cardBody: { flex: 1, marginLeft: 12, justifyContent: "center" },
  cardTitle: { fontSize: 16, fontWeight: "600", color: "#333" },
  cardMeta: { fontSize: 12, color: "#666", marginTop: 4 },
});
