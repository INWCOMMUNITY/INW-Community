import React, { useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  Pressable,
  RefreshControl,
  Dimensions,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet } from "@/lib/api";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

type Period = "7d" | "30d" | "90d";

interface DayGroup {
  date: string;
  views: number;
  cartAdds: number;
  purchases: number;
  revenue: number;
}

interface ItemMetrics {
  storeItemId: string;
  title: string;
  views: number;
  cartAdds: number;
  purchases: number;
  revenue: number;
  conversionRate: number;
}

interface AnalyticsData {
  period: string;
  groupBy: string;
  summary: {
    totalViews: number;
    totalCartAdds: number;
    totalPurchases: number;
    totalRevenueCents: number;
    viewToCartRate: number;
    cartToPurchaseRate: number;
    overallConversionRate: number;
  };
  viewsBySource: {
    web: number;
    mobile: number;
    external: number;
  };
  revenueByChannel: Record<string, number>;
  timeline?: DayGroup[];
  topItems?: ItemMetrics[];
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}

function formatPercent(n: number): string {
  return `${n.toFixed(1)}%`;
}

function SimpleBarChart({ data, maxValue }: { data: DayGroup[]; maxValue: number }) {
  const barWidth = Math.max(4, (SCREEN_WIDTH - 80) / data.length - 2);
  return (
    <View style={styles.chartContainer}>
      <View style={styles.chartBars}>
        {data.map((d, i) => {
          const height = maxValue > 0 ? (d.views / maxValue) * 100 : 0;
          return (
            <View key={d.date} style={styles.barWrapper}>
              <View
                style={[
                  styles.bar,
                  { height: `${Math.max(height, 2)}%`, width: barWidth },
                ]}
              />
              {i % Math.ceil(data.length / 5) === 0 && (
                <Text style={styles.barLabel}>{d.date.slice(5)}</Text>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

export default function AnalyticsScreen() {
  const [period, setPeriod] = useState<Period>("30d");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchAnalytics = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const result = await apiGet<AnalyticsData>(
        `/api/seller-hub/analytics?period=${period}&groupBy=day`
      );
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load analytics");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [period]);

  useFocusEffect(
    useCallback(() => {
      fetchAnalytics();
    }, [fetchAnalytics])
  );

  const handleRefresh = () => fetchAnalytics(true);

  if (loading && !data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Ionicons name="warning-outline" size={48} color="#d32f2f" />
        <Text style={styles.errorText}>{error}</Text>
        <Pressable style={styles.retryBtn} onPress={() => fetchAnalytics()}>
          <Text style={styles.retryBtnText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const maxViews = data?.timeline
    ? Math.max(...data.timeline.map((d) => d.views), 1)
    : 1;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          tintColor={theme.colors.primary}
        />
      }
    >
      {/* Period Selector */}
      <View style={styles.periodSelector}>
        {(["7d", "30d", "90d"] as Period[]).map((p) => (
          <Pressable
            key={p}
            style={[styles.periodBtn, period === p && styles.periodBtnActive]}
            onPress={() => setPeriod(p)}
          >
            <Text
              style={[
                styles.periodBtnText,
                period === p && styles.periodBtnTextActive,
              ]}
            >
              {p === "7d" ? "7 Days" : p === "30d" ? "30 Days" : "90 Days"}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Summary Cards */}
      <View style={styles.summaryGrid}>
        <View style={styles.summaryCard}>
          <Ionicons name="eye-outline" size={24} color={theme.colors.primary} />
          <Text style={styles.summaryValue}>
            {formatNumber(data?.summary.totalViews ?? 0)}
          </Text>
          <Text style={styles.summaryLabel}>Total Views</Text>
        </View>
        <View style={styles.summaryCard}>
          <Ionicons name="cart-outline" size={24} color={theme.colors.primary} />
          <Text style={styles.summaryValue}>
            {formatNumber(data?.summary.totalCartAdds ?? 0)}
          </Text>
          <Text style={styles.summaryLabel}>Cart Adds</Text>
        </View>
        <View style={styles.summaryCard}>
          <Ionicons name="bag-check-outline" size={24} color={theme.colors.primary} />
          <Text style={styles.summaryValue}>
            {formatNumber(data?.summary.totalPurchases ?? 0)}
          </Text>
          <Text style={styles.summaryLabel}>Purchases</Text>
        </View>
        <View style={styles.summaryCard}>
          <Ionicons name="cash-outline" size={24} color={theme.colors.primary} />
          <Text style={styles.summaryValue}>
            {formatPrice(data?.summary.totalRevenueCents ?? 0)}
          </Text>
          <Text style={styles.summaryLabel}>Revenue</Text>
        </View>
      </View>

      {/* Conversion Rates */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Conversion Rates</Text>
        <View style={styles.conversionRow}>
          <View style={styles.conversionItem}>
            <Text style={styles.conversionLabel}>Views → Cart</Text>
            <Text style={styles.conversionValue}>
              {formatPercent(data?.summary.viewToCartRate ?? 0)}
            </Text>
          </View>
          <View style={styles.conversionDivider} />
          <View style={styles.conversionItem}>
            <Text style={styles.conversionLabel}>Cart → Purchase</Text>
            <Text style={styles.conversionValue}>
              {formatPercent(data?.summary.cartToPurchaseRate ?? 0)}
            </Text>
          </View>
          <View style={styles.conversionDivider} />
          <View style={styles.conversionItem}>
            <Text style={styles.conversionLabel}>Overall</Text>
            <Text style={styles.conversionValue}>
              {formatPercent(data?.summary.overallConversionRate ?? 0)}
            </Text>
          </View>
        </View>
      </View>

      {/* Views Timeline */}
      {data?.timeline && data.timeline.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Views Over Time</Text>
          <SimpleBarChart data={data.timeline} maxValue={maxViews} />
        </View>
      )}

      {/* Traffic Sources */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Traffic Sources</Text>
        <View style={styles.sourceList}>
          <View style={styles.sourceRow}>
            <View style={styles.sourceIcon}>
              <Ionicons name="globe-outline" size={20} color="#666" />
            </View>
            <Text style={styles.sourceLabel}>Website</Text>
            <Text style={styles.sourceValue}>
              {formatNumber(data?.viewsBySource.web ?? 0)}
            </Text>
          </View>
          <View style={styles.sourceRow}>
            <View style={styles.sourceIcon}>
              <Ionicons name="phone-portrait-outline" size={20} color="#666" />
            </View>
            <Text style={styles.sourceLabel}>Mobile App</Text>
            <Text style={styles.sourceValue}>
              {formatNumber(data?.viewsBySource.mobile ?? 0)}
            </Text>
          </View>
          <View style={styles.sourceRow}>
            <View style={styles.sourceIcon}>
              <Ionicons name="link-outline" size={20} color="#666" />
            </View>
            <Text style={styles.sourceLabel}>External Links</Text>
            <Text style={styles.sourceValue}>
              {formatNumber(data?.viewsBySource.external ?? 0)}
            </Text>
          </View>
        </View>
      </View>

      {/* Revenue by Channel */}
      {data?.revenueByChannel && Object.keys(data.revenueByChannel).length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Revenue by Channel</Text>
          <View style={styles.sourceList}>
            {Object.entries(data.revenueByChannel).map(([channel, cents]) => (
              <View key={channel} style={styles.sourceRow}>
                <View style={styles.sourceIcon}>
                  <Ionicons
                    name={channel === "inwc" ? "storefront-outline" : "share-social-outline"}
                    size={20}
                    color="#666"
                  />
                </View>
                <Text style={styles.sourceLabel}>
                  {channel === "inwc" ? "INW Community" : channel.toUpperCase()}
                </Text>
                <Text style={styles.sourceValue}>{formatPrice(cents)}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Empty State */}
      {data?.summary.totalViews === 0 && (
        <View style={styles.emptyState}>
          <Ionicons name="analytics-outline" size={48} color="#ccc" />
          <Text style={styles.emptyTitle}>No data yet</Text>
          <Text style={styles.emptyText}>
            Analytics will appear here as customers view and purchase your items.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  content: {
    padding: 16,
    paddingBottom: 32,
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
  periodSelector: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 4,
    marginBottom: 16,
  },
  periodBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 8,
  },
  periodBtnActive: {
    backgroundColor: theme.colors.primary,
  },
  periodBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#666",
  },
  periodBtnTextActive: {
    color: "#fff",
  },
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: -6,
    marginBottom: 16,
  },
  summaryCard: {
    width: "50%",
    paddingHorizontal: 6,
    marginBottom: 12,
  },
  summaryCardInner: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
  },
  summaryValue: {
    fontSize: 24,
    fontWeight: "700",
    color: "#222",
    marginTop: 8,
  },
  summaryLabel: {
    fontSize: 12,
    color: "#666",
    marginTop: 4,
  },
  section: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#222",
    marginBottom: 12,
  },
  conversionRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  conversionItem: {
    flex: 1,
    alignItems: "center",
  },
  conversionDivider: {
    width: 1,
    height: 40,
    backgroundColor: "#eee",
  },
  conversionLabel: {
    fontSize: 12,
    color: "#666",
    marginBottom: 4,
  },
  conversionValue: {
    fontSize: 18,
    fontWeight: "600",
    color: theme.colors.primary,
  },
  chartContainer: {
    height: 120,
    marginTop: 8,
  },
  chartBars: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingBottom: 20,
  },
  barWrapper: {
    alignItems: "center",
  },
  bar: {
    backgroundColor: theme.colors.primary,
    borderRadius: 2,
    minHeight: 2,
  },
  barLabel: {
    fontSize: 9,
    color: "#999",
    marginTop: 4,
    position: "absolute",
    bottom: -16,
  },
  sourceList: {
    gap: 12,
  },
  sourceRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  sourceIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#f0f0f0",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  sourceLabel: {
    flex: 1,
    fontSize: 14,
    color: "#444",
  },
  sourceValue: {
    fontSize: 14,
    fontWeight: "600",
    color: "#222",
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 32,
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
    paddingHorizontal: 32,
  },
});
