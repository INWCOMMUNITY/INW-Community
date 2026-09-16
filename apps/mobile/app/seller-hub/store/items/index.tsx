import React, { useState, useCallback, useEffect, useMemo, useLayoutEffect } from "react";
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
  TextInput,
  Platform,
} from "react-native";
import { useRouter, useLocalSearchParams, useNavigation } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import { buildProductPath } from "@/lib/product-referrer";

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
  soldOrderId?: string;
  soldAt?: string;
}

interface ConnectStatus {
  onboarded: boolean;
  chargesEnabled: boolean;
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function resolvePhotoUrl(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
}

const ITEMS_TABS: { key: "active" | "ended" | "sold"; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "ended", label: "Ended" },
  { key: "sold", label: "Sold" },
];

function statusLabel(item: StoreItem): string {
  if (item.status === "sold_out") return "Sold";
  if (item.status === "inactive") return "Ended";
  if (item.quantity <= 0) return "Out of stock";
  return item.status === "active" && item.quantity > 0 ? "Active" : "Ended";
}

export default function MyItemsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ listingType?: string; tab?: string }>();
  const listingType = params.listingType === "resale" ? "resale" : undefined;
  const initialTab =
    params.tab === "sold"
      ? "sold"
      : params.tab === "ended"
        ? "ended"
        : "active";
  const [items, setItems] = useState<StoreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [connectStatus, setConnectStatus] = useState<ConnectStatus | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [menuItemId, setMenuItemId] = useState<string | null>(null);

  type ItemsTab = "active" | "ended" | "sold";
  const [itemsTab, setItemsTab] = useState<ItemsTab>(initialTab);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [tabCounts, setTabCounts] = useState<{
    active: number;
    ended: number;
    sold: number;
  } | null>(null);

  useLayoutEffect(() => {
    const listButton = (
      <Pressable
        onPress={() => router.push("/seller-hub/store/new")}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="List an item"
      >
        <Ionicons name="add" size={32} color="#fff" />
      </Pressable>
    );
    if (Platform.OS === "ios") {
      navigation.setOptions({
        headerRight: undefined,
        unstable_headerRightItems: () => [
          {
            type: "custom",
            element: listButton,
            hidesSharedBackground: true,
          },
        ],
      });
    } else {
      navigation.setOptions({
        unstable_headerRightItems: undefined,
        headerRight: () => listButton,
      });
    }
  }, [navigation, router]);

  const itemsUrl =
    (listingType ? "/api/store-items?mine=1&listingType=resale" : "/api/store-items?mine=1") +
    (itemsTab === "active"
      ? "&filter=active"
      : itemsTab === "ended"
        ? "&filter=ended"
        : "&filter=sold");

  const load = useCallback(() => {
    setFetchError(null);
    Promise.allSettled([
      apiGet<StoreItem[] | { error: string }>(itemsUrl),
      apiGet<ConnectStatus | { error: string }>("/api/stripe/connect/status"),
      apiGet<{
        active?: number;
        ended?: number;
        sold?: number;
      }>("/api/store-items?mine=1&counts=1"),
    ])
      .then(([itemsResult, statusResult, countsResult]) => {
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

        if (countsResult.status === "fulfilled") {
          const data = countsResult.value;
          if (data && typeof data.active === "number") {
            setTabCounts({
              active: data.active,
              ended: Number(data.ended) || 0,
              sold: Number(data.sold) || 0,
            });
          }
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
  }, [itemsUrl]);

  useFocusEffect(useCallback(() => {
    load();
  }, [load]));

  useEffect(() => {
    load();
  }, [itemsTab]);

  useEffect(() => {
    setSelectedIds([]);
  }, [itemsTab]);

  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => items.some((i) => i.id === id)));
  }, [items]);

  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => i.title.toLowerCase().includes(q));
  }, [items, search]);

  const allVisibleSelected =
    visibleItems.length > 0 && visibleItems.every((i) => selectedIds.includes(i.id));

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      const visible = new Set(visibleItems.map((i) => i.id));
      setSelectedIds((prev) => prev.filter((id) => !visible.has(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...visibleItems.map((i) => i.id)])));
    }
  };

  const handleOnboard = async () => {
    try {
      const data = await apiPost<{ url?: string; error?: string }>(
        "/api/stripe/connect/onboard",
        { returnBaseUrl: siteBase, mobileReturnPath: "/seller-hub" }
      );
      if (data.url) {
        const webUrl =
          `/web?url=${encodeURIComponent(data.url)}&title=${encodeURIComponent("Payment setup")}`;
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

  const openListing = (item: StoreItem) => {
    router.push(buildProductPath(item.slug, { type: "my-items" }) as never);
  };

  const markAsSold = async (id: string) => {
    setActingId(id);
    try {
      await apiPatch(`/api/store-items/${id}`, { status: "sold_out" });
      setItems((prev) => prev.filter((i) => i.id !== id));
      Alert.alert(
        "Marked as sold",
        "This item has been moved to Sold Items.",
        [
          { text: "OK" },
          {
            text: "View Sold Items",
            onPress: () => (router.push as (href: string) => void)("/seller-hub/store/items?tab=sold"),
          },
        ]
      );
    } catch (e) {
      const err = e as { error?: string };
      Alert.alert("Error", err.error ?? "Failed to mark as sold");
    } finally {
      setActingId(null);
    }
  };

  const endListing = (id: string) => {
    setMenuItemId(null);
    Alert.alert("End listing", "This will remove the item from your active listings.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "End",
        style: "destructive",
        onPress: async () => {
          setActingId(id);
          try {
            await apiPatch(`/api/store-items/${id}`, { status: "inactive" });
            Alert.alert("Ended", "Listing has been ended.");
            load();
          } catch (e) {
            const err = e as { error?: string };
            Alert.alert("Error", err.error ?? "Failed to end listing");
          } finally {
            setActingId(null);
          }
        },
      },
    ]);
  };

  const confirmMarkAsSold = (id: string) => {
    setMenuItemId(null);
    void markAsSold(id);
  };

  const deleteItem = (id: string) => {
    setMenuItemId(null);
    Alert.alert(
      "Remove listing",
      "This permanently deletes the listing. To keep a record, use Mark as sold instead.",
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
              load();
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

  const relistItem = (id: string) => {
    setMenuItemId(null);
    Alert.alert(
      "Relist item",
      "This will put the item back on sale with a quantity of 1.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Relist",
          onPress: async () => {
            setActingId(id);
            try {
              const res = await apiPost<{ ok: boolean; relisted: number }>(
                "/api/store-items/bulk-relist",
                { storeItemIds: [id], quantity: 1 }
              );
              if (res.ok) {
                Alert.alert("Relisted", "Item is now active again.", [
                  { text: "OK" },
                  { text: "View Active Items", onPress: () => setItemsTab("active") },
                ]);
                load();
              }
            } catch (e) {
              const err = e as { error?: string };
              Alert.alert("Error", err.error ?? "Failed to relist");
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

  const emptyCopy =
    itemsTab === "ended"
      ? { title: "No ended listings", body: "Ended listings stay here for 14 days, then they're removed." }
      : itemsTab === "sold"
        ? { title: "No sold items yet", body: "Sold listings will land here after checkout." }
        : { title: "No items yet", body: "List your first item to start selling." };

  return (
    <View style={styles.container}>
      <View style={styles.tabBar}>
        {ITEMS_TABS.map((t) => {
          const count = tabCounts?.[t.key];
          const active = itemsTab === t.key;
          const showCount = count != null && count > 0;
          return (
            <Pressable
              key={t.key}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => setItemsTab(t.key)}
            >
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{t.label}</Text>
              {showCount ? (
                <View style={[styles.tabCount, active && styles.tabCountActive]}>
                  <Text style={[styles.tabCountText, active && styles.tabCountTextActive]}>{count}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={16} color="#888" />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search titles"
          placeholderTextColor="#888"
          style={styles.searchInput}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
        />
      </View>

      {fetchError && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{fetchError}</Text>
        </View>
      )}

      {(!connectStatus?.onboarded || !connectStatus?.chargesEnabled) && (
        <View style={styles.connectBanner}>
          <Text style={styles.connectBannerTitle}>Complete payment setup</Text>
          <Text style={styles.connectBannerText}>
            Items go live on the store after Stripe Connect is finished.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.connectBtn, pressed && { opacity: 0.8 }]}
            onPress={handleOnboard}
          >
            <Text style={styles.connectBtnText}>Set up payments</Text>
          </Pressable>
        </View>
      )}

      {items.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="cube-outline" size={36} color={theme.colors.gold} />
          <Text style={styles.emptyTitle}>{emptyCopy.title}</Text>
          <Text style={styles.emptyBody}>{emptyCopy.body}</Text>
        </View>
      ) : (
        <FlatList
          data={visibleItems}
          keyExtractor={(i) => i.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
          }
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <Pressable style={styles.selectAllRow} onPress={toggleSelectAll}>
              <Ionicons
                name={allVisibleSelected ? "checkbox" : "square-outline"}
                size={22}
                color={allVisibleSelected ? theme.colors.primary : "#888"}
              />
              <Text style={styles.selectAllText}>
                Select all{selectedIds.length > 0 ? ` · ${selectedIds.length} selected` : ""}
              </Text>
            </Pressable>
          }
          ListEmptyComponent={<Text style={styles.emptyBody}>No items match this search.</Text>}
          renderItem={({ item }) => {
            const selected = selectedIds.includes(item.id);
            const photoUrl = resolvePhotoUrl(item.photos?.[0]);
            const status = statusLabel(item);
            return (
              <View style={[styles.card, selected && styles.cardSelected]}>
                <Pressable onPress={() => toggleSelect(item.id)} style={styles.checkboxHit}>
                  <Ionicons
                    name={selected ? "checkbox" : "square-outline"}
                    size={24}
                    color={selected ? theme.colors.primary : "#888"}
                  />
                </Pressable>
                <Pressable style={styles.cardMain} onPress={() => openListing(item)}>
                  <View style={styles.thumbWrap}>
                    {photoUrl ? (
                      <Image source={{ uri: photoUrl }} style={styles.thumb} resizeMode="cover" />
                    ) : (
                      <View style={[styles.thumb, styles.thumbPlaceholder]} />
                    )}
                    {itemsTab === "sold" && (
                      <View style={styles.soldStamp}>
                        <Text style={styles.soldStampText}>Sold</Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.cardBody}>
                    <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
                    <Text style={styles.cardPrice}>{formatPrice(item.priceCents)}</Text>
                    {itemsTab === "sold" && item.soldAt ? (
                      <Text style={styles.cardMeta}>
                        Sold {new Date(item.soldAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                      </Text>
                    ) : (
                      <View style={styles.chipRow}>
                        <View style={[styles.statusChip, status === "Active" && styles.statusChipActive]}>
                          <Text style={[styles.statusChipText, status === "Active" && styles.statusChipTextActive]}>
                            {status}
                          </Text>
                        </View>
                        <Text style={styles.cardMeta}>{item.quantity} in stock</Text>
                      </View>
                    )}
                    {itemsTab === "sold" && item.soldOrderId && (
                      <Pressable
                        onPress={() => (router.push as (href: string) => void)(`/seller-hub/orders/${item.soldOrderId}`)}
                      >
                        <Text style={styles.viewOrderLink}>View order</Text>
                      </Pressable>
                    )}
                  </View>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.menuBtn, pressed && { opacity: 0.8 }]}
                  onPress={() => openMenu(item.id)}
                  disabled={!!actingId}
                >
                  {actingId === item.id ? (
                    <ActivityIndicator size="small" color={theme.colors.primary} />
                  ) : (
                    <Ionicons name="ellipsis-vertical" size={20} color={theme.colors.heading} />
                  )}
                </Pressable>
              </View>
            );
          }}
        />
      )}

      <Modal visible={!!menuItemId} transparent animationType="fade" onRequestClose={() => setMenuItemId(null)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuItemId(null)}>
          <View style={styles.menuPanel} onStartShouldSetResponder={() => true}>
            {itemsTab === "sold" && items.find((i) => i.id === menuItemId)?.soldOrderId && (
              <Pressable
                style={styles.menuOption}
                onPress={() => {
                  const orderId = items.find((i) => i.id === menuItemId)?.soldOrderId;
                  setMenuItemId(null);
                  if (orderId) (router.push as (href: string) => void)(`/seller-hub/orders/${orderId}`);
                }}
              >
                <Text style={[styles.menuOptionText, { color: theme.colors.primary }]}>View Order</Text>
              </Pressable>
            )}
            {(itemsTab === "sold" || itemsTab === "ended") && menuItemId && (
              <Pressable style={styles.menuOption} onPress={() => relistItem(menuItemId)}>
                <Text style={styles.menuOptionTextGreen}>Relist Item</Text>
              </Pressable>
            )}
            {menuItemId && (
              <>
                <Pressable
                  style={styles.menuOption}
                  onPress={() => {
                    setMenuItemId(null);
                    const menuItem = items.find((i) => i.id === menuItemId);
                    if (menuItem) openListing(menuItem);
                  }}
                >
                  <Text style={[styles.menuOptionText, { color: theme.colors.primary }]}>View Listing</Text>
                </Pressable>
                <Pressable style={styles.menuOption} onPress={() => { openEdit(menuItemId); setMenuItemId(null); }}>
                  <Text style={[styles.menuOptionText, { color: theme.colors.primary }]}>Edit</Text>
                </Pressable>
                <Pressable
                  style={styles.menuOption}
                  onPress={() => {
                    setMenuItemId(null);
                    router.push(`/seller-hub/quantity-history/${menuItemId}` as never);
                  }}
                >
                  <Text style={[styles.menuOptionText, { color: theme.colors.primary }]}>View History</Text>
                </Pressable>
              </>
            )}
            {itemsTab !== "sold" && (
              <Pressable style={styles.menuOption} onPress={() => { if (menuItemId) confirmMarkAsSold(menuItemId); }}>
                <Text style={styles.menuOptionTextGreen}>Mark Sold</Text>
              </Pressable>
            )}
            {itemsTab === "active" && (
              <Pressable style={styles.menuOption} onPress={() => menuItemId && endListing(menuItemId)}>
                <Text style={[styles.menuOptionText, { color: theme.colors.primary }]}>End Listing</Text>
              </Pressable>
            )}
            <Pressable style={styles.menuOption} onPress={() => menuItemId && deleteItem(menuItemId)}>
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
  container: { flex: 1, backgroundColor: theme.colors.pageBackground },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: theme.colors.pageBackground },
  tabBar: { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#e6e0d6", paddingHorizontal: 8 },
  tab: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabActive: { borderBottomColor: theme.colors.primary },
  tabText: { fontSize: 13, fontWeight: "600", color: "#666" },
  tabTextActive: { color: theme.colors.primary },
  tabCount: { minWidth: 18, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 999, backgroundColor: theme.colors.cream, alignItems: "center" },
  tabCountActive: { backgroundColor: theme.colors.primary },
  tabCountText: { fontSize: 10, fontWeight: "700", color: theme.colors.primary },
  tabCountTextActive: { color: "#fff" },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, marginTop: 12, marginBottom: 8, backgroundColor: "#fff", borderWidth: 1, borderColor: "#e6e0d6", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  searchInput: { flex: 1, fontSize: 14, color: theme.colors.heading, padding: 0 },
  errorBanner: { marginHorizontal: 16, marginBottom: 8, padding: 12, backgroundColor: "#fef2f2", borderRadius: 10, borderWidth: 1, borderColor: "#fecaca" },
  errorText: { fontSize: 14, color: "#b91c1c" },
  connectBanner: { marginHorizontal: 16, marginBottom: 8, padding: 12, backgroundColor: "#fffbeb", borderRadius: 10, borderWidth: 1, borderColor: "#fde68a" },
  connectBannerTitle: { fontSize: 14, fontWeight: "700", color: "#92400e", marginBottom: 4 },
  connectBannerText: { fontSize: 13, color: "#92400e", marginBottom: 10 },
  connectBtn: { alignSelf: "flex-start", paddingVertical: 8, paddingHorizontal: 14, backgroundColor: theme.colors.primary, borderRadius: 8 },
  connectBtnText: { color: "#fff", fontWeight: "600", fontSize: 13 },
  empty: { flex: 1, padding: 32, alignItems: "center", justifyContent: "center" },
  emptyTitle: { marginTop: 10, fontSize: 16, fontWeight: "700", color: theme.colors.heading, textAlign: "center" },
  emptyBody: { marginTop: 6, fontSize: 14, color: "#666", textAlign: "center", lineHeight: 20 },
  list: { padding: 16, paddingBottom: 40 },
  selectAllRow: { flexDirection: "row", alignItems: "center", marginBottom: 12, gap: 8 },
  selectAllText: { fontSize: 13, color: "#666", fontWeight: "600" },
  card: { flexDirection: "row", alignItems: "flex-start", backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#e6e0d6", padding: 10, marginBottom: 10 },
  cardSelected: { borderColor: theme.colors.primary, backgroundColor: "#f7f6f2" },
  checkboxHit: { paddingTop: 6, paddingRight: 6 },
  cardMain: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "flex-start", gap: 10 },
  thumbWrap: { width: 72, height: 72, borderRadius: 8, overflow: "hidden", backgroundColor: "#ece8e0" },
  thumb: { width: 72, height: 72 },
  thumbPlaceholder: { backgroundColor: "#ece8e0" },
  soldStamp: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(93, 79, 64, 0.72)", alignItems: "center", justifyContent: "center" },
  soldStampText: { color: "#fff", fontSize: 11, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
  cardBody: { flex: 1, minWidth: 0 },
  cardTitle: { fontSize: 15, fontWeight: "700", color: theme.colors.heading, lineHeight: 20 },
  cardPrice: { marginTop: 3, fontSize: 15, fontWeight: "700", color: theme.colors.earth },
  cardMeta: { fontSize: 12, color: "#666" },
  chipRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  statusChip: { backgroundColor: "#f3f1ed", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  statusChipActive: { backgroundColor: theme.colors.cream },
  statusChipText: { fontSize: 11, fontWeight: "700", color: "#555" },
  statusChipTextActive: { color: theme.colors.earth },
  viewOrderLink: { fontSize: 12, color: theme.colors.primary, marginTop: 6, fontWeight: "700" },
  menuBtn: { padding: 8, marginLeft: 4 },
  menuBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", alignItems: "center", padding: 24 },
  menuPanel: { backgroundColor: "#fff", borderRadius: 12, minWidth: 200, paddingVertical: 8 },
  menuOption: { paddingVertical: 14, paddingHorizontal: 20 },
  menuOptionText: { fontSize: 16, color: "#333" },
  menuOptionTextGreen: { fontSize: 16, color: "#059669", fontWeight: "600" },
  menuOptionTextRed: { fontSize: 16, color: "#dc2626", fontWeight: "600" },
});
