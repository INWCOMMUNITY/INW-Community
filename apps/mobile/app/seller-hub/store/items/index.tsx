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
import { alertChannelPublishResult, alertChannelSyncFailures } from "@/lib/channel-sync-alert";
import { EbayConditionFixModal } from "@/components/channels/EbayConditionFixModal";
import { ListOnChannelCategoryModal } from "@/components/channels/ListOnChannelCategoryModal";
import {
  isListOnCategoryProvider,
  isMissingEbayItemSpecificsError,
  shouldOpenListOnCategoryStep,
  type ListOnCategoryAssignment,
  type ListOnCategoryProvider,
} from "@/lib/list-on-channel-category";
import { isEbayConditionSyncError } from "@/lib/ebay-condition-sync";
import { buildProductPath } from "@/lib/product-referrer";
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
import { channelLinkShowsOnItem } from "@/lib/channel-link-visibility";
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
  remoteDeletedProvider?: string | null;
  ebayListingEnded?: boolean;
  remoteCatalogState?: string | null;
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
  aspects?: { name: string; value: string }[] | unknown;
  channelLinks?: ChannelLink[];
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

const ITEMS_TABS: { key: "active" | "attention" | "ended" | "sold"; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "attention", label: "Attention" },
  { key: "ended", label: "Ended" },
  { key: "sold", label: "Sold" },
];

function statusLabel(item: StoreItem): string {
  if (item.status === "sold_out") return "Sold";
  if (item.status === "inactive") return "Ended";
  if (item.quantity <= 0) return "Out of stock";
  // Active only when live on storefront
  return item.status === "active" && item.quantity > 0 ? "Active" : "Ended";
}

function RemoteDeletedCard({
  item,
  busy,
  onKeep,
  onDelete,
}: {
  item: StoreItem;
  busy: boolean;
  onKeep: () => void;
  onDelete: () => void;
}) {
  const copy = remoteDeletedCopy(item);
  if (!copy) return null;
  return (
    <View style={styles.attentionBox}>
      <Text style={styles.attentionTitle}>{copy.headline}</Text>
      <Text style={styles.attentionBody}>{copy.body}</Text>
      <View style={styles.attentionActions}>
        <Pressable
          style={[styles.attentionDelete, busy && { opacity: 0.6 }]}
          disabled={busy}
          onPress={onDelete}
        >
          <Text style={styles.attentionDeleteText}>{busy ? "Working…" : "Delete everywhere"}</Text>
        </Pressable>
        <Pressable
          style={[styles.attentionKeep, busy && { opacity: 0.6 }]}
          disabled={busy}
          onPress={onKeep}
        >
          <Text style={styles.attentionKeepText}>Keep on INW and other shops</Text>
        </Pressable>
      </View>
    </View>
  );
}

function remoteDeletedCopy(item: StoreItem): { headline: string; body: string } | null {
  const deleted = item.channelLinks?.find((l) => l.remoteDeletedProvider)?.remoteDeletedProvider;
  if (!deleted) return null;
  const deletedLabel = CHANNEL_PROVIDER_LABEL[deleted as ChannelProviderId] ?? deleted;
  const others = [...new Set(
    (item.channelLinks ?? [])
      .filter((l) => l.provider !== deleted && l.syncEnabled && channelLinkShowsOnItem(l))
      .map((l) => CHANNEL_PROVIDER_LABEL[l.provider as ChannelProviderId] ?? l.provider)
  )];
  const headline = `This listing was deleted on ${deletedLabel}.`;
  if (others.length === 0) {
    return { headline, body: "Delete it on INW too, or keep it listed here." };
  }
  const also = others.length === 1 ? others[0] : `${others.slice(0, -1).join(", ")} and ${others[others.length - 1]}`;
  return { headline, body: `Delete it on INW and ${also} too, or keep those listings up.` };
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
        : params.tab === "attention"
          ? "attention"
          : "active";
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

  type ItemsTab = "active" | "attention" | "ended" | "sold";
  const [itemsTab, setItemsTab] = useState<ItemsTab>(initialTab);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [tabCounts, setTabCounts] = useState<{
    active: number;
    attention: number;
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
      : itemsTab === "attention"
        ? "&filter=attention"
        : itemsTab === "ended"
          ? "&filter=ended"
          : "&filter=sold");

  const load = useCallback(() => {
    setFetchError(null);
    Promise.allSettled([
      apiGet<StoreItem[] | { error: string }>(itemsUrl),
      apiGet<ConnectStatus | { error: string }>("/api/stripe/connect/status"),
      fetchChannelConnections(),
      apiGet<{
        active?: number;
        attention?: number;
        ended?: number;
        sold?: number;
      }>("/api/store-items?mine=1&counts=1"),
    ])
      .then(([itemsResult, statusResult, channelsResult, countsResult]) => {
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

        if (countsResult.status === "fulfilled") {
          const data = countsResult.value;
          if (data && typeof data.active === "number") {
            setTabCounts({
              active: data.active,
              attention: Number(data.attention) || 0,
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
    apiPost<{ summary?: { updated?: number; removed?: number } }>("/api/channels/sync-on-view", {})
      .then((data) => {
        if ((data?.summary?.updated ?? 0) > 0 || (data?.summary?.removed ?? 0) > 0) {
          load();
        }
      })
      .catch(() => {});
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

  const decideRemoteDeleted = async (item: StoreItem, action: "keep" | "delete_everywhere") => {
    const copy = remoteDeletedCopy(item);
    if (action === "delete_everywhere") {
      const confirmed = await new Promise<boolean>((resolve) => {
        Alert.alert(
          "Delete everywhere?",
          copy?.body ?? "Delete this listing on INW and your other shops?",
          [
            { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
            { text: "Delete", style: "destructive", onPress: () => resolve(true) },
          ]
        );
      });
      if (!confirmed) return;
    }
    setDecidingId(item.id);
    try {
      await apiPost(`/api/store-items/${item.id}/remote-delete-decision`, { action });
      load();
    } catch (e) {
      Alert.alert("Could not save", (e as { error?: string })?.error ?? "Try again.");
    } finally {
      setDecidingId(null);
    }
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
    if ((item.channelLinks ?? []).some(channelLinkShowsOnItem)) {
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
    const linked = (item?.channelLinks ?? [])
      .filter(channelLinkShowsOnItem)
      .map((l) => l.provider as ChannelProviderId);
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
          text: linked.length === 1 ? `Remove from ${CHANNEL_PROVIDER_LABEL[linked[0]]}` : "Remove from All",
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
    const linked = new Set(
      (item.channelLinks ?? []).filter(channelLinkShowsOnItem).map((l) => l.provider)
    );
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
    const linked = new Set(
      (item.channelLinks ?? []).filter(channelLinkShowsOnItem).map((l) => l.provider)
    );
    return channelConnections.filter(
      (c) =>
        (c.status === "active" || c.status === "error") &&
        !linked.has(c.provider) &&
        (c.status !== "active" || c.readyToPublish === false)
    );
  };

  const publishToChannel = (storeItemId: string, provider: ChannelProviderId) => {
    const item = items.find((i) => i.id === storeItemId);
    if (item && isListOnCategoryProvider(provider) && shouldOpenListOnCategoryStep(item, provider)) {
      setMenuItemId(null);
      setCategoryItemId(storeItemId);
      setCategoryProvider(provider);
      return;
    }
    const label = CHANNEL_PROVIDER_LABEL[provider] ?? provider;
    const ebayVariantHint =
      provider === "ebay"
        ? " Listings with several sizes or colors can take up to a minute."
        : "";
    Alert.alert(
      `List on ${label}?`,
      `This will create a listing on your connected ${label} store and keep inventory in sync.${ebayVariantHint}`,
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
      const failedSpecifics = (res.channelSync ?? []).some(
        (row) => !row.ok && isMissingEbayItemSpecificsError(row.error)
      );
      if (failedSpecifics && isListOnCategoryProvider(provider)) {
        const msg = (res.channelSync ?? [])
          .filter((row) => !row.ok)
          .map((row) => row.error)
          .filter(Boolean)
          .join("\n") || `Could not list on ${label}.`;
        if (assignment) throw new Error(msg);
        setCategoryItemId(storeItemId);
        setCategoryProvider(provider);
        return;
      }
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
    (item.channelLinks ?? [])
      .filter(channelLinkShowsOnItem)
      .map((l) => l.provider as ChannelProviderId);

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

  const emptyCopy =
    itemsTab === "attention"
      ? {
          title: "Nothing needs attention",
          body: "When a listing is deleted on eBay, Etsy, or another connected shop, it shows up here.",
        }
      : itemsTab === "ended"
        ? { title: "No ended listings", body: "Ended listings stay here for 14 days, then they’re removed from INW." }
        : itemsTab === "sold"
          ? { title: "No sold items yet", body: "Sold listings will land here after checkout." }
          : { title: "No items yet", body: "List your first item to start selling on the storefront." };

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

      {itemsTab === "attention" || itemsTab === "ended" ? (
        <Text style={styles.hint}>
          {itemsTab === "attention"
            ? "A connected shop deleted this listing. Choose whether to delete it on INW and your other shops too."
            : "Ended listings are not live on INW. They’re removed from INW 14 days after they are ended."}
        </Text>
      ) : null}

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
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                apiPost("/api/channels/sync-on-view", {}).finally(() => {
                  load();
                });
              }}
            />
          }
          contentContainerStyle={[styles.list, selectedIds.length > 0 && styles.listWithBulk]}
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
          ListEmptyComponent={
            <Text style={styles.emptyBody}>No items match this search.</Text>
          }
          renderItem={({ item }) => {
            const selected = selectedIds.includes(item.id);
            const photoUrl = resolvePhotoUrl(item.photos?.[0]);
            const status = statusLabel(item);
            return (
              <View style={[styles.card, selected && styles.cardSelected]}>
                <Pressable
                  onPress={() => toggleSelect(item.id)}
                  style={styles.checkboxHit}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={`Select ${item.title}`}
                >
                  <Ionicons
                    name={selected ? "checkbox" : "square-outline"}
                    size={24}
                    color={selected ? theme.colors.primary : "#888"}
                  />
                </Pressable>
                <Pressable
                  style={styles.cardMain}
                  onPress={() => openListing(item)}
                  accessibilityRole="link"
                  accessibilityLabel={`View ${item.title}`}
                >
                  <View style={styles.thumbWrap}>
                    {photoUrl ? (
                      <Image source={{ uri: photoUrl }} style={styles.thumb} resizeMode="cover" />
                    ) : (
                      <View style={[styles.thumb, styles.thumbPlaceholder]} />
                    )}
                    {itemsTab === "sold" ? (
                      <View style={styles.soldStamp}>
                        <Text style={styles.soldStampText}>Sold</Text>
                      </View>
                    ) : null}
                  </View>
                  <View style={styles.cardBody}>
                    <Text style={styles.cardTitle} numberOfLines={2}>
                      {item.title}
                    </Text>
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
                    {itemsTab === "attention" ? (
                      <RemoteDeletedCard
                        item={item}
                        busy={decidingId === item.id}
                        onKeep={() => void decideRemoteDeleted(item, "keep")}
                        onDelete={() => void decideRemoteDeleted(item, "delete_everywhere")}
                      />
                    ) : null}
                    {itemsTab === "sold" && item.soldOrderId ? (
                      <Pressable
                        onPress={() =>
                          (router.push as (href: string) => void)(`/seller-hub/orders/${item.soldOrderId}`)
                        }
                      >
                        <Text style={styles.viewOrderLink}>View order</Text>
                      </Pressable>
                    ) : null}
                    <View style={styles.channelTagRow}>
                      {(item.channelLinks ?? [])
                        .filter(channelLinkShowsOnItem)
                        .map((link) => {
                          const label =
                            CHANNEL_PROVIDER_LABEL[link.provider as ChannelProviderId] ??
                            link.provider;
                          const warning = link.syncWarning?.trim() || null;
                          const isConnectionIssue = link.connectionStatus === "error";
                          const isError = Boolean(warning) && !isConnectionIssue;
                          const isPaused = !warning && !link.syncEnabled;
                          const needsConditionFix =
                            link.provider === "ebay" &&
                            link.syncStatus === "error" &&
                            isEbayConditionSyncError(link.syncError);
                          const tagText = warning
                            ? `${isConnectionIssue ? "⚠ " : ""}${warning}`
                            : isPaused
                              ? `${label}: paused`
                              : needsConditionFix
                                ? `${label}: fix`
                                : label;
                          const badge = (
                            <Text
                              style={[
                                styles.channelTag,
                                warning && isConnectionIssue && styles.channelTagWarning,
                                isError && styles.channelTagError,
                                isPaused && styles.channelTagPaused,
                              ]}
                              numberOfLines={1}
                            >
                              {tagText}
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
                  </View>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.menuBtn, pressed && { opacity: 0.8 }]}
                  onPress={() => openMenu(item.id)}
                  disabled={!!actingId}
                  accessibilityLabel={`More actions for ${item.title}`}
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

      {itemsTab !== "attention" ? (
        <BulkActionsBar
          selectedIds={selectedIds}
          selectedItems={items.filter((i) => selectedIds.includes(i.id))}
          tab={itemsTab}
          connections={channelConnections}
          onClearSelection={() => setSelectedIds([])}
          onActionComplete={() => load()}
        />
      ) : null}

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
                <Text style={[styles.menuOptionText, { color: theme.colors.primary }]}>View Order</Text>
              </Pressable>
            )}
            {itemsTab === "sold" && menuItemId && (
              <Pressable
                style={styles.menuOption}
                onPress={() => relistItem(menuItemId)}
              >
                <Text style={styles.menuOptionTextGreen}>Relist Item</Text>
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
                      <Text style={[styles.menuOptionText, { color: theme.colors.primary }]}>View Listing</Text>
                    </Pressable>
                    {listableProvidersForItem(menuItem).map((provider) => (
                      <Pressable
                        key={`list-${provider}`}
                        style={styles.menuOption}
                        onPress={() => publishToChannel(menuItemId, provider)}
                      >
                        <Text style={[styles.menuOptionText, { color: theme.colors.primary }]}>
                          List On {CHANNEL_PROVIDER_LABEL[provider]}
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
                            List On {CHANNEL_PROVIDER_LABEL[c.provider]}
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
                <Text style={styles.menuOptionTextGreen}>Mark Sold</Text>
              </Pressable>
            )}
            {itemsTab === "active" && (
              <Pressable
                style={styles.menuOption}
                onPress={() => menuItemId && endListing(menuItemId)}
              >
                <Text style={[styles.menuOptionText, { color: theme.colors.primary }]}>End Listing</Text>
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
    paddingHorizontal: 8,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabActive: { borderBottomColor: theme.colors.primary },
  tabText: { fontSize: 13, fontWeight: "600", color: "#666" },
  tabTextActive: { color: theme.colors.primary },
  tabCount: {
    minWidth: 18,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 999,
    backgroundColor: theme.colors.cream,
    alignItems: "center",
  },
  tabCountActive: { backgroundColor: theme.colors.primary },
  tabCountText: { fontSize: 10, fontWeight: "700", color: theme.colors.primary },
  tabCountTextActive: { color: "#fff" },
  hint: {
    fontSize: 13,
    color: "#666",
    lineHeight: 18,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
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
  connectBannerTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#92400e",
    marginBottom: 4,
  },
  connectBannerText: {
    fontSize: 13,
    color: "#92400e",
    marginBottom: 10,
  },
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
  listWithBulk: { paddingBottom: 260 },
  selectAllRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
    gap: 8,
  },
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
  cardSelected: {
    borderColor: theme.colors.primary,
    backgroundColor: "#f7f6f2",
  },
  checkboxHit: { paddingTop: 6, paddingRight: 6 },
  cardMain: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "flex-start", gap: 10 },
  thumbWrap: { width: 72, height: 72, borderRadius: 8, overflow: "hidden", backgroundColor: "#ece8e0" },
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
  viewOrderLink: { fontSize: 12, color: theme.colors.primary, marginTop: 6, fontWeight: "700" },
  channelTagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
  },
  channelTag: {
    fontSize: 11,
    fontWeight: "600",
    color: theme.colors.earth,
    backgroundColor: theme.colors.cream,
    borderWidth: 1,
    borderColor: theme.colors.earth,
    borderRadius: 999,
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  channelTagError: {
    color: "#b91c1c",
    backgroundColor: "#fef2f2",
    borderColor: "#fecaca",
  },
  channelTagWarning: {
    color: "#92400e",
    backgroundColor: "#fffbeb",
    borderColor: "#fde68a",
  },
  channelTagPaused: {
    color: "#4b5563",
    backgroundColor: "#f9fafb",
    borderColor: "#e5e7eb",
  },
  attentionBox: {
    marginTop: 8,
    padding: 10,
    borderRadius: 8,
    backgroundColor: "#fffbeb",
    borderWidth: 1,
    borderColor: "#fde68a",
  },
  attentionTitle: { fontSize: 13, fontWeight: "700", color: "#78350f" },
  attentionBody: { fontSize: 12, color: "#92400e", marginTop: 4 },
  attentionActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  attentionDelete: {
    backgroundColor: theme.colors.primary,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  attentionDeleteText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  attentionKeep: {
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "#fff",
  },
  attentionKeepText: { color: theme.colors.heading, fontSize: 12, fontWeight: "700" },
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
