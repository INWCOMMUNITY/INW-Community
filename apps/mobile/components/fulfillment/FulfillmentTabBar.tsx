import React from "react";
import { View, Text, Pressable, StyleSheet, ScrollView } from "react-native";
import { theme } from "@/lib/theme";
import type { FulfillmentTabKey } from "@/lib/store-order-fulfillment";

const TABS: { key: FulfillmentTabKey; label: string }[] = [
  { key: "ship", label: "Ship" },
  { key: "pickups", label: "Pickups" },
  { key: "deliveries", label: "Deliveries" },
  { key: "shipped", label: "Shipped" },
  { key: "history", label: "History" },
];

export function FulfillmentTabBar({
  activeTab,
  onTabChange,
  counts,
}: {
  activeTab: FulfillmentTabKey;
  onTabChange: (tab: FulfillmentTabKey) => void;
  counts?: Partial<Record<FulfillmentTabKey, number>>;
}) {
  return (
    <View style={styles.wrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {TABS.map((t) => {
          const count = counts?.[t.key];
          const active = activeTab === t.key;
          const showCount = count != null && count > 0;
          return (
            <Pressable
              key={t.key}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => onTabChange(t.key)}
            >
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{t.label}</Text>
              {showCount ? (
                <View style={[styles.count, active && styles.countActive]}>
                  <Text style={[styles.countText, active && styles.countTextActive]}>{count}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e6e0d6",
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 8,
    flexGrow: 1,
  },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabActive: {
    borderBottomColor: theme.colors.primary,
  },
  tabText: { fontSize: 14, fontWeight: "600", color: "#666" },
  tabTextActive: { color: theme.colors.primary },
  count: {
    minWidth: 20,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: theme.colors.cream,
    alignItems: "center",
  },
  countActive: { backgroundColor: theme.colors.primary },
  countText: { fontSize: 11, fontWeight: "700", color: theme.colors.primary },
  countTextActive: { color: "#fff" },
});
