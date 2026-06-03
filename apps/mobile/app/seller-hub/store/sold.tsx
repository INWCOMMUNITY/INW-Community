import React, { useState, useCallback, useRef } from "react";
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
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPost } from "@/lib/api";
import { alertChannelSyncFailures } from "@/lib/channel-sync-alert";
import { ChannelPublishModal } from "@/components/channels/ChannelPublishModal";
import {
  CHANNEL_PROVIDER_LABEL,
  fetchChannelConnections,
  publishReadyConnections,
  type ChannelConnectionSummary,
  type ChannelProviderId,
} from "@/lib/channel-connections";

const SOLD_ITEMS_VIEWED_KEY = "sellerHubSoldItemsViewedAt";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

interface ChannelLink {
  provider: string;
  syncStatus: string;
  syncEnabled: boolean;
  externalListingId: string;
}

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
  soldOrderId?: string;
  soldAt?: string;
  channelLinks?: ChannelLink[];
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function resolveUrl(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
}

function formatSoldDate(iso: string | undefined): string {
  if (!iso) return "Sold";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "Sold";
  }
}

export default function SoldItemsScreen() {
  const router = useRouter();
  const [items, setItems] = useState<StoreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [menuItemId, setMenuItemId] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [channelConnections, setChannelConnections] = useState<ChannelConnectionSummary[]>([]);
  const [showChannelPublishModal, setShowChannelPublishModal] = useState(false);
  const pendingRelistIdRef = useRef<string | null>(null);

  const load = useCallback(() => {
    setFetchError(null);
    Promise.all([
      apiGet<StoreItem[] | { error: string }>("/api/store-items?mine=1&sold=1"),
      fetchChannelConnections().catch(() => [] as ChannelConnectionSummary[]),
    ])
      .then(([data, connections]) => {
        setChannelConnections(connections);
        if (Array.isArray(data)) {
          setItems(data);
          AsyncStorage.setItem(SOLD_ITEMS_VIEWED_KEY, Date.now().toString()).catch(() => {});
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

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const performRelist = async (id: string, providers: ChannelProviderId[]) => {
    setActingId(id);
    try {
      const res = await apiPost<{
        channelSync?: { provider: string; ok: boolean; error?: string }[];
      }>(`/api/store-items/${id}/relist`, {
        quantity: 1,
        syncToChannels: providers.length > 0,
        channelProviders: providers,
      });
      alertChannelSyncFailures(res.channelSync, "saved");
      setItems((prev) => prev.filter((i) => i.id !== id));
      Alert.alert(
        "Re-listed",
        providers.length > 0
          ? `This item is live on INW and ${providers.map((p) => CHANNEL_PROVIDER_LABEL[p]).join(", ")}.`
          : "This item is live on INW again. Find it under My Items → Active.",
        [
          { text: "OK" },
          {
            text: "My Items",
            onPress: () => (router.push as (href: string) => void)("/seller-hub/store/items"),
          },
        ]
      );
    } catch (e) {
      const err = e as { error?: string };
      Alert.alert("Error", err.error ?? "Could not re-list this item.");
    } finally {
      setActingId(null);
    }
  };

  const confirmRelist = (id: string) => {
    setMenuItemId(null);
    Alert.alert(
      "Re-list item?",
      "This puts the item back on your INW storefront with quantity 1. Edit the listing to change stock or details.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Re-list",
          onPress: () => {
            if (publishReadyConnections(channelConnections).length > 0) {
              pendingRelistIdRef.current = id;
              setShowChannelPublishModal(true);
              return;
            }
            void performRelist(id, []);
          },
        },
      ]
    );
  };

  const handleChannelPublishConfirm = (providers: ChannelProviderId[]) => {
    setShowChannelPublishModal(false);
    const id = pendingRelistIdRef.current;
    pendingRelistIdRef.current = null;
    if (!id) return;
    void performRelist(id, providers);
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
      <ChannelPublishModal
        visible={showChannelPublishModal}
        onClose={() => {
          setShowChannelPublishModal(false);
          pendingRelistIdRef.current = null;
        }}
        onConfirm={handleChannelPublishConfirm}
      />
      <Text style={styles.pageTitle}>Sold Items</Text>
      <Text style={styles.hint}>
        Items you’ve sold. Re-list to put them back on your storefront (and connected stores).
      </Text>

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
            <View style={styles.card}>
              <Pressable
                style={({ pressed }) => [styles.cardMain, pressed && { opacity: 0.9 }]}
                onPress={() =>
                  item.soldOrderId
                    ? router.push(`/seller-hub/orders/${item.soldOrderId}` as never)
                    : router.push(`/product/${item.slug}` as never)
                }
              >
                <View style={styles.thumbWrap}>
                  {item.photos?.[0] ? (
                    <Image
                      source={{ uri: resolveUrl(item.photos[0]) ?? item.photos[0] }}
                      style={styles.thumb}
                    />
                  ) : (
                    <View style={[styles.thumb, styles.thumbPlaceholder]} />
                  )}
                  <View style={styles.soldBadge}>
                    <Text style={styles.soldBadgeText}>SOLD</Text>
                  </View>
                </View>
                <View style={styles.cardBody}>
                  <Text style={styles.cardTitle} numberOfLines={2}>
                    {item.title}
                  </Text>
                  <Text style={styles.cardMeta}>
                    {formatPrice(item.priceCents)}
                    {item.soldAt ? ` · Sold on ${formatSoldDate(item.soldAt)}` : " · Sold"}
                  </Text>
                  {item.soldOrderId ? (
                    <Text style={styles.viewOrderLink}>View order</Text>
                  ) : null}
                </View>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.menuBtn, pressed && { opacity: 0.8 }]}
                onPress={() => setMenuItemId(item.id)}
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
            {menuItemId && items.find((i) => i.id === menuItemId)?.soldOrderId && (
              <Pressable
                style={styles.menuOption}
                onPress={() => {
                  const orderId = items.find((i) => i.id === menuItemId)?.soldOrderId;
                  setMenuItemId(null);
                  if (orderId) {
                    (router.push as (href: string) => void)(`/seller-hub/orders/${orderId}`);
                  }
                }}
              >
                <Text style={[styles.menuOptionText, { color: theme.colors.primary }]}>
                  View order
                </Text>
              </Pressable>
            )}
            <Pressable
              style={styles.menuOption}
              onPress={() => menuItemId && confirmRelist(menuItemId)}
            >
              <Text style={[styles.menuOptionText, { color: theme.colors.primary }]}>
                Re-list on INW
              </Text>
            </Pressable>
            <Pressable
              style={styles.menuOption}
              onPress={() => {
                if (menuItemId) {
                  setMenuItemId(null);
                  router.push(`/seller-hub/store/new?edit=${menuItemId}` as never);
                }
              }}
            >
              <Text style={styles.menuOptionText}>Edit before re-listing</Text>
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
  cardMain: { flex: 1, flexDirection: "row", alignItems: "center" },
  menuBtn: { padding: 8, marginLeft: 4 },
  thumbWrap: { position: "relative", width: 48, height: 48 },
  thumb: { width: 48, height: 48, borderRadius: 8 },
  thumbPlaceholder: { backgroundColor: "#ddd" },
  soldBadge: {
    position: "absolute",
    inset: 0,
    borderRadius: 8,
    backgroundColor: "rgba(220, 38, 38, 0.9)",
    justifyContent: "center",
    alignItems: "center",
  },
  soldBadgeText: { fontSize: 10, fontWeight: "700", color: "#fff", letterSpacing: 0.5 },
  cardBody: { flex: 1, marginLeft: 12, justifyContent: "center" },
  cardTitle: { fontSize: 16, fontWeight: "600", color: "#333" },
  cardMeta: { fontSize: 12, color: "#666", marginTop: 4 },
  viewOrderLink: { fontSize: 12, color: theme.colors.primary, marginTop: 2, fontWeight: "600" },
  menuBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  menuPanel: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    paddingBottom: 24,
  },
  menuOption: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#eee",
  },
  menuOptionText: { fontSize: 16, color: "#333" },
});
