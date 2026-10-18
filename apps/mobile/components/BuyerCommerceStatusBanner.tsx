import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import type { BuyerCommerceStatus } from "@/lib/order-status";

export function BuyerCommerceStatusBanner({ status }: { status: BuyerCommerceStatus }) {
  const accent = status.tone === "approved" || status.tone === "complete" ? theme.colors.primary : theme.colors.earth;
  return (
    <View style={styles.wrap}>
      <View style={styles.iconWrap}>
        <Ionicons name={status.icon} size={18} color={accent} />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.title, { color: accent }]}>{status.title}</Text>
        <Text style={styles.detail}>{status.detail}</Text>
        {status.note ? <Text style={styles.note}>{status.note}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: theme.colors.creamAlt,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.85)",
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { flex: 1, paddingTop: 1 },
  title: { fontSize: 14, fontWeight: "700" },
  detail: { marginTop: 2, fontSize: 13, lineHeight: 18, color: theme.colors.earth, opacity: 0.8 },
  note: { marginTop: 4, fontSize: 12, lineHeight: 16, color: theme.colors.earth, opacity: 0.7 },
});
