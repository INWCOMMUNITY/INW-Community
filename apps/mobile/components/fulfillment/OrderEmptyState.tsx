import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import type { FulfillmentTabKey } from "@/lib/store-order-fulfillment";

const COPY: Record<
  FulfillmentTabKey,
  { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }
> = {
  ship: {
    icon: "boat-outline",
    title: "Nothing to Ship",
    body: "Paid orders with ship fulfillment will appear here when they need a label.",
  },
  pickups: {
    icon: "hand-left-outline",
    title: "No Pickup Orders",
    body: "Orders with in-store pickup will show up here when buyers choose pickup at checkout.",
  },
  deliveries: {
    icon: "car-outline",
    title: "No Local Deliveries",
    body: "Orders with local delivery will appear here when you need to deliver to the buyer.",
  },
  shipped: {
    icon: "cube-outline",
    title: "No Shipped Orders",
    body: "Orders in transit appear here. Reprint Label opens the PDF. Repurchase Label buys a new one.",
  },
  history: {
    icon: "time-outline",
    title: "No History Yet",
    body: "Delivered, canceled, and refunded orders will appear here.",
  },
};

export function OrderEmptyState({ tab }: { tab: FulfillmentTabKey }) {
  const copy = COPY[tab];
  return (
    <View style={styles.box}>
      <Ionicons name={copy.icon} size={36} color={theme.colors.primary} />
      <Text style={styles.title}>{copy.title}</Text>
      <Text style={styles.body}>{copy.body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    marginHorizontal: 0,
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 28,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e6e0d6",
    backgroundColor: "#faf8f4",
    alignItems: "center",
  },
  title: {
    marginTop: 10,
    fontSize: 16,
    fontWeight: "700",
    color: theme.colors.heading,
    textAlign: "center",
  },
  body: {
    marginTop: 6,
    fontSize: 14,
    lineHeight: 20,
    color: "#666",
    textAlign: "center",
    maxWidth: 360,
  },
});
