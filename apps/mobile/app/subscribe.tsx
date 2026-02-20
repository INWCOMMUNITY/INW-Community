import { useCallback, useEffect } from "react";
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { getToken } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

const PLANS = [
  {
    id: "subscribe",
    name: "Subscribe",
    price: "$4.99/mo",
    icon: "leaf" as const,
    description:
      "Support Northwest Community and get 2x points, access to coupons, exclusive events, resale marketplace, and more.",
    features: [
      "2x Community Points on all purchases",
      "Access to exclusive coupons",
      "Resale marketplace access",
      "Community events & calendar",
      "Support local businesses",
    ],
    webPath: "/support-nwc#subscribe",
  },
  {
    id: "sponsor",
    name: "Sponsor (Local Business)",
    price: "$19.99/mo",
    icon: "storefront" as const,
    description:
      "List your local business on the NWC directory. Includes a full business page, coupons, rewards, events, and all Subscriber benefits.",
    features: [
      "Everything in Subscribe",
      "Full business profile page",
      "Create coupons & rewards",
      "Post events on the calendar",
      "QR code for customer points",
      "Business Hub management",
    ],
    webPath: "/support-nwc#sponsor",
  },
  {
    id: "seller",
    name: "Seller",
    price: "$29.99/mo",
    icon: "cart" as const,
    description:
      "Sell products on the NWC Storefront. Includes a full online store, shipping management, and all Sponsor benefits.",
    features: [
      "Everything in Sponsor",
      "Online storefront with listings",
      "Shipping & fulfillment tools",
      "Seller Hub management",
      "Local delivery & pickup options",
      "Sales analytics & payouts",
    ],
    webPath: "/support-nwc#seller",
  },
];

export default function SubscribeScreen() {
  const router = useRouter();
  const { member, loading: authLoading } = useAuth();

  useEffect(() => {
    let cancelled = false;
    getToken().then((token) => {
      if (!cancelled && !token) {
        router.replace({
          pathname: "/signin",
          params: { plan: "subscribe", returnTo: "/subscribe" },
        } as never);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (authLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Support NWC</Text>
        <View style={{ width: 32 }} />
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.logoWrap}>
          <Image
            source={require("@/assets/images/nwc-community-logo.png")}
            style={styles.logo}
            resizeMode="contain"
            accessibilityLabel="Northwest Community"
          />
        </View>
        <Text style={styles.intro}>
          Choose a plan to support Northwest Community and unlock features for you and local businesses.
        </Text>

        {PLANS.map((plan) => {
          const hasPlan = member?.subscriptions?.some(
            (s) => s.plan === plan.id
          );
          return (
            <View
              key={plan.id}
              style={[styles.planCard, hasPlan && styles.planCardActive]}
            >
              <View style={styles.planHeader}>
                <Ionicons name={plan.icon} size={24} color={theme.colors.primary} />
                <Text style={styles.planName}>{plan.name}</Text>
                <Text style={styles.planPrice}>{plan.price}</Text>
              </View>
              <Text style={styles.planDesc}>{plan.description}</Text>
              <View style={styles.featureList}>
                {plan.features.map((f, i) => (
                  <View key={i} style={styles.featureRow}>
                    <Ionicons name="checkmark-circle" size={16} color={theme.colors.primary} />
                    <Text style={styles.featureText}>{f}</Text>
                  </View>
                ))}
              </View>
              {hasPlan ? (
                <View style={styles.activeBadge}>
                  <Text style={styles.activeBadgeText}>Current Plan</Text>
                </View>
              ) : (
                <Pressable
                  style={({ pressed }) => [
                    styles.learnMoreBtn,
                    pressed && { opacity: 0.8 },
                  ]}
                  onPress={() =>
                    router.push(
                      `/web?url=${encodeURIComponent(siteBase + plan.webPath)}&title=${encodeURIComponent(plan.name)}` as import("expo-router").Href
                    )
                  }
                >
                  <Text style={styles.learnMoreText}>Learn More</Text>
                </Pressable>
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 12,
    paddingTop: 48,
    backgroundColor: theme.colors.primary,
    borderBottomWidth: 2,
    borderBottomColor: "#000",
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 20, fontWeight: "600", color: "#fff" },
  scroll: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 48 },
  logoWrap: { alignItems: "center", marginBottom: 16 },
  logo: { width: 80, height: 80, borderRadius: 40 },
  intro: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
    lineHeight: 24,
    marginBottom: 24,
  },
  planCard: {
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
    backgroundColor: "#fff",
  },
  planCardActive: {
    backgroundColor: `${theme.colors.primary}10`,
  },
  planHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },
  planName: {
    flex: 1,
    fontSize: 18,
    fontWeight: "700",
    color: theme.colors.heading,
  },
  planPrice: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.primary,
  },
  planDesc: {
    fontSize: 14,
    color: "#555",
    lineHeight: 20,
    marginBottom: 12,
  },
  featureList: { marginBottom: 16 },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 4,
  },
  featureText: {
    fontSize: 14,
    color: "#444",
    flex: 1,
  },
  activeBadge: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
  },
  activeBadgeText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  learnMoreBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  learnMoreText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
});
