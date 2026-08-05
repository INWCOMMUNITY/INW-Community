import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPost } from "@/lib/api";

type ChannelHealth = {
  provider: string;
  connectionId: string;
  connectionStatus: string;
  status: "healthy" | "warning" | "error";
  lastSyncAt: string | null;
  pendingRetries: number;
  errorCount24h: number;
  totalLinkedItems: number;
  itemsWithErrors: number;
  itemsWithConflicts: number;
  categoriesMapped: number;
  categoriesUnmapped: number;
  lastError: string | null;
};

type SyncIssue = {
  id: string;
  storeItemId: string;
  storeItemTitle: string;
  provider: string;
  issueType: "error" | "conflict" | "pending_retry";
  syncStatus: string;
  syncError: string | null;
  conflictResolution: string | null;
  lastConflictAt: string | null;
  nextRetryAt: string | null;
  retryAttempts: number;
};

const PROVIDER_NAMES: Record<string, string> = {
  etsy: "Etsy",
  ebay: "eBay",
  shopify: "Shopify",
  wix: "Wix",
};

const PROVIDER_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  etsy: "storefront-outline",
  ebay: "pricetags-outline",
  shopify: "bag-handle-outline",
  wix: "globe-outline",
};

function StatusBadge({ status }: { status: "healthy" | "warning" | "error" }) {
  const colors = {
    healthy: { bg: "#dcfce7", text: "#16a34a" },
    warning: { bg: "#fef3c7", text: "#d97706" },
    error: { bg: "#fee2e2", text: "#dc2626" },
  };
  const labels = {
    healthy: "Healthy",
    warning: "Warning",
    error: "Error",
  };
  return (
    <View style={[styles.statusBadge, { backgroundColor: colors[status].bg }]}>
      <Text style={[styles.statusBadgeText, { color: colors[status].text }]}>
        {labels[status]}
      </Text>
    </View>
  );
}

export default function SyncHealthScreen() {
  const router = useRouter();
  const [channels, setChannels] = useState<ChannelHealth[]>([]);
  const [issues, setIssues] = useState<SyncIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [overallStatus, setOverallStatus] = useState<"healthy" | "warning" | "error">("healthy");

  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const [healthRes, issuesRes] = await Promise.all([
        apiGet<{ channels: ChannelHealth[]; overallStatus: "healthy" | "warning" | "error" }>(
          "/api/seller/sync-health"
        ),
        apiGet<{ issues: SyncIssue[] }>("/api/seller/sync-issues?limit=20"),
      ]);
      setChannels(healthRes.channels);
      setOverallStatus(healthRes.overallStatus);
      setIssues(issuesRes.issues);
    } catch (e) {
      console.error("Failed to load sync health:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const handleRetryAll = async (connectionId: string, provider: string) => {
    setRetrying(connectionId);
    try {
      const result = await apiPost<{ retriedCount: number }>("/api/seller/sync-health", {
        connectionId,
      });
      Alert.alert(
        "Retry Scheduled",
        `${result.retriedCount} items will be re-synced to ${PROVIDER_NAMES[provider] ?? provider}.`
      );
      loadData();
    } catch (e) {
      Alert.alert("Error", "Failed to retry sync. Please try again.");
    } finally {
      setRetrying(null);
    }
  };

  const formatTime = (dateStr: string | null) => {
    if (!dateStr) return "Never";
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    if (diff < 60 * 1000) return "Just now";
    if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60 / 1000)}m ago`;
    if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 60 / 60 / 1000)}h ago`;
    return date.toLocaleDateString();
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => loadData(true)} />
      }
    >
      {/* Overall Status */}
      <View style={styles.overallCard}>
        <View style={styles.overallHeader}>
          <Ionicons
            name={
              overallStatus === "healthy"
                ? "checkmark-circle"
                : overallStatus === "warning"
                ? "alert-circle"
                : "close-circle"
            }
            size={32}
            color={
              overallStatus === "healthy"
                ? "#16a34a"
                : overallStatus === "warning"
                ? "#d97706"
                : "#dc2626"
            }
          />
          <Text style={styles.overallTitle}>
            {overallStatus === "healthy"
              ? "All Channels Healthy"
              : overallStatus === "warning"
              ? "Some Issues Detected"
              : "Sync Issues"}
          </Text>
        </View>
        <Text style={styles.overallSubtext}>
          {channels.length} connected channel{channels.length !== 1 ? "s" : ""}
        </Text>
      </View>

      {/* Channel Cards */}
      <Text style={styles.sectionTitle}>Connected Channels</Text>
      {channels.length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="unlink-outline" size={32} color="#999" />
          <Text style={styles.emptyText}>No channels connected</Text>
          <Pressable
            style={styles.connectButton}
            onPress={() => router.push("/seller-hub/channels")}
          >
            <Text style={styles.connectButtonText}>Connect a Channel</Text>
          </Pressable>
        </View>
      ) : (
        channels.map((channel) => (
          <View key={channel.connectionId} style={styles.channelCard}>
            <View style={styles.channelHeader}>
              <View style={styles.channelInfo}>
                <Ionicons
                  name={PROVIDER_ICONS[channel.provider] ?? "link-outline"}
                  size={24}
                  color={theme.colors.primary}
                />
                <Text style={styles.channelName}>
                  {PROVIDER_NAMES[channel.provider] ?? channel.provider}
                </Text>
              </View>
              <StatusBadge status={channel.status} />
            </View>

            <View style={styles.channelStats}>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{channel.totalLinkedItems}</Text>
                <Text style={styles.statLabel}>Linked</Text>
              </View>
              <View style={styles.stat}>
                <Text style={[styles.statValue, channel.itemsWithErrors > 0 && styles.statError]}>
                  {channel.itemsWithErrors}
                </Text>
                <Text style={styles.statLabel}>Errors</Text>
              </View>
              <View style={styles.stat}>
                <Text style={[styles.statValue, channel.pendingRetries > 0 && styles.statWarning]}>
                  {channel.pendingRetries}
                </Text>
                <Text style={styles.statLabel}>Pending</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{formatTime(channel.lastSyncAt)}</Text>
                <Text style={styles.statLabel}>Last Sync</Text>
              </View>
            </View>

            {channel.lastError && (
              <View style={styles.errorBox}>
                <Ionicons name="warning-outline" size={16} color="#dc2626" />
                <Text style={styles.errorText} numberOfLines={2}>
                  {channel.lastError}
                </Text>
              </View>
            )}

            {channel.itemsWithErrors > 0 && (
              <Pressable
                style={[styles.retryButton, retrying === channel.connectionId && styles.retryButtonDisabled]}
                onPress={() => handleRetryAll(channel.connectionId, channel.provider)}
                disabled={retrying === channel.connectionId}
              >
                {retrying === channel.connectionId ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="refresh-outline" size={18} color="#fff" />
                    <Text style={styles.retryButtonText}>Retry All Failed</Text>
                  </>
                )}
              </Pressable>
            )}
          </View>
        ))
      )}

      {/* Recent Issues */}
      {issues.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Recent Issues</Text>
          {issues.map((issue) => (
            <Pressable
              key={issue.id}
              style={styles.issueCard}
              onPress={() => router.push(`/product/${issue.storeItemId}`)}
            >
              <View style={styles.issueHeader}>
                <Ionicons
                  name={PROVIDER_ICONS[issue.provider] ?? "link-outline"}
                  size={18}
                  color="#666"
                />
                <Text style={styles.issueTitle} numberOfLines={1}>
                  {issue.storeItemTitle}
                </Text>
                <View
                  style={[
                    styles.issueTypeBadge,
                    issue.issueType === "error"
                      ? styles.issueTypeError
                      : issue.issueType === "conflict"
                      ? styles.issueTypeConflict
                      : styles.issueTypePending,
                  ]}
                >
                  <Text style={styles.issueTypeBadgeText}>
                    {issue.issueType === "pending_retry" ? "Pending" : issue.issueType}
                  </Text>
                </View>
              </View>
              {issue.syncError && (
                <Text style={styles.issueError} numberOfLines={2}>
                  {issue.syncError}
                </Text>
              )}
              {issue.nextRetryAt && (
                <Text style={styles.issueRetry}>
                  Retry in {formatTime(issue.nextRetryAt)}
                </Text>
              )}
            </Pressable>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  content: { padding: 16, paddingBottom: 32 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },

  overallCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  overallHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 8,
  },
  overallTitle: { fontSize: 18, fontWeight: "700", color: "#000" },
  overallSubtext: { fontSize: 14, color: "#666" },

  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    marginBottom: 12,
    marginTop: 8,
  },

  emptyCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 32,
    alignItems: "center",
  },
  emptyText: { fontSize: 14, color: "#666", marginTop: 8, marginBottom: 16 },
  connectButton: {
    backgroundColor: theme.colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  connectButtonText: { color: "#fff", fontWeight: "600" },

  channelCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  channelHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  channelInfo: { flexDirection: "row", alignItems: "center", gap: 10 },
  channelName: { fontSize: 16, fontWeight: "600", color: "#000" },

  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusBadgeText: { fontSize: 12, fontWeight: "600" },

  channelStats: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: "#eee",
  },
  stat: { alignItems: "center" },
  statValue: { fontSize: 18, fontWeight: "700", color: "#000" },
  statLabel: { fontSize: 12, color: "#666", marginTop: 2 },
  statError: { color: "#dc2626" },
  statWarning: { color: "#d97706" },

  errorBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: "#fee2e2",
    padding: 10,
    borderRadius: 8,
    marginTop: 8,
  },
  errorText: { flex: 1, fontSize: 12, color: "#dc2626" },

  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: theme.colors.primary,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 12,
  },
  retryButtonDisabled: { opacity: 0.5 },
  retryButtonText: { color: "#fff", fontWeight: "600" },

  issueCard: {
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: "#dc2626",
  },
  issueHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  issueTitle: { flex: 1, fontSize: 14, fontWeight: "600", color: "#000" },
  issueTypeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  issueTypeError: { backgroundColor: "#fee2e2" },
  issueTypeConflict: { backgroundColor: "#fef3c7" },
  issueTypePending: { backgroundColor: "#e0e7ff" },
  issueTypeBadgeText: { fontSize: 10, fontWeight: "600", color: "#666" },
  issueError: { fontSize: 12, color: "#666", marginTop: 6 },
  issueRetry: { fontSize: 11, color: "#999", marginTop: 4 },
});
