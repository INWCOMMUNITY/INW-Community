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
import { getDrafts, deleteDraft, type StoreItemDraft } from "@/lib/drafts";
import { useCreatePost } from "@/contexts/CreatePostContext";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

type ListingChannelId = "inw" | "shopify" | "ebay" | "etsy";

const CHANNEL_LABELS: Record<ListingChannelId, string> = {
  inw: "INW",
  shopify: "Shopify",
  ebay: "eBay",
  etsy: "Etsy",
};

function formatListedOn(channels?: ListingChannelId[]): string {
  const rest = new Set<ListingChannelId>();
  for (const id of channels ?? []) {
    if (id !== "inw") rest.add(id);
  }
  return ["inw", ...rest]
    .map((id) => CHANNEL_LABELS[id])
    .join(", ");
}

interface StoreItem {
  id: string;
  title: string;
  slug: string;
  sku?: string | null;
  priceCents: number;
  quantity: number;
  status: string;
  photos: string[];
  views30d?: number;
  soldOrderId?: string;
  soldAt?: string;
  channels?: ListingChannelId[];
}

interface ConnectStatus {
  onboarded: boolean;
  chargesEnabled: boolean;
}

type ItemsTab = "active" | "ended" | "sold" | "drafts";

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function resolvePhotoUrl(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
}

const ITEMS_TABS: { key: ItemsTab; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "ended", label: "Ended" },
  { key: "sold", label: "Sold" },
  { key: "drafts", label: "Drafts" },
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
  const createPost = useCreatePost();
  const params = useLocalSearchParams<{ listingType?: string; tab?: string }>();
  const listingType = params.listingType === "resale" ? "resale" : undefined;
  const initialTab: ItemsTab =
    params.tab === "sold"
      ? "sold"
      : params.tab === "ended"
        ? "ended"
        : params.tab === "drafts"
          ? "drafts"
          : "active";
  const [items, setItems] = useState<StoreItem[]>([]);
  const [drafts, setDrafts] = useState<StoreItemDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [connectStatus, setConnectStatus] = useState<ConnectStatus | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [bulkActing, setBulkActing] = useState(false);
  const [menuItemId, setMenuItemId] = useState<string | null>(null);
  const [itemsTab, setItemsTab] = useState<ItemsTab>(initialTab);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [tabCounts, setTabCounts] = useState<{
    active: number;
    ended: number;
    sold: number;
    drafts: number;
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
        : itemsTab === "sold"
          ? "&filter=sold"
          : "");

  const load = useCallback(() => {
    setFetchError(null);
    if (itemsTab === "drafts") {
      Promise.all([
        getDrafts(),
        apiGet<ConnectStatus | { error: string }>("/api/stripe/connect/status").catch(() => null),
        apiGet<{ active?: number; ended?: number; sold?: number }>(
          "/api/store-items?mine=1&counts=1"
        ).catch(() => null),
      ])
        .then(([draftList, statusData, countsData]) => {
          setDrafts(draftList);
          setItems([]);
          if (statusData && "chargesEnabled" in statusData) {
            setConnectStatus(statusData as ConnectStatus);
          }
          setTabCounts({
            active: Number(countsData?.active) || 0,
            ended: Number(countsData?.ended) || 0,
            sold: Number(countsData?.sold) || 0,
            drafts: draftList.length,
          });
        })
        .finally(() => {
          setLoading(false);
          setRefreshing(false);
        });
      return;
    }

    Promise.allSettled([
      apiGet<StoreItem[] | { error: string }>(itemsUrl),
      apiGet<ConnectStatus | { error: string }>("/api/stripe/connect/status"),
      apiGet<{ active?: number; ended?: number; sold?: number }>(
        "/api/store-items?mine=1&counts=1"
      ),
      getDrafts(),
    ])
      .then(([itemsResult, statusResult, countsResult, draftsResult]) => {
        const draftList = draftsResult.status === "fulfilled" ? draftsResult.value : [];
        if (itemsResult.status === "fulfilled") {
          const data = itemsResult.value;
          if (Array.isArray(data)) {
            setItems(data);
          } else {
            setFetchError((data as { error?: string })?.error ?? "Failed to load items.");
            setItems([]);
          }
        } else {
          setItems([]);
          setFetchError(
            (itemsResult.reason as { error?: string })?.error ?? "Failed to load items."
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

        const counts =
          countsResult.status === "fulfilled" ? countsResult.value : null;
        setTabCounts({
          active: Number(counts?.active) || 0,
          ended: Number(counts?.ended) || 0,
          sold: Number(counts?.sold) || 0,
          drafts: draftList.length,
        });
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
  }, [itemsUrl, itemsTab]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

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
    return items.filter(
      (i) =>
        i.title.toLowerCase().includes(q) ||
        (i.sku ?? "").toLowerCase().includes(q)
    );
  }, [items, search]);

  const visibleDrafts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return drafts;
    return drafts.filter((d) => (d.title || "Untitled").toLowerCase().includes(q));
  }, [drafts, search]);

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
        const webUrl = `/web?url=${encodeURIComponent(data.url)}&title=${encodeURIComponent("Payment setup")}`;
        router.push(webUrl as never);
      } else {
        setFetchError(data.error ?? "Payment setup failed. Check Stripe configuration.");
      }
    } catch (e) {
      setFetchError((e as { error?: string })?.error ?? "Payment setup failed.");
    }
  };

  const openEdit = (itemId: string) => {
    router.push(`/seller-hub/store/new?edit=${itemId}` as never);
  };

  const openSimilar = (itemId: string) => {
    router.push(`/seller-hub/store/new?similar=${itemId}` as never);
  };

  const openListing = (item: StoreItem) => {
    router.push(buildProductPath(item.slug, { type: "my-items" }) as never);
  };

  const endListings = (ids: string[]) => {
    Alert.alert(
      ids.length === 1 ? "End listing" : "End listings",
      `Remove ${ids.length} listing${ids.length === 1 ? "" : "s"} from your active items?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "End",
          style: "destructive",
          onPress: async () => {
            setBulkActing(true);
            try {
              if (ids.length === 1) {
                await apiPatch(`/api/store-items/${ids[0]}`, { status: "inactive" });
              } else {
                await apiDelete("/api/store-items/bulk", { storeItemIds: ids });
              }
              setSelectedIds([]);
              Alert.alert("Ended", "Listing(s) moved to Ended.");
              load();
            } catch (e) {
              Alert.alert("Error", (e as { error?: string }).error ?? "Failed to end listing");
            } finally {
              setBulkActing(false);
            }
          },
        },
      ]
    );
  };

  const relistItems = (ids: string[]) => {
    Alert.alert(
      ids.length === 1 ? "Relist item" : "Relist items",
      `Put ${ids.length} item${ids.length === 1 ? "" : "s"} back on sale with quantity 1?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Relist",
          onPress: async () => {
            setBulkActing(true);
            try {
              const res = await apiPost<{ ok: boolean; relisted: number }>(
                "/api/store-items/bulk-relist",
                { storeItemIds: ids, quantity: 1 }
              );
              if (res.ok) {
                setSelectedIds([]);
                Alert.alert("Relisted", `${res.relisted} item${res.relisted === 1 ? "" : "s"} active again.`, [
                  { text: "OK" },
                  { text: "View Active", onPress: () => setItemsTab("active") },
                ]);
                load();
              }
            } catch (e) {
              Alert.alert("Error", (e as { error?: string }).error ?? "Failed to relist");
            } finally {
              setBulkActing(false);
            }
          },
        },
      ]
    );
  };

  const shareToFeed = (ids: string[]) => {
    if (ids.length === 0) return;
    setMenuItemId(null);
    if (createPost?.openShareListingsToFeed) {
      createPost.openShareListingsToFeed(ids);
      setSelectedIds([]);
      return;
    }
    Alert.alert("Share to feed", "Open Community to share with a caption and tags.");
  };

  const deleteItem = (id: string) => {
    setMenuItemId(null);
    Alert.alert(
      "Remove listing",
      "This ends the listing and removes it from the storefront. You can relist it later from Ended.",
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
              Alert.alert("Error", (e as { error?: string }).error ?? "Failed to delete");
            } finally {
              setActingId(null);
            }
          },
        },
      ]
    );
  };

  const removeDraft = (draft: StoreItemDraft) => {
    Alert.alert("Delete draft?", `Remove "${draft.title || "Untitled"}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await deleteDraft(draft.id);
          setDrafts((prev) => prev.filter((d) => d.id !== draft.id));
          setTabCounts((prev) =>
            prev ? { ...prev, drafts: Math.max(0, prev.drafts - 1) } : prev
          );
        },
      },
    ]);
  };

  if (loading && items.length === 0 && drafts.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  const emptyCopy =
    itemsTab === "ended"
      ? { title: "No ended listings", body: "Ended listings stay here so you can relist them." }
      : itemsTab === "sold"
        ? { title: "No sold items yet", body: "Sold listings will land here after checkout." }
        : itemsTab === "drafts"
          ? { title: "No drafts yet", body: "Save a draft while listing to finish it later." }
          : { title: "No items yet", body: "List your first item to start selling." };

  const showBulkBar = itemsTab !== "drafts" && selectedIds.length > 0;

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
              <Text style={[styles.tabText, active && styles.tabTextActive]} numberOfLines={1}>
                {t.label}
              </Text>
              {showCount ? (
                <View style={[styles.tabCount, active && styles.tabCountActive]}>
                  <Text style={[styles.tabCountText, active && styles.tabCountTextActive]}>
                    {count}
                  </Text>
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
          placeholder={itemsTab === "drafts" ? "Search drafts" : "Search title or SKU"}
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

      {(!connectStatus?.onboarded || !connectStatus?.chargesEnabled) && itemsTab !== "drafts" && (
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

      {itemsTab === "drafts" ? (
        visibleDrafts.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="document-outline" size={36} color={theme.colors.gold} />
            <Text style={styles.emptyTitle}>{emptyCopy.title}</Text>
            <Text style={styles.emptyBody}>{emptyCopy.body}</Text>
          </View>
        ) : (
          <FlatList
            data={visibleDrafts}
            keyExtractor={(d) => d.id}
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
            renderItem={({ item }) => {
              const photoUrl = resolvePhotoUrl(item.photos?.[0]);
              return (
                <View style={styles.card}>
                  <Pressable
                    style={styles.cardMain}
                    onPress={() =>
                      router.push(`/seller-hub/store/new?draftId=${item.id}` as never)
                    }
                  >
                    <View style={styles.thumbWrap}>
                      {photoUrl ? (
                        <Image source={{ uri: photoUrl }} style={styles.thumb} resizeMode="cover" />
                      ) : (
                        <View style={[styles.thumb, styles.thumbPlaceholder]} />
                      )}
                    </View>
                    <View style={styles.cardBody}>
                      <Text style={styles.cardTitle} numberOfLines={2}>
                        {item.title || "Untitled draft"}
                      </Text>
                      <Text style={styles.cardMeta}>
                        Saved{" "}
                        {new Date(item.savedAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                      </Text>
                    </View>
                  </Pressable>
                  <Pressable style={styles.menuBtn} onPress={() => removeDraft(item)}>
                    <Ionicons name="trash-outline" size={20} color="#dc2626" />
                  </Pressable>
                </View>
              );
            }}
          />
        )
      ) : items.length === 0 ? (
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
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
            />
          }
          contentContainerStyle={[styles.list, showBulkBar && { paddingBottom: 96 }]}
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
            const views = item.views30d ?? 0;
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
                    <Text style={styles.cardTitle} numberOfLines={2}>
                      {item.title}
                    </Text>
                    <Text style={styles.cardPrice}>{formatPrice(item.priceCents)}</Text>
                    {itemsTab === "sold" && item.soldAt ? (
                      <Text style={styles.cardMeta}>
                        Sold{" "}
                        {new Date(item.soldAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </Text>
                    ) : (
                      <View style={styles.chipRow}>
                        <View
                          style={[styles.statusChip, status === "Active" && styles.statusChipActive]}
                        >
                          <Text
                            style={[
                              styles.statusChipText,
                              status === "Active" && styles.statusChipTextActive,
                            ]}
                          >
                            {status}
                          </Text>
                        </View>
                        <Text style={styles.cardMeta}>{item.quantity} in stock</Text>
                      </View>
                    )}
                    <Text style={styles.viewsMeta}>
                      Listed on: {formatListedOn(item.channels)}
                    </Text>
                    <Text style={styles.viewsMeta}>
                      {views} view{views === 1 ? "" : "s"} (30d)
                    </Text>
                    {(itemsTab === "ended" || itemsTab === "sold") && (
                      <Pressable
                        style={styles.relistChip}
                        onPress={() => relistItems([item.id])}
                      >
                        <Text style={styles.relistChipText}>Relist</Text>
                      </Pressable>
                    )}
                    {itemsTab === "sold" && item.soldOrderId && (
                      <Pressable
                        onPress={() =>
                          (router.push as (href: string) => void)(
                            `/seller-hub/orders/${item.soldOrderId}`
                          )
                        }
                      >
                        <Text style={styles.viewOrderLink}>View order</Text>
                      </Pressable>
                    )}
                  </View>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.menuBtn, pressed && { opacity: 0.8 }]}
                  onPress={() => setMenuItemId(item.id)}
                  disabled={!!actingId || bulkActing}
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

      {showBulkBar ? (
        <View style={styles.bulkBar}>
          <Text style={styles.bulkBarLabel}>{selectedIds.length} selected</Text>
          <View style={styles.bulkActions}>
            {(itemsTab === "ended" || itemsTab === "sold") && (
              <Pressable
                style={styles.bulkBtn}
                disabled={bulkActing}
                onPress={() => relistItems(selectedIds)}
              >
                <Text style={styles.bulkBtnText}>Relist</Text>
              </Pressable>
            )}
            {itemsTab === "active" && (
              <>
                <Pressable
                  style={styles.bulkBtn}
                  disabled={bulkActing}
                  onPress={() => endListings(selectedIds)}
                >
                  <Text style={styles.bulkBtnText}>End</Text>
                </Pressable>
                <Pressable
                  style={styles.bulkBtn}
                  disabled={bulkActing}
                  onPress={() => shareToFeed(selectedIds)}
                >
                  <Text style={styles.bulkBtnText}>Share</Text>
                </Pressable>
              </>
            )}
            <Pressable
              style={styles.bulkBtn}
              disabled={bulkActing}
              onPress={() =>
                Alert.alert("Manage 3rd Parties", "Coming soon — tell us what this should do next.")
              }
            >
              <Text style={styles.bulkBtnText}>Manage 3rd Parties</Text>
            </Pressable>
            {selectedIds.length === 1 && (
              <Pressable
                style={styles.bulkBtn}
                disabled={bulkActing}
                onPress={() => openSimilar(selectedIds[0])}
              >
                <Text style={styles.bulkBtnText}>Similar</Text>
              </Pressable>
            )}
          </View>
        </View>
      ) : null}

      <Modal
        visible={!!menuItemId}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuItemId(null)}
      >
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuItemId(null)}>
          <View style={styles.menuPanel} onStartShouldSetResponder={() => true}>
            {itemsTab === "sold" &&
              items.find((i) => i.id === menuItemId)?.soldOrderId && (
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
                    View Order
                  </Text>
                </Pressable>
              )}
            {(itemsTab === "sold" || itemsTab === "ended") && menuItemId && (
              <Pressable
                style={styles.menuOption}
                onPress={() => {
                  const id = menuItemId;
                  setMenuItemId(null);
                  relistItems([id]);
                }}
              >
                <Text style={styles.menuOptionTextGreen}>Relist Item</Text>
              </Pressable>
            )}
            {menuItemId && (
              <>
                <Pressable
                  style={styles.menuOption}
                  onPress={() => {
                    const menuItem = items.find((i) => i.id === menuItemId);
                    setMenuItemId(null);
                    if (menuItem) openListing(menuItem);
                  }}
                >
                  <Text style={[styles.menuOptionText, { color: theme.colors.primary }]}>
                    View Listing
                  </Text>
                </Pressable>
                <Pressable
                  style={styles.menuOption}
                  onPress={() => {
                    openEdit(menuItemId);
                    setMenuItemId(null);
                  }}
                >
                  <Text style={[styles.menuOptionText, { color: theme.colors.primary }]}>Edit</Text>
                </Pressable>
                <Pressable
                  style={styles.menuOption}
                  onPress={() => {
                    openSimilar(menuItemId);
                    setMenuItemId(null);
                  }}
                >
                  <Text style={[styles.menuOptionText, { color: theme.colors.primary }]}>
                    Sell Similar
                  </Text>
                </Pressable>
                <Pressable
                  style={styles.menuOption}
                  onPress={() => {
                    setMenuItemId(null);
                    router.push(`/seller-hub/quantity-history/${menuItemId}` as never);
                  }}
                >
                  <Text style={[styles.menuOptionText, { color: theme.colors.primary }]}>
                    View History
                  </Text>
                </Pressable>
              </>
            )}
            {itemsTab === "active" && (
              <Pressable
                style={styles.menuOption}
                onPress={() => {
                  if (menuItemId) {
                    setMenuItemId(null);
                    endListings([menuItemId]);
                  }
                }}
              >
                <Text style={[styles.menuOptionText, { color: theme.colors.primary }]}>
                  End Listing
                </Text>
              </Pressable>
            )}
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
  container: { flex: 1, backgroundColor: theme.colors.pageBackground },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: theme.colors.pageBackground,
  },
  tabBar: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e6e0d6",
    paddingHorizontal: 4,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabActive: { borderBottomColor: theme.colors.primary },
  tabText: { fontSize: 12, fontWeight: "600", color: "#666" },
  tabTextActive: { color: theme.colors.primary },
  tabCount: {
    minWidth: 16,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 999,
    backgroundColor: theme.colors.cream,
    alignItems: "center",
  },
  tabCountActive: { backgroundColor: theme.colors.primary },
  tabCountText: { fontSize: 10, fontWeight: "700", color: theme.colors.primary },
  tabCountTextActive: { color: "#fff" },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e6e0d6",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  searchInput: { flex: 1, fontSize: 14, color: theme.colors.heading, padding: 0 },
  errorBanner: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 12,
    backgroundColor: "#fef2f2",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#fecaca",
  },
  errorText: { fontSize: 14, color: "#b91c1c" },
  connectBanner: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 12,
    backgroundColor: "#fffbeb",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#fde68a",
  },
  connectBannerTitle: { fontSize: 14, fontWeight: "700", color: "#92400e", marginBottom: 4 },
  connectBannerText: { fontSize: 13, color: "#92400e", marginBottom: 10 },
  connectBtn: {
    alignSelf: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: theme.colors.primary,
    borderRadius: 8,
  },
  connectBtnText: { color: "#fff", fontWeight: "600", fontSize: 13 },
  empty: { flex: 1, padding: 32, alignItems: "center", justifyContent: "center" },
  emptyTitle: {
    marginTop: 10,
    fontSize: 16,
    fontWeight: "700",
    color: theme.colors.heading,
    textAlign: "center",
  },
  emptyBody: { marginTop: 6, fontSize: 14, color: "#666", textAlign: "center", lineHeight: 20 },
  list: { padding: 16, paddingBottom: 40 },
  selectAllRow: { flexDirection: "row", alignItems: "center", marginBottom: 12, gap: 8 },
  selectAllText: { fontSize: 13, color: "#666", fontWeight: "600" },
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e6e0d6",
    padding: 10,
    marginBottom: 10,
  },
  cardSelected: { borderColor: theme.colors.primary, backgroundColor: "#f7f6f2" },
  checkboxHit: { paddingTop: 6, paddingRight: 6 },
  cardMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  thumbWrap: {
    width: 72,
    height: 72,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#ece8e0",
  },
  thumb: { width: 72, height: 72 },
  thumbPlaceholder: { backgroundColor: "#ece8e0" },
  soldStamp: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(93, 79, 64, 0.72)",
    alignItems: "center",
    justifyContent: "center",
  },
  soldStampText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  cardBody: { flex: 1, minWidth: 0 },
  cardTitle: { fontSize: 15, fontWeight: "700", color: theme.colors.heading, lineHeight: 20 },
  cardPrice: { marginTop: 3, fontSize: 15, fontWeight: "700", color: theme.colors.earth },
  cardMeta: { fontSize: 12, color: "#666" },
  viewsMeta: { marginTop: 4, fontSize: 12, color: "#888" },
  chipRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  statusChip: {
    backgroundColor: "#f3f1ed",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusChipActive: { backgroundColor: theme.colors.cream },
  statusChipText: { fontSize: 11, fontWeight: "700", color: "#555" },
  statusChipTextActive: { color: theme.colors.earth },
  relistChip: {
    alignSelf: "flex-start",
    marginTop: 8,
    backgroundColor: theme.colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  relistChipText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  viewOrderLink: { fontSize: 12, color: theme.colors.primary, marginTop: 6, fontWeight: "700" },
  menuBtn: { padding: 8, marginLeft: 4 },
  menuBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  menuPanel: { backgroundColor: "#fff", borderRadius: 12, minWidth: 200, paddingVertical: 8 },
  menuOption: { paddingVertical: 14, paddingHorizontal: 20 },
  menuOptionText: { fontSize: 16, color: "#333" },
  menuOptionTextGreen: { fontSize: 16, color: "#059669", fontWeight: "600" },
  menuOptionTextRed: { fontSize: 16, color: "#dc2626", fontWeight: "600" },
  bulkBar: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    backgroundColor: theme.colors.pageBackground,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: "#e6e0d6",
  },
  bulkBarLabel: { color: theme.colors.heading, fontSize: 12, fontWeight: "600" },
  bulkActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  bulkBtn: {
    backgroundColor: theme.colors.earth,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  bulkBtnText: { color: "#fff", fontSize: 13, fontWeight: "700" },
});
