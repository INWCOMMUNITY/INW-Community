import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet } from "@/lib/api";

type SyncEvent = {
  id: string;
  provider: string;
  storeItemId: string | null;
  action: string;
  detail: string | null;
  createdAt: string;
};

const PROVIDER_LABEL: Record<string, string> = {
  etsy: "Etsy",
  ebay: "eBay",
  wix: "Wix",
  shopify: "Shopify",
};

const ACTION_ICON: Record<string, { name: keyof typeof Ionicons.glyphMap; color: string }> = {
  push_inventory: { name: "arrow-up-circle", color: "#2563eb" },
  push_content: { name: "arrow-up-circle-outline", color: "#2563eb" },
  pull_catalog: { name: "arrow-down-circle", color: "#7c3aed" },
  sale_applied: { name: "cart", color: "#16a34a" },
  sale_unmatched: { name: "help-circle", color: "#d97706" },
  skip_zero_qty: { name: "remove-circle-outline", color: "#6b7280" },
  conflict_resolved: { name: "git-compare", color: "#d97706" },
  token_refreshed: { name: "key", color: "#6b7280" },
  token_expired: { name: "key-outline", color: "#dc2626" },
  import: { name: "download", color: "#0891b2" },
  error: { name: "alert-circle", color: "#dc2626" },
};

const ACTION_LABEL: Record<string, string> = {
  push_inventory: "Inventory pushed",
  push_content: "Content pushed",
  pull_catalog: "Catalog pulled",
  sale_applied: "Sale applied",
  sale_unmatched: "Sale not matched",
  skip_zero_qty: "Zero push skipped",
  conflict_resolved: "Conflict resolved",
  token_refreshed: "Token refreshed",
  token_expired: "Connection issue",
  import: "Listings imported",
  error: "Sync error",
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 60_000) return "Just now";
  if (diffMs < 3600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86400_000) return `${Math.floor(diffMs / 3600_000)}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function SyncActivityScreen() {
  const [events, setEvents] = useState<SyncEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const load = useCallback(async (cursor?: string) => {
    try {
      const params = new URLSearchParams({ limit: "30" });
      if (cursor) params.set("cursor", cursor);
      const data = await apiGet(`/api/me/sync-log?${params}`);
      if (cursor) {
        setEvents((prev) => [...prev, ...(data.events ?? [])]);
      } else {
        setEvents(data.events ?? []);
      }
      setNextCursor(data.nextCursor ?? null);
    } catch {
      // fail silently
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load])
  );

  const renderItem = ({ item }: { item: SyncEvent }) => {
    const iconDef = ACTION_ICON[item.action] ?? ACTION_ICON.error;
    const label = ACTION_LABEL[item.action] ?? item.action;
    const providerLabel = PROVIDER_LABEL[item.provider] ?? item.provider;

    return (
      <View style={styles.row}>
        <View style={[styles.iconWrap, { backgroundColor: iconDef.color + "18" }]}>
          <Ionicons name={iconDef.name} size={20} color={iconDef.color} />
        </View>
        <View style={styles.content}>
          <View style={styles.headerRow}>
            <Text style={styles.label}>{label}</Text>
            <Text style={styles.time}>{formatTime(item.createdAt)}</Text>
          </View>
          <Text style={styles.provider}>{providerLabel}</Text>
          {item.detail ? (
            <Text style={styles.detail} numberOfLines={2}>
              {item.detail}
            </Text>
          ) : null}
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <FlatList
      data={events}
      keyExtractor={(e) => e.id}
      renderItem={renderItem}
      contentContainerStyle={events.length === 0 ? styles.center : styles.list}
      ListEmptyComponent={
        <View style={styles.emptyWrap}>
          <Ionicons name="sync-outline" size={48} color="#d1d5db" />
          <Text style={styles.emptyText}>No sync activity yet</Text>
          <Text style={styles.emptyHint}>
            Activity will appear here as your listings sync with connected stores.
          </Text>
        </View>
      }
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            load();
          }}
          tintColor={theme.colors.primary}
        />
      }
      onEndReached={() => {
        if (nextCursor) load(nextCursor);
      }}
      onEndReachedThreshold={0.3}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 32 },
  list: { paddingVertical: 8 },
  row: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
    marginTop: 2,
  },
  content: { flex: 1 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  label: { fontSize: 15, fontWeight: "600", color: "#111827" },
  time: { fontSize: 12, color: "#9ca3af" },
  provider: { fontSize: 13, color: "#6b7280", marginTop: 1 },
  detail: { fontSize: 13, color: "#4b5563", marginTop: 4 },
  emptyWrap: { alignItems: "center", gap: 8 },
  emptyText: { fontSize: 16, fontWeight: "600", color: "#6b7280" },
  emptyHint: { fontSize: 14, color: "#9ca3af", textAlign: "center", maxWidth: 280 },
});
