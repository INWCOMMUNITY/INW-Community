import { useState, useEffect } from "react";
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { getToken, apiPost } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

const API_URL = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_URL.replace(/\/api.*$/, "").replace(/\/$/, "");

const PLANS = [
  {
    id: "subscribe",
    name: "Subscribe",
    price: "$1-$15/mo",
    priceYearly: "",
    icon: "leaf" as const,
    description:
      "Support Northwest Community and get 2× points, access to coupons, exclusive events, community marketplace, and more. From $1/mo (pay what you can).",
    features: [
      "2x Community Points on all purchases",
      "Access to exclusive coupons",
      "Resale marketplace access",
      "Community events & calendar",
      "Support local businesses",
    ],
    webPath: "/support-nwc#resident-pwyc",
  },
  {
    id: "sponsor",
    name: "Business",
    price: "$25/mo",
    priceYearly: "$100/yr Summer",
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
    price: "$30/mo",
    priceYearly: "$100/yr Summer",
    icon: "cart" as const,
    description:
      "Sell products on the NWC Storefront. Includes a full online store, shipping management, and all Business plan benefits.",
    features: [
      "Everything in Business",
      "Online storefront with listings",
      "Shipping & fulfillment tools",
      "Seller Hub management",
      "Local delivery & pickup options",
      "Sales analytics & payouts",
    ],
    webPath: "/support-nwc#seller",
  },
];

function checkoutLoadingKey(
  planId: string,
  interval: "monthly" | "yearly" = "monthly",
  subscribeTierDollars?: number
) {
  if (planId === "subscribe" && interval === "monthly") {
    return `subscribe:${subscribeTierDollars ?? 0}`;
  }
  return interval === "monthly" ? planId : `${planId}:yearly`;
}

export default function SubscribeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { member, loading: authLoading } = useAuth();
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [residentTier, setResidentTier] = useState(10);

  const startCheckout = async (
    planId: string,
    interval: "monthly" | "yearly" = "monthly",
    subscribeTierDollars?: number
  ) => {
    const tierForKey =
      planId === "subscribe" && interval === "monthly" ? subscribeTierDollars ?? residentTier : undefined;
    setCheckoutLoading(checkoutLoadingKey(planId, interval, tierForKey));
    try {
      const token = await getToken();
      if (!token) {
        router.replace({ pathname: "/signin", params: { plan: planId, returnTo: "/subscribe" } } as never);
        return;
      }
      try {
        const body: Record<string, unknown> = {
          planId,
          interval,
          returnBaseUrl: siteBase,
        };
        if (
          planId === "subscribe" &&
          interval === "monthly" &&
          typeof subscribeTierDollars === "number" &&
          Number.isInteger(subscribeTierDollars)
        ) {
          body.subscribeTierDollars = subscribeTierDollars;
        }
        const data = await apiPost<{ url?: string; error?: string }>("/api/stripe/checkout", body);
        if (data.url) {
          router.push(
            `/web?url=${encodeURIComponent(data.url)}&title=${encodeURIComponent("Checkout")}` +
              `&successPattern=${encodeURIComponent("my-community")}` +
              `&successRoute=${encodeURIComponent("/(tabs)/my-community")}` +
              "&refreshOnSuccess=1" as import("expo-router").Href
          );
          return;
        }
        alert(data.error ?? "Could not start checkout. Please try again.");
      } catch (e) {
        const err = e as { status?: number };
        if (err.status === 401) {
          router.replace({ pathname: "/signin", params: { returnTo: "/subscribe" } } as never);
          return;
        }
        alert((e as { error?: string }).error ?? "Could not start checkout. Please try again.");
      }
    } catch {
      alert("Something went wrong. Please try again.");
    } finally {
      setCheckoutLoading(null);
    }
  };

  if (authLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
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
                <>
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
                  {plan.id === "subscribe" ? (
                    <View style={styles.tierWrap}>
                      <Text style={styles.tierLabel}>Pay what you can</Text>
                      <View style={styles.tierRow}>
                        <Pressable
                          onPress={() => setResidentTier((t) => Math.max(1, t - 1))}
                          disabled={residentTier <= 1 || checkoutLoading !== null}
                          style={({ pressed }) => [
                            styles.tierStepBtn,
                            (residentTier <= 1 || checkoutLoading !== null) && styles.tierStepBtnDisabled,
                            pressed && { opacity: 0.85 },
                          ]}
                        >
                          <Text style={styles.tierStepBtnText}>−</Text>
                        </Pressable>
                        <Text style={styles.tierAmount}>${residentTier}/mo</Text>
                        <Pressable
                          onPress={() => setResidentTier((t) => Math.min(15, t + 1))}
                          disabled={residentTier >= 15 || checkoutLoading !== null}
                          style={({ pressed }) => [
                            styles.tierStepBtn,
                            (residentTier >= 15 || checkoutLoading !== null) && styles.tierStepBtnDisabled,
                            pressed && { opacity: 0.85 },
                          ]}
                        >
                          <Text style={styles.tierStepBtnText}>+</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : null}
                  <Pressable
                    style={({ pressed }) => [
                      styles.subscribeBtn,
                      pressed && { opacity: 0.8 },
                      checkoutLoading !== null && styles.subscribeBtnDisabled,
                    ]}
                    onPress={() => {
                      if (plan.id === "subscribe") {
                        startCheckout(plan.id, "monthly", residentTier);
                      } else if (plan.id === "sponsor") {
                        router.push(
                          (member ? "/signup-business?start=business" : "/signup-business") as import("expo-router").Href
                        );
                      } else if (plan.id === "seller") {
                        router.push(
                          (member ? "/signup-seller?start=business" : "/signup-seller") as import("expo-router").Href
                        );
                      }
                    }}
                    disabled={checkoutLoading !== null}
                  >
                    {plan.id === "subscribe" &&
                    checkoutLoading === checkoutLoadingKey(plan.id, "monthly", residentTier) ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.subscribeBtnText}>
                        {plan.id === "subscribe" ? "Subscribe" : "Get started"}
                      </Text>
                    )}
                  </Pressable>
                  {(plan.id === "sponsor" || plan.id === "seller") ? (
                    <Pressable
                      style={({ pressed }) => [
                        styles.summerPromoBtn,
                        pressed && { opacity: 0.85 },
                        checkoutLoading !== null && styles.subscribeBtnDisabled,
                      ]}
                      onPress={() => startCheckout(plan.id, "yearly")}
                      disabled={checkoutLoading !== null}
                    >
                      {checkoutLoading === checkoutLoadingKey(plan.id, "yearly") ? (
                        <ActivityIndicator size="small" color={theme.colors.primary} />
                      ) : (
                        <>
                          <Text style={styles.summerPromoTitle}>Summer Startup Promo</Text>
                          <Text style={styles.summerPromoPrice}>$100/year</Text>
                        </>
                      )}
                    </Pressable>
                  ) : null}
                </>
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
    marginBottom: 10,
  },
  learnMoreText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  tierWrap: {
    marginBottom: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ddd",
    backgroundColor: "#fafafa",
  },
  tierLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.heading,
    textAlign: "center",
    marginBottom: 8,
  },
  tierRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
  },
  tierStepBtn: {
    minWidth: 44,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#000",
  },
  tierStepBtnDisabled: {
    opacity: 0.35,
  },
  tierStepBtnText: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "700",
    lineHeight: 26,
  },
  tierAmount: {
    fontSize: 18,
    fontWeight: "700",
    color: theme.colors.heading,
    minWidth: 88,
    textAlign: "center",
  },
  subscribeBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#000",
  },
  subscribeBtnDisabled: { opacity: 0.7 },
  subscribeBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  summerPromoBtn: {
    marginTop: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: theme.colors.primary,
    backgroundColor: "#fff",
  },
  summerPromoTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: theme.colors.heading,
  },
  summerPromoPrice: {
    fontSize: 14,
    fontWeight: "500",
    color: theme.colors.primary,
    marginTop: 2,
  },
});
