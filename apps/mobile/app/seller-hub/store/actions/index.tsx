import React from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { theme } from "@/lib/theme";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

const ACTIONS: Array<
  | { label: string; href: string }
  | { label: string; web: string; webTitle: string }
> = [
  { label: "Manage business profile", href: "/sponsor-business" },
  { label: "Offer coupon", web: `${siteBase}/sponsor-hub/coupon`, webTitle: "Offer a Coupon" },
  { label: "Post event", web: `${siteBase}/sponsor-hub/event`, webTitle: "Post Event" },
  { label: "Offer reward", web: `${siteBase}/sponsor-hub/reward`, webTitle: "Offer a Reward" },
];

export default function ActionsScreen() {
  const router = useRouter();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Other Actions</Text>
      <Text style={styles.hint}>
        Manage your business profile, coupons, events, and rewards.
      </Text>
      {ACTIONS.map((action) => (
        <Pressable
          key={action.label}
          style={({ pressed }) => [styles.card, pressed && { opacity: 0.8 }]}
          onPress={() => {
            if (action.href) {
              (router.push as (href: string) => void)(action.href);
            } else if (action.web) {
              (router.push as (href: string) => void)(
                `/web?url=${encodeURIComponent(action.web)}&title=${encodeURIComponent(action.webTitle ?? action.label)}`
              );
            }
          }}
        >
          <Text style={styles.cardText}>{action.label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 20, fontWeight: "700", marginBottom: 8, color: theme.colors.heading },
  hint: { fontSize: 14, color: "#666", marginBottom: 24 },
  card: {
    backgroundColor: theme.colors.creamAlt,
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: theme.colors.cream,
  },
  cardText: { fontSize: 16, fontWeight: "600", color: theme.colors.primary },
});
