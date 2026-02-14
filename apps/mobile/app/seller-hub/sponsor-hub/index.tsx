import React from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { theme } from "@/lib/theme";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

const OPTIONS = [
  { label: "Business profile", href: "/sponsor-business" },
  { label: "Offer a coupon", web: `${siteBase}/sponsor-hub/coupon` },
  { label: "Post event", web: `${siteBase}/sponsor-hub/event` },
  { label: "Offer a reward", web: `${siteBase}/sponsor-hub/reward` },
];

export default function SponsorHubScreen() {
  const router = useRouter();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Sponsor Hub</Text>
      <Text style={styles.hint}>
        Business directory, coupons, events, and rewards.
      </Text>
      {OPTIONS.map((opt) => (
        <Pressable
          key={opt.label}
          style={({ pressed }) => [styles.card, pressed && { opacity: 0.8 }]}
          onPress={() => {
            if (opt.href) {
              (router.push as (href: string) => void)(opt.href);
            } else if (opt.web) {
              (router.push as (href: string) => void)(
                `/web?url=${encodeURIComponent(opt.web)}&title=${encodeURIComponent(opt.label)}`
              );
            }
          }}
        >
          <Text style={styles.cardText}>{opt.label}</Text>
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
