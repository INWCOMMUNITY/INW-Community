import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
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
    <View style={styles.row}>
      {TABS.map((t) => {
        const count = counts?.[t.key];
        const active = activeTab === t.key;
        return (
          <Pressable
            key={t.key}
            style={[styles.tab, active && styles.tabActive]}
            onPress={() => onTabChange(t.key)}
          >
            <Text style={[styles.tabText, active && styles.tabTextActive]}>
              {t.label}
              {count != null && count > 0 ? ` (${count})` : ""}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    backgroundColor: "#fff",
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
  tabText: { fontSize: 12, color: "#666" },
  tabTextActive: { fontWeight: "600", color: theme.colors.primary },
});
