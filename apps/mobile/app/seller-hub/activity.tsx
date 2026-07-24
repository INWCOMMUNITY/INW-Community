import React, { useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  ActivityIndicator,
  Pressable,
  RefreshControl,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet } from "@/lib/api";

type FilterType = "all" | "items" | "orders" | "channels" | "alerts";

interface ActivityEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  detail: Record<string, unknown> | null;
  createdAt: string;
  message: string;
  icon: string;
  color: string;
}

interface ActivityResponse {
  items: ActivityEntry[];
  nextCursor: string | null;
  hasMore: boolean;
}

const FILTERS: { key: FilterType; label: string; actions?: string[] }[] = [
  { key: "all", label: "All" },
  { key: "items", label: "Items", actions: ["item_created", "item_updated", "item_deleted"] },
  { key: "orders", label: "Orders", actions: ["order_received", "offer_received", "offer_accepted", "offer_declined"] },
  { key: "channels", label: "Channels", actions: ["channel_linked", "channel_unlinked", "bulk_publish", "bulk_unpublish", "sync_error"] },
  { key: "alerts", label: "Alerts", actions: ["low_stock_alert", "sync_error"] },
];

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function ActivityItem({ item, onPress }: { item: ActivityEntry; onPress?: () => void }) {
  const IconName = item.icon as keyof typeof Ionicons.glyphMap;

  return (
    <Pressable
      style={styles.activityItem}
      onPress={onPress}
      android_ripple={{ color: "#eee" }}
    >
      <View style={[styles.iconContainer, { backgroundColor: `${item.color}15` }]}>
        <Ionicons name={IconName} size={20} color={item.color} />
      </View>
      <View style={styles.activityContent}>
        <Text style={styles.activityMessage}>{item.message}</Text>
        <Text style={styles.activityTime}>{formatRelativeTime(item.createdAt)}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color="#ccc" />
    </Pressable>
  );
}

function ActivityDetail({ item, onClose }: { item: ActivityEntry; onClose: () => void }) {
  const IconName = item.icon as keyof typeof Ionicons.glyphMap;
  const detail = item.detail ?? {};

  return (
    <View style={styles.detailOverlay}>
      <View style={styles.detailCard}>
        <View style={styles.detailHeader}>
          <View style={[styles.iconContainerLarge, { backgroundColor: `${item.color}15` }]}>
            <Ionicons name={IconName} size={28} color={item.color} />
          </View>
          <Pressable onPress={onClose} hitSlop={8}>
            <Ionicons name="close" size={24} color="#666" />
          </Pressable>
        </View>
        <Text style={styles.detailMessage}>{item.message}</Text>
        <Text style={styles.detailTime}>
          {new Date(item.createdAt).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </Text>
        {Object.keys(detail).length > 0 ? (
          <View style={styles.detailContent}>
            {detail.title ? (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Item:</Text>
                <Text style={styles.detailValue}>{String(detail.title)}</Text>
              </View>
            ) : null}
            {detail.quantity !== undefined ? (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Quantity:</Text>
                <Text style={styles.detailValue}>{String(detail.quantity)}</Text>
              </View>
            ) : null}
            {detail.threshold !== undefined ? (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Threshold:</Text>
                <Text style={styles.detailValue}>{String(detail.threshold)}</Text>
              </View>
            ) : null}
            {detail.changedFields && Array.isArray(detail.changedFields) ? (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Changed:</Text>
                <Text style={styles.detailValue}>{(detail.changedFields as string[]).join(", ")}</Text>
              </View>
            ) : null}
            {detail.provider ? (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Channel:</Text>
                <Text style={styles.detailValue}>{String(detail.provider).toUpperCase()}</Text>
              </View>
            ) : null}
            {detail.errorMessage ? (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Error:</Text>
                <Text style={[styles.detailValue, { color: "#ef4444" }]}>
                  {String(detail.errorMessage)}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

export default function ActivityLogScreen() {
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [filter, setFilter] = useState<FilterType>("all");
  const [selectedItem, setSelectedItem] = useState<ActivityEntry | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchActivities = useCallback(
    async (reset = false) => {
      if (reset) {
        setLoading(true);
        setCursor(null);
      }
      setError(null);

      try {
        const filterConfig = FILTERS.find((f) => f.key === filter);
        const actionParam = filterConfig?.actions?.join(",") ?? "";
        const cursorParam = reset ? "" : cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
        const url = `/api/seller-hub/activity-log?limit=30${actionParam ? `&action=${actionParam}` : ""}${cursorParam}`;

        const data = await apiGet<ActivityResponse>(url);

        if (reset) {
          setActivities(data.items);
        } else {
          setActivities((prev) => [...prev, ...data.items]);
        }
        setCursor(data.nextCursor);
        setHasMore(data.hasMore);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load activity");
      } finally {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    },
    [filter, cursor]
  );

  useFocusEffect(
    useCallback(() => {
      fetchActivities(true);
    }, [filter])
  );

  const handleRefresh = () => {
    setRefreshing(true);
    fetchActivities(true);
  };

  const handleLoadMore = () => {
    if (!hasMore || loadingMore || loading) return;
    setLoadingMore(true);
    fetchActivities(false);
  };

  const renderItem = ({ item }: { item: ActivityEntry }) => (
    <ActivityItem item={item} onPress={() => setSelectedItem(item)} />
  );

  const renderEmpty = () => {
    if (loading) return null;
    return (
      <View style={styles.emptyState}>
        <Ionicons name="time-outline" size={48} color="#ccc" />
        <Text style={styles.emptyTitle}>No activity yet</Text>
        <Text style={styles.emptyText}>
          Your seller activity will appear here as you manage your listings.
        </Text>
      </View>
    );
  };

  const renderFooter = () => {
    if (!loadingMore) return null;
    return (
      <View style={styles.loadingMore}>
        <ActivityIndicator size="small" color={theme.colors.primary} />
      </View>
    );
  };

  if (loading && activities.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (error && activities.length === 0) {
    return (
      <View style={styles.center}>
        <Ionicons name="warning-outline" size={48} color="#d32f2f" />
        <Text style={styles.errorText}>{error}</Text>
        <Pressable style={styles.retryBtn} onPress={() => fetchActivities(true)}>
          <Text style={styles.retryBtnText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Filter chips */}
      <View style={styles.filterContainer}>
        <FlatList
          data={FILTERS}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item) => item.key}
          renderItem={({ item }) => (
            <Pressable
              style={[styles.filterChip, filter === item.key && styles.filterChipActive]}
              onPress={() => setFilter(item.key)}
            >
              <Text
                style={[
                  styles.filterChipText,
                  filter === item.key && styles.filterChipTextActive,
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          )}
          contentContainerStyle={styles.filterList}
        />
      </View>

      {/* Activity list */}
      <FlatList
        data={activities}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={renderFooter}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={theme.colors.primary}
          />
        }
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.3}
        contentContainerStyle={activities.length === 0 ? styles.emptyContainer : undefined}
      />

      {/* Detail modal */}
      {selectedItem && (
        <ActivityDetail item={selectedItem} onClose={() => setSelectedItem(null)} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  errorText: {
    fontSize: 16,
    color: "#d32f2f",
    textAlign: "center",
    marginTop: 12,
    marginBottom: 16,
  },
  retryBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  retryBtnText: {
    color: "#fff",
    fontWeight: "600",
  },
  filterContainer: {
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  filterList: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: "#f0f0f0",
    marginRight: 8,
  },
  filterChipActive: {
    backgroundColor: theme.colors.primary,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: "500",
    color: "#666",
  },
  filterChipTextActive: {
    color: "#fff",
  },
  activityItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  activityContent: {
    flex: 1,
  },
  activityMessage: {
    fontSize: 14,
    color: "#222",
    marginBottom: 2,
  },
  activityTime: {
    fontSize: 12,
    color: "#999",
  },
  emptyContainer: {
    flex: 1,
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#666",
    marginTop: 12,
  },
  emptyText: {
    fontSize: 14,
    color: "#999",
    textAlign: "center",
    marginTop: 8,
  },
  loadingMore: {
    paddingVertical: 16,
    alignItems: "center",
  },
  detailOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  detailCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
    width: "100%",
    maxWidth: 400,
  },
  detailHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  iconContainerLarge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
  },
  detailMessage: {
    fontSize: 18,
    fontWeight: "600",
    color: "#222",
    marginBottom: 4,
  },
  detailTime: {
    fontSize: 13,
    color: "#999",
    marginBottom: 16,
  },
  detailContent: {
    backgroundColor: "#f9f9f9",
    borderRadius: 8,
    padding: 12,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginTop: 8,
  },
  detailLabel: {
    fontSize: 13,
    fontWeight: "500",
    color: "#666",
    width: 80,
  },
  detailValue: {
    flex: 1,
    fontSize: 13,
    color: "#222",
  },
});
