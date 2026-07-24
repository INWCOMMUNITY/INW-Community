import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet } from "@/lib/api";

type ChannelHealth = {
  provider: string;
  status: "healthy" | "degraded" | "error" | "paused";
  circuitState: string;
  errorCount: number;
  retryQueueDepth: number;
  lastSuccessfulSync: string | null;
};

type SyncHealthResponse = {
  overall: "healthy" | "attention_needed" | "degraded";
  channels: ChannelHealth[];
  totalErrors: number;
  totalRetries: number;
  recentFailures: number;
};

const statusColors: Record<ChannelHealth["status"], string> = {
  healthy: "#22c55e",
  degraded: "#f59e0b",
  error: "#ef4444",
  paused: "#6b7280",
};

const statusLabels: Record<ChannelHealth["status"], string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  error: "Error",
  paused: "Paused",
};

const overallColors: Record<SyncHealthResponse["overall"], string> = {
  healthy: "#22c55e",
  attention_needed: "#ef4444",
  degraded: "#f59e0b",
};

const overallIcons: Record<SyncHealthResponse["overall"], keyof typeof Ionicons.glyphMap> = {
  healthy: "checkmark-circle",
  attention_needed: "alert-circle",
  degraded: "warning",
};

const providerNames: Record<string, string> = {
  etsy: "Etsy",
  ebay: "eBay",
  wix: "Wix",
  shopify: "Shopify",
};

export function SyncHealthWidget() {
  const [data, setData] = useState<SyncHealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await apiGet<SyncHealthResponse>("/api/me/sync-health");
      setData(res);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator color={theme.colors.primary} size="small" />
      </View>
    );
  }

  if (!data || data.channels.length === 0) {
    return null;
  }

  const overallColor = overallColors[data.overall];
  const overallIcon = overallIcons[data.overall];

  return (
    <View style={styles.container}>
      <Pressable
        style={styles.header}
        onPress={() => setExpanded(!expanded)}
      >
        <View style={styles.headerLeft}>
          <Ionicons name={overallIcon} size={22} color={overallColor} />
          <View>
            <Text style={styles.title}>Sync Health</Text>
            <Text style={[styles.subtitle, { color: overallColor }]}>
              {data.overall === "healthy"
                ? "All channels operating normally"
                : data.overall === "attention_needed"
                  ? `${data.totalErrors} error${data.totalErrors !== 1 ? "s" : ""} need attention`
                  : `${data.totalRetries} sync${data.totalRetries !== 1 ? "s" : ""} pending retry`}
            </Text>
          </View>
        </View>
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={20}
          color="#9ca3af"
        />
      </Pressable>

      {expanded && (
        <View style={styles.details}>
          {data.channels.map((channel) => (
            <View key={channel.provider} style={styles.channelRow}>
              <View style={styles.channelInfo}>
                <View
                  style={[
                    styles.statusDot,
                    { backgroundColor: statusColors[channel.status] },
                  ]}
                />
                <Text style={styles.channelName}>
                  {providerNames[channel.provider] || channel.provider}
                </Text>
              </View>
              <View style={styles.channelStats}>
                {channel.circuitState !== "CLOSED" && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>
                      {channel.circuitState === "OPEN" ? "Paused" : "Recovering"}
                    </Text>
                  </View>
                )}
                {channel.errorCount > 0 && (
                  <Text style={styles.errorCount}>
                    {channel.errorCount} error{channel.errorCount !== 1 ? "s" : ""}
                  </Text>
                )}
                {channel.retryQueueDepth > 0 && (
                  <Text style={styles.retryCount}>
                    {channel.retryQueueDepth} pending
                  </Text>
                )}
                {channel.status === "healthy" && (
                  <Text style={styles.healthyText}>
                    {statusLabels[channel.status]}
                  </Text>
                )}
              </View>
            </View>
          ))}

          {data.recentFailures > 0 && (
            <Text style={styles.recentFailures}>
              {data.recentFailures} sync failure{data.recentFailures !== 1 ? "s" : ""} in last 24h
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderColor: "#e0e0e0",
    borderRadius: 12,
    marginBottom: 16,
    backgroundColor: "#fafafa",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 14,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  title: {
    fontSize: 15,
    fontWeight: "600",
    color: theme.colors.heading,
  },
  subtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  details: {
    borderTopWidth: 1,
    borderTopColor: "#e0e0e0",
    padding: 14,
    paddingTop: 10,
  },
  channelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
  },
  channelInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  channelName: {
    fontSize: 14,
    fontWeight: "500",
    color: theme.colors.heading,
  },
  channelStats: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  badge: {
    backgroundColor: "#fee2e2",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#dc2626",
  },
  errorCount: {
    fontSize: 12,
    color: "#ef4444",
    fontWeight: "500",
  },
  retryCount: {
    fontSize: 12,
    color: "#f59e0b",
    fontWeight: "500",
  },
  healthyText: {
    fontSize: 12,
    color: "#22c55e",
    fontWeight: "500",
  },
  recentFailures: {
    fontSize: 12,
    color: "#9ca3af",
    marginTop: 8,
    textAlign: "center",
  },
});
