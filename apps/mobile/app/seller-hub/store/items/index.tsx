import React, { useState, useCallback, useEffect } from "react";
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
import { useRouter, useLocalSearchParams } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import { alertChannelPublishResult, alertChannelSyncFailures } from "@/lib/channel-sync-alert";
import { EbayConditionFixModal } from "@/components/channels/EbayConditionFixModal";
import { ListOnChannelCategoryModal } from "@/components/channels/ListOnChannelCategoryModal";
import {
  isListOnCategoryProvider,
  itemNeedsListOnCategoryStep,
  type ListOnCategoryAssignment,
  type ListOnCategoryProvider,
} from "@/lib/list-on-channel-category";
import { isEbayConditionSyncError } from "@/lib/ebay-condition-sync";
import { buildProductPath } from "@/lib/product-referrer";
import { QualityScoreBadge } from "@/components/listing/QualityScoreBadge";
import { BulkActionsBar } from "@/components/seller/BulkActionsBar";
import { BulkDestinationGridModal } from "@/components/seller/BulkDestinationGridModal";
import {
  CHANNEL_PROVIDER_LABEL,
  channelNotReadyHint,
  fetchChannelConnections,
  listOnConnections,
  type ChannelConnectionSummary,
  type ChannelProviderId,
} from "@/lib/channel-connections";
import {
  endOnInwConfirm,
  endOnInwResult,
  summarizeBulkDestinations,
  type BulkDestinationsResultCounts,
} from "@/lib/store-item-bulk-destinations";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

interface ChannelLink {
  provider: string;
  syncStatus: string;
  syncEnabled: boolean;
  externalListingId: string;
  syncError?: string | null;
  connectionStatus?: string | null;
  syncWarning?: string | null;
}

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
  etsyTaxonomyId?: number | null;
  ebayCategoryId?: number | null;
  etsyWhoMade?: string | null;
  etsyWhenMade?: string | null;
  channelLinks?: ChannelLink[];
}

interface ConnectStatus {
  onboarded: boolean;
  chargesEnabled: boolean;
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function statusLabel(item: StoreItem): string {
  if (item.status === "sold_out") return "Sold";
  if (item.status === "inactive") return "Ended";
  if (item.quantity <= 0) return "Out of stock";
  // Active only when live on storefront
  return item.status === "active" && item.quantity > 0 ? "Active" : "Ended";
}

export default function MyItemsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ listingType?: string; tab?: string }>();
  const listingType = params.listingType === "resale" ? "resale" : undefined;
  const initialTab = params.tab === "sold" ? "sold" : params.tab === "ended" ? "ended" : "active";
  const [items, setItems] = useState<StoreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [connectStatus, setConnectStatus] = useState<ConnectStatus | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [menuItemId, setMenuItemId] = useState<string | null>(null);
  const [conditionFixItemId, setConditionFixItemId] = useState<string | null>(null);
  const [channelConnections, setChannelConnections] = useState<ChannelConnectionSummary[]>([]);
  const [categoryProvider, setCategoryProvider] = useState<ListOnCategoryProvider | null>(null);
  const [categoryItemId, setCategoryItemId] = useState<string | null>(null);
  const [endGridItem, setEndGridItem] = useState<StoreItem | null>(null);
  const [endGridLoading, setEndGridLoading] = useState(false);

  type ItemsTab = "active" | "ended" | "sold";
  const [itemsTab, setItemsTab] = useState<ItemsTab>(initialTab);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const itemsUrl =
    (listingType ? "/api/store-items?mine=1&listingType=resale" : "/api/store-items?mine=1") +
    (itemsTab === "active" ? "&filter=active" : itemsTab === "ended" ? "&filter=ended" : "&filter=sold");

  const load = useCallback(() => {
    setFetchError(null);
    Promise.allSettled([
      apiGet<StoreItem[] | { error: string }>(itemsUrl),
      apiGet<ConnectStatus | { error: string }>("/api/stripe/connect/status"),
      fetchChannelConnections(),
    ])
      .then(([itemsResult, statusResult, channelsResult]) => {
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

        if (channelsResult.status === "fulfilled") {
          setChannelConnections(channelsResult.value);
        } else {
          setChannelConnections([]);
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
    // Trigger channel sync when viewing inventory (pulls Etsy changes to INW)
    apiPost("/api/channels/sync-on-view", {}).catch(() => {
      // Silently ignore sync errors - it's a background operation
    });
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

  const allSelected = items.length > 0 && items.every((i) => selectedIds.includes(i.id));

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? [] : items.map((i) => i.id));
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

  const markAsSold = async (id: string, unpublishProviders?: ChannelProviderId[]) => {
    setActingId(id);
    try {
      const body: { status: "sold_out"; unpublishChannelProviders?: ChannelProviderId[] } = {
        status: "sold_out",
      };
      if (unpublishProviders?.length) {
        body.unpublishChannelProviders = unpublishProviders;
      }
      const res = await apiPatch<{ channelSync?: { provider: string; ok: boolean; error?: string }[] }>(
        `/api/store-items/${id}`,
        body
      );
      alertChannelSyncFailures(
        res.channelSync,
        unpublishProviders?.length ? "removed" : "saved"
      );
      setItems((prev) => prev.filter((i) => i.id !== id));
      const removedNote =
        unpublishProviders?.length
          ? ` Removed from ${unpublishProviders.map((p) => CHANNEL_PROVIDER_LABEL[p]).join(", ")}.`
          : "";
      Alert.alert(
        "Marked as sold",
        `This item has been moved to Sold Items and no longer appears in My Items.${removedNote}`,
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
    const item = items.find((i) => i.id === id);
    if (!item) return;
    if ((item.channelLinks ?? []).length > 0) {
      setEndGridItem(item);
      return;
    }
    Alert.alert("End listing", endOnInwConfirm(1, []), [
      { text: "Cancel", style: "cancel" },
      {
        text: "End on INW",
        style: "destructive",
        onPress: async () => {
          setActingId(id);
          try {
            await apiPatch(`/api/store-items/${id}`, {
              status: "inactive",
              syncToChannels: false,
            });
            const summary = endOnInwResult(1, 0, []);
            Alert.alert(summary.title, summary.message);
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
    const item = items.find((i) => i.id === id);
    const linked = (item?.channelLinks ?? []).map((l) => l.provider as ChannelProviderId);
    if (linked.length === 0) {
      void markAsSold(id);
      return;
    }
    const storeList = linked.map((p) => CHANNEL_PROVIDER_LABEL[p]).join(", ");
    Alert.alert(
      "Mark as sold?",
      `This item is synced to ${storeList}. Remove the listing from ${linked.length === 1 ? "that store" : "those stores"} too?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Keep on stores",
          onPress: () => void markAsSold(id),
        },
        {
          text: linked.length === 1 ? `Remove from ${CHANNEL_PROVIDER_LABEL[linked[0]]}` : "Remove from all",
          style: "destructive",
          onPress: () => void markAsSold(id, linked),
        },
      ]
    );
  };

  const deleteItem = (id: string) => {
    setMenuItemId(null);
    Alert.alert(
      "Remove listing",
      "This permanently deletes the listing from the storefront. To keep a record and allow relisting later, use Mark as sold instead.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            setActingId(id);
            try {
              const res = await apiDelete<{
                channelSync?: { provider: string; ok: boolean; error?: string }[];
              }>(`/api/store-items/${id}`);
              alertChannelSyncFailures(res.channelSync, "deleted");
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
      "This will put the item back on sale with a quantity of 1. You can edit the quantity after relisting.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Relist",
          onPress: async () => {
            setActingId(id);
            try {
              const res = await apiPost<{
                ok: boolean;
                relisted: number;
                channelSync?: { provider: string; ok: boolean; error?: string }[];
              }>("/api/store-items/bulk-relist", {
                storeItemIds: [id],
                quantity: 1,
                republishChannels: false,
              });
              if (res.ok) {
                alertChannelSyncFailures(res.channelSync, "relisted");
                Alert.alert("Relisted", "Item is now active again.", [
                  { text: "OK" },
                  {
                    text: "View Active Items",
                    onPress: () => setItemsTab("active"),
                  },
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

  const listableProvidersForItem = (item: StoreItem): ChannelProviderId[] => {
    if (itemsTab === "sold") return [];
    const linked = new Set((item.channelLinks ?? []).map((l) => l.provider));
    return channelConnections
      .filter(
        (c) =>
          c.status === "active" &&
          c.readyToPublish !== false &&
          !linked.has(c.provider)
      )
      .map((c) => c.provider);
  };

  const blockedListConnectionsForItem = (item: StoreItem): ChannelConnectionSummary[] => {
    if (itemsTab === "sold") return [];
    const linked = new Set((item.channelLinks ?? []).map((l) => l.provider));
    return channelConnections.filter(
      (c) =>
        (c.status === "active" || c.status === "error") &&
        !linked.has(c.provider) &&
        (c.status !== "active" || c.readyToPublish === false)
    );
  };

  const publishToChannel = (storeItemId: string, provider: ChannelProviderId) => {
    const item = items.find((i) => i.id === storeItemId);
    if (item && isListOnCategoryProvider(provider) && itemNeedsListOnCategoryStep(item, provider)) {
      setMenuItemId(null);
      setCategoryItemId(storeItemId);
      setCategoryProvider(provider);
      return;
    }
    const label = CHANNEL_PROVIDER_LABEL[provider] ?? provider;
    Alert.alert(
      `List on ${label}?`,
      `This will create a listing on your connected ${label} store and keep inventory in sync.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "List",
          onPress: () => void runPublish(storeItemId, provider),
        },
      ]
    );
  };

  const runPublish = async (
    storeItemId: string,
    provider: ChannelProviderId,
    assignment?: ListOnCategoryAssignment
  ) => {
    const label = CHANNEL_PROVIDER_LABEL[provider] ?? provider;
    setMenuItemId(null);
    setActingId(storeItemId);
    try {
      const res = await apiPost<{
        channelSync?: { provider: string; ok: boolean; error?: string }[];
      }>(`/api/store-items/${storeItemId}/publish-channels`, {
        providers: [provider],
        ...(assignment?.etsyTaxonomyId != null ? { etsyTaxonomyId: assignment.etsyTaxonomyId } : {}),
        ...(assignment?.ebayCategoryId != null ? { ebayCategoryId: assignment.ebayCategoryId } : {}),
        ...(assignment?.etsyWhoMade ? { etsyWhoMade: assignment.etsyWhoMade } : {}),
        ...(assignment?.etsyWhenMade ? { etsyWhenMade: assignment.etsyWhenMade } : {}),
        ...(assignment?.aspects?.length ? { aspects: assignment.aspects } : {}),
      });
      alertChannelPublishResult(res.channelSync);
      setCategoryProvider(null);
      setCategoryItemId(null);
      load();
    } catch (e) {
      const err = e as { error?: string };
      const msg = err.error ?? `Could not list on ${label}.`;
      if (assignment) throw new Error(msg);
      Alert.alert("Error", msg);
    } finally {
      setActingId(null);
    }
  };

  const linkedProvidersForItem = (item: StoreItem): ChannelProviderId[] =>
    (item.channelLinks ?? []).map((l) => l.provider as ChannelProviderId);

  const unpublishFromChannel = (storeItemId: string, provider: ChannelProviderId) => {
    const label = CHANNEL_PROVIDER_LABEL[provider] ?? provider;
    Alert.alert(
      `Remove from ${label}?`,
      `This deletes the listing on your ${label} store and stops sync. The item stays on INW; you can list on ${label} again later.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            setMenuItemId(null);
            setActingId(storeItemId);
            try {
              const res = await apiPost<{
                channelSync?: { provider: string; ok: boolean; error?: string }[];
              }>(`/api/store-items/${storeItemId}/unpublish-channels`, {
                providers: [provider],
              });
              alertChannelSyncFailures(res.channelSync, "removed");
              load();
            } catch (e) {
              const err = e as { error?: string };
              Alert.alert("Error", err.error ?? `Could not remove from ${label}.`);
            } finally {
              setActingId(null);
            }
          },
        },
      ]
    );
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
      <View style={styles.tabRow}>
        {(["active", "ended", "sold"] as const).map((t) => (
          <Pressable
            key={t}
            style={[styles.tab, itemsTab === t && styles.tabActive]}
            onPress={() => setItemsTab(t)}
          >
            <Text style={[styles.tabText, itemsTab === t && styles.tabTextActive]}>
              {t === "active" ? "Active" : t === "ended" ? "Ended" : "Sold"}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.hint}>
        {itemsTab === "active"
          ? "Live on the storefront."
          : itemsTab === "ended"
            ? "Ended listings are not live on INW. They are removed from INW 14 days after they are ended."
            : "Items you've sold."}
      </Text>
      <View style={styles.addBtnWrap}>
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

      {(!connectStatus?.onboarded || !connectStatus?.chargesEnabled) && (
        <View style={styles.connectBanner}>
          <Text style={styles.connectBannerTitle}>Complete payment setup</Text>
          <Text style={styles.connectBannerText}>
            Items are only listed on the store once payment setup is complete. Complete Stripe Connect onboarding to list items and receive payments.
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
                // Trigger channel sync on pull-to-refresh (pulls Etsy changes to INW)
                apiPost("/api/channels/sync-on-view", {}).finally(() => {
                  load();
                });
              }}
            />
          }
          contentContainerStyle={[styles.list, selectedIds.length > 0 && styles.listWithBulk]}
          ListHeaderComponent={
            <Pressable style={styles.selectAllRow} onPress={toggleSelectAll}>
              <View style={[styles.checkbox, allSelected && styles.checkboxChecked]}>
                {allSelected ? <Text style={styles.checkmark}>✓</Text> : null}
              </View>
              <Text style={styles.selectAllText}>
                Select all{selectedIds.length > 0 ? ` · ${selectedIds.length} selected` : ""}
              </Text>
            </Pressable>
          }
          renderItem={({ item }) => {
            const selected = selectedIds.includes(item.id);
            return (
            <Pressable
              style={[styles.card, selected && styles.cardSelected]}
              onPress={() => toggleSelect(item.id)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={`Select ${item.title}`}
            >
              <View style={[styles.checkbox, selected && styles.checkboxChecked]}>
                {selected ? <Text style={styles.checkmark}>✓</Text> : null}
              </View>
              {item.photos?.[0] ? (
                <Image
                  source={{ uri: item.photos[0] }}
                  style={styles.thumb}
                />
              ) : (
                <View style={[styles.thumb, styles.thumbPlaceholder]} />
              )}
              <View style={styles.cardBody}>
                <Pressable
                  onPress={() => openListing(item)}
                  accessibilityRole="link"
                  accessibilityLabel={`View ${item.title}`}
                >
                  <Text style={styles.cardTitle} numberOfLines={2}>
                    {item.title}
                  </Text>
                </Pressable>
                <Text style={styles.cardPrice}>
                  {formatPrice(item.priceCents)}
                  {itemsTab === "sold" && item.soldAt
                    ? ` · Sold on ${new Date(item.soldAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`
                    : ` · ${item.quantity} in stock · ${statusLabel(item)}`}
                </Text>
                {itemsTab !== "sold" && (
                  <View style={styles.qualityBadgeRow}>
                    <QualityScoreBadge storeItemId={item.id} compact />
                  </View>
                )}
                {itemsTab === "sold" && item.soldOrderId && (
                  <Pressable
                    onPress={() =>
                      (router.push as (href: string) => void)(`/seller-hub/orders/${item.soldOrderId}`)
                    }
                  >
                    <Text style={styles.viewOrderLink}>View order</Text>
                  </Pressable>
                )}
                {item.channelLinks?.map((link) => {
                      const label =
                        CHANNEL_PROVIDER_LABEL[link.provider as ChannelProviderId] ??
                        link.provider;
                      const warning = link.syncWarning?.trim() || null;
                      const isConnectionIssue =
                        link.connectionStatus === "error" ||
                        link.connectionStatus === "disconnected";
                      const isError = Boolean(warning) && !isConnectionIssue;
                      const isPaused = !warning && !link.syncEnabled;
                      const needsConditionFix =
                        link.provider === "ebay" &&
                        link.syncStatus === "error" &&
                        isEbayConditionSyncError(link.syncError);
                      const badge = (
                        <Text
                          style={[
                            styles.syncBadge,
                            warning && isConnectionIssue && styles.syncBadgeWarning,
                            isError && styles.syncBadgeError,
                            isPaused && styles.syncBadgePaused,
                          ]}
                          numberOfLines={3}
                        >
                          {warning
                            ? `⚠ ${warning}`
                            : isPaused
                              ? `${label}: paused`
                              : `Synced to ${label}`}
                          {needsConditionFix ? " · Tap to fix condition" : ""}
                        </Text>
                      );
                      if (needsConditionFix) {
                        return (
                          <Pressable key={link.provider} onPress={() => setConditionFixItemId(item.id)}>
                            {badge}
                          </Pressable>
                        );
                      }
                      return <View key={link.provider}>{badge}</View>;
                    })}
              </View>
              <Pressable
                style={({ pressed }) => [
                  styles.viewBtn,
                  pressed && { opacity: 0.8 },
                ]}
                onPress={() => openListing(item)}
                accessibilityRole="button"
                accessibilityLabel={`View ${item.title}`}
              >
                <Text style={styles.viewBtnText}>View</Text>
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
            </Pressable>
            );
          }}
        />
      )}

      <BulkActionsBar
        selectedIds={selectedIds}
        selectedItems={items.filter((i) => selectedIds.includes(i.id))}
        tab={itemsTab}
        connections={channelConnections}
        onClearSelection={() => setSelectedIds([])}
        onActionComplete={() => load()}
      />

      <Modal
        visible={!!menuItemId}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuItemId(null)}
      >
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
                <Text style={[styles.menuOptionText, { color: theme.colors.primary }]}>View order</Text>
              </Pressable>
            )}
            {itemsTab === "sold" && menuItemId && (
              <Pressable
                style={styles.menuOption}
                onPress={() => relistItem(menuItemId)}
              >
                <Text style={styles.menuOptionTextGreen}>Relist item</Text>
              </Pressable>
            )}
            {menuItemId &&
              (() => {
                const menuItem = items.find((i) => i.id === menuItemId);
                if (!menuItem) return null;
                return (
                  <>
                    <Pressable
                      style={styles.menuOption}
                      onPress={() => {
                        setMenuItemId(null);
                        openListing(menuItem);
                      }}
                    >
                      <Text style={[styles.menuOptionText, { color: theme.colors.primary }]}>View listing</Text>
                    </Pressable>
                    {listableProvidersForItem(menuItem).map((provider) => (
                      <Pressable
                        key={`list-${provider}`}
                        style={styles.menuOption}
                        onPress={() => publishToChannel(menuItemId, provider)}
                      >
                        <Text style={[styles.menuOptionText, { color: theme.colors.primary }]}>
                          List on {CHANNEL_PROVIDER_LABEL[provider]}
                        </Text>
                      </Pressable>
                    ))}
                    {blockedListConnectionsForItem(menuItem).map((c) => {
                      const reason =
                        c.status !== "active"
                          ? "Reconnect in Sync Stores."
                          : c.publishBlockReason || channelNotReadyHint(c.provider);
                      return (
                        <Pressable
                          key={`list-blocked-${c.provider}`}
                          style={styles.menuOption}
                          onPress={() => Alert.alert(`List on ${CHANNEL_PROVIDER_LABEL[c.provider]}`, reason)}
                        >
                          <Text style={styles.menuOptionTextDisabled}>
                            List on {CHANNEL_PROVIDER_LABEL[c.provider]}
                          </Text>
                          <Text style={styles.menuOptionHint}>{reason}</Text>
                        </Pressable>
                      );
                    })}
                    {linkedProvidersForItem(menuItem).map((provider) => (
                      <Pressable
                        key={`unlink-${provider}`}
                        style={styles.menuOption}
                        onPress={() => unpublishFromChannel(menuItemId, provider)}
                      >
                        <Text style={styles.menuOptionTextRed}>
                          Remove from {CHANNEL_PROVIDER_LABEL[provider]}
                        </Text>
                      </Pressable>
                    ))}
                  </>
                );
              })()}
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
                  router.push(`/seller-hub/quantity-history/${menuItemId}` as never);
                }
              }}
            >
              <Text style={[styles.menuOptionText, { color: theme.colors.primary }]}>View History</Text>
            </Pressable>
            {itemsTab !== "sold" && (
              <Pressable
                style={styles.menuOption}
                onPress={() => {
                  if (menuItemId) confirmMarkAsSold(menuItemId);
                }}
              >
                <Text style={styles.menuOptionTextGreen}>Mark sold</Text>
              </Pressable>
            )}
            {itemsTab === "active" && (
              <Pressable
                style={styles.menuOption}
                onPress={() => menuItemId && endListing(menuItemId)}
              >
                <Text style={[styles.menuOptionText, { color: theme.colors.primary }]}>End listing</Text>
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
      <EbayConditionFixModal
        visible={!!conditionFixItemId}
        storeItemId={conditionFixItemId}
        onClose={() => setConditionFixItemId(null)}
        onFixed={() => load()}
      />
      <ListOnChannelCategoryModal
        visible={!!categoryProvider && !!categoryItemId}
        steps={
          categoryProvider && categoryItemId
            ? items
                .filter((i) => i.id === categoryItemId)
                .map((item) => ({ item, provider: categoryProvider }))
            : []
        }
        onClose={() => {
          setCategoryProvider(null);
          setCategoryItemId(null);
        }}
        onComplete={async (assignments) => {
          if (!categoryProvider || !categoryItemId) return;
          await runPublish(categoryItemId, categoryProvider, assignments[0]);
        }}
      />
      <BulkDestinationGridModal
        visible={endGridItem != null}
        action="end"
        items={endGridItem ? [endGridItem] : []}
        connectedProviders={listOnConnections(channelConnections).map((c) => c.provider)}
        loading={endGridLoading}
        onClose={() => setEndGridItem(null)}
        onApply={async (assignments) => {
          setEndGridLoading(true);
          try {
            const result = await apiPost<BulkDestinationsResultCounts>("/api/store-items/bulk-destinations", {
              action: "end",
              items: assignments,
            });
            const summary = summarizeBulkDestinations("end", result);
            Alert.alert(summary.title, summary.message);
            setEndGridItem(null);
            load();
          } catch (e) {
            const err = e as { error?: string };
            Alert.alert("End Listings failed", err.error ?? "Failed to end listing");
          } finally {
            setEndGridLoading(false);
          }
        }}
      />
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
  tabRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    marginHorizontal: 16,
    marginBottom: 8,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: theme.colors.primary,
  },
  tabText: { fontSize: 13, color: "#666" },
  tabTextActive: { fontWeight: "600", color: theme.colors.primary },
  hint: {
    fontSize: 14,
    color: "#666",
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  addBtnWrap: {
    alignItems: "center",
    paddingHorizontal: 16,
    marginBottom: 16,
  },
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
  listWithBulk: { paddingBottom: 260 },
  selectAllRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
    gap: 10,
  },
  selectAllText: { fontSize: 13, color: "#666", fontWeight: "600" },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 2,
    borderColor: "#ccc",
    borderRadius: 4,
    justifyContent: "center",
    alignItems: "center",
  },
  checkboxChecked: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  checkmark: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  card: {
    flexDirection: "row",
    padding: 12,
    backgroundColor: "#f9f9f9",
    borderRadius: 8,
    marginBottom: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "transparent",
  },
  cardSelected: {
    backgroundColor: theme.colors.creamAlt,
    borderColor: theme.colors.primary,
  },
  thumb: { width: 48, height: 48, borderRadius: 8, marginLeft: 10 },
  thumbPlaceholder: { backgroundColor: "#ddd" },
  cardBody: { flex: 1, marginLeft: 12, justifyContent: "center" },
  cardTitle: { fontSize: 16, fontWeight: "600", color: "#333" },
  cardPrice: { fontSize: 12, color: "#666", marginTop: 4 },
  qualityBadgeRow: { marginTop: 6 },
  viewOrderLink: { fontSize: 12, color: theme.colors.primary, marginTop: 2, fontWeight: "600" },
  syncBadge: { fontSize: 11, color: "#2e7d32", marginTop: 4, fontWeight: "600" },
  syncBadgeError: { color: "#c62828" },
  syncBadgeWarning: { color: "#b45309" },
  syncBadgePaused: { color: "#b26a00" },
  viewBtn: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginLeft: 4,
    borderWidth: 1,
    borderColor: theme.colors.primary,
    borderRadius: 8,
  },
  viewBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: theme.colors.heading,
  },
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
  menuOptionTextDisabled: {
    fontSize: 16,
    color: "#9ca3af",
    fontWeight: "600",
  },
  menuOptionHint: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 4,
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
