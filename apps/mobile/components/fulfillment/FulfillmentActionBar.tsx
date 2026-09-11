import React from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { theme } from "@/lib/theme";

export function FulfillmentActionBar({
  selectedCount,
  totalCount,
  savingSlips,
  connected,
  onPurchaseLabels,
  onPrintSlips,
  onSelectAll,
  onClearSelection,
}: {
  selectedCount: number;
  totalCount: number;
  savingSlips: boolean;
  connected: boolean;
  onPurchaseLabels: () => void;
  onPrintSlips: () => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
}) {
  if (selectedCount === 0) return null;

  return (
    <View style={styles.bar}>
      <Text style={styles.count}>
        {selectedCount} of {totalCount} selected
      </Text>
      <Text style={styles.hint}>Same-buyer orders combine into one label purchase per buyer.</Text>
      <View style={styles.row}>
        <Pressable
          style={({ pressed }) => [styles.outlineBtn, pressed && { opacity: 0.8 }]}
          onPress={onClearSelection}
        >
          <Text style={styles.outlineText}>Clear</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.outlineBtn, pressed && { opacity: 0.8 }]}
          onPress={onSelectAll}
        >
          <Text style={styles.outlineText}>Select all</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.outlineBtn, pressed && { opacity: 0.8 }, savingSlips && { opacity: 0.45 }]}
          onPress={onPrintSlips}
          disabled={savingSlips}
        >
          {savingSlips ? (
            <ActivityIndicator size="small" color={theme.colors.primary} />
          ) : (
            <Text style={styles.outlineText}>Print slips</Text>
          )}
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.primaryBtn,
            pressed && { opacity: 0.85 },
            !connected && { opacity: 0.45 },
          ]}
          onPress={onPurchaseLabels}
          disabled={!connected}
        >
          <Text style={styles.primaryText}>Purchase labels</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    borderTopWidth: 1,
    borderTopColor: "#e6e0d6",
    backgroundColor: "#fff",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
  },
  count: { fontSize: 14, fontWeight: "700", color: theme.colors.heading },
  hint: { fontSize: 12, color: "#666", marginTop: 2, marginBottom: 10 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  outlineBtn: {
    borderWidth: 1,
    borderColor: theme.colors.primary,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
    minWidth: 72,
    alignItems: "center",
  },
  outlineText: { fontSize: 13, fontWeight: "600", color: theme.colors.primary },
  primaryBtn: {
    backgroundColor: theme.colors.primary,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
    minWidth: 120,
    alignItems: "center",
  },
  primaryText: { fontSize: 13, fontWeight: "700", color: "#fff" },
});
