import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useLocalSearchParams, useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet } from "@/lib/api";

type AuditLogEntry = {
  id: string;
  storeItemId: string;
  memberId: string;
  provider: string;
  previousQty: number;
  newQty: number;
  delta: number;
  reason: string;
  externalEventId: string | null;
  orderId: string | null;
  variantValue: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

const REASON_LABELS: Record<string, string> = {
  sale: "Sale",
  restock: "Restock",
  sync_pull: "Synced from Channel",
  manual_edit: "Manual Edit",
  refund: "Refund/Cancel",
  bulk_edit: "Bulk Edit",
  import: "Import",
  sync_push: "Pushed to Channel",
};

const REASON_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  sale: "cart-outline",
  restock: "add-circle-outline",
  sync_pull: "cloud-download-outline",
  manual_edit: "create-outline",
  refund: "return-down-back-outline",
  bulk_edit: "layers-outline",
  import: "download-outline",
  sync_push: "cloud-upload-outline",
};

const PROVIDER_NAMES: Record<string, string> = {
  inwc: "NWC Store",
  etsy: "Etsy",
  ebay: "eBay",
  shopify: "Shopify",
  wix: "Wix",
};

export default function QuantityHistoryScreen() {
  const { itemId } = useLocalSearchParams<{ itemId: string }>();
  const router = useRouter();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [itemTitle, setItemTitle] = useState<string>("");

  const loadData = useCallback(async (isRefresh = false, offset = 0) => {
    if (!itemId) return;
    if (isRefresh) setRefreshing(true);
    else if (offset === 0) setLoading(true);
    else setLoadingMore(true);

    try {
      const res = await apiGet<{ logs: AuditLogEntry[]; total: number }>(
        `/api/seller/quantity-audit?storeItemId=${itemId}&limit=50&offset=${offset}`
      );
      if (offset === 0) {
        setLogs(res.logs);
      } else {
        setLogs((prev) => [...prev, ...res.logs]);
      }
      setTotal(res.total);

      // Get item title if first load
      if (offset === 0 && res.logs.length > 0) {
        // We could fetch item title separately, but for now just show "Quantity History"
      }
    } catch (e) {
      console.error("Failed to load quantity history:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [itemId]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    if (diff < 60 * 1000) return "Just now";
    if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60 / 1000)}m ago`;
    if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 60 / 60 / 1000)}h ago`;

    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const renderLogEntry = ({ item }: { item: AuditLogEntry }) => {
    const isPositive = item.delta > 0;
    const icon = REASON_ICONS[item.reason] ?? "help-circle-outline";
    const reasonLabel = REASON_LABELS[item.reason] ?? item.reason;
    const providerLabel = PROVIDER_NAMES[item.provider] ?? item.provider;

    return (
      <View style={styles.logEntry}>
        <View style={[styles.iconContainer, isPositive ? styles.iconPositive : styles.iconNegative]}>
          <Ionicons name={icon} size={20} color={isPositive ? "#16a34a" : "#dc2626"} />
        </View>
        <View style={styles.logContent}>
          <View style={styles.logHeader}>
            <Text style={styles.reasonLabel}>{reasonLabel}</Text>
            <Text style={[styles.deltaText, isPositive ? styles.positive : styles.negative]}>
              {isPositive ? "+" : ""}{item.delta}
            </Text>
          </View>
          <View style={styles.logDetails}>
            <Text style={styles.qtyChange}>
              {item.previousQty} → {item.newQty}
            </Text>
            <Text style={styles.provider}>via {providerLabel}</Text>
          </View>
          {item.variantValue && (
            <Text style={styles.variant}>{item.variantValue}</Text>
          )}
          {item.orderId && (
            <Pressable
              onPress={() => router.push(`/seller-hub/orders/${item.orderId}`)}
              style={styles.orderLink}
            >
              <Ionicons name="receipt-outline" size={12} color={theme.colors.primary} />
              <Text style={styles.orderLinkText}>View Order</Text>
            </Pressable>
          )}
          <Text style={styles.timestamp}>{formatTime(item.createdAt)}</Text>
        </View>
      </View>
    );
  };

  const handleLoadMore = () => {
    if (!loadingMore && logs.length < total) {
      loadData(false, logs.length);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </Pressable>
        <Text style={styles.headerTitle}>Quantity History</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.summary}>
        <Text style={styles.summaryText}>
          {total} change{total !== 1 ? "s" : ""} recorded
        </Text>
      </View>

      {logs.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="analytics-outline" size={48} color="#ccc" />
          <Text style={styles.emptyText}>No quantity changes recorded yet</Text>
          <Text style={styles.emptySubtext}>
            Changes from sales, syncs, and edits will appear here
          </Text>
        </View>
      ) : (
        <FlatList
          data={logs}
          renderItem={renderLogEntry}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => loadData(true)} />
          }
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.loadingMore}>
                <ActivityIndicator size="small" color={theme.colors.primary} />
              </View>
            ) : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  backButton: { padding: 8 },
  headerTitle: { fontSize: 18, fontWeight: "700", color: "#000" },

  summary: {
    backgroundColor: "#fff",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  summaryText: { fontSize: 14, color: "#666" },

  list: { padding: 16 },

  logEntry: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  iconPositive: { backgroundColor: "#dcfce7" },
  iconNegative: { backgroundColor: "#fee2e2" },

  logContent: { flex: 1 },
  logHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  reasonLabel: { fontSize: 15, fontWeight: "600", color: "#000" },
  deltaText: { fontSize: 16, fontWeight: "700" },
  positive: { color: "#16a34a" },
  negative: { color: "#dc2626" },

  logDetails: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 4,
  },
  qtyChange: { fontSize: 13, color: "#666" },
  provider: { fontSize: 12, color: "#999" },

  variant: {
    fontSize: 12,
    color: "#666",
    backgroundColor: "#f3f4f6",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: "flex-start",
    marginBottom: 4,
  },

  orderLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
  },
  orderLinkText: { fontSize: 12, color: theme.colors.primary },

  timestamp: { fontSize: 11, color: "#999", marginTop: 4 },

  loadingMore: { paddingVertical: 16 },

  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  emptyText: { fontSize: 16, color: "#666", marginTop: 12 },
  emptySubtext: { fontSize: 14, color: "#999", marginTop: 4, textAlign: "center" },
});
