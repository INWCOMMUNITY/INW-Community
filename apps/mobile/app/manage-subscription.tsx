import { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { useAuth } from "@/contexts/AuthContext";
import { apiPost } from "@/lib/api";
import { syncStripeSubscriptionsFromClient } from "@/lib/subscription-checkout-entitlements";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

function planDisplay(plan: string): string {
  if (plan === "subscribe") return "Resident Subscribe";
  if (plan === "sponsor") return "Business";
  if (plan === "seller") return "Seller";
  return plan;
}

export default function ManageSubscriptionScreen() {
  const router = useRouter();
  const { member, refreshMember } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);

  const paidStatuses = new Set(["active", "trialing", "past_due"]);
  const activeSub = member?.subscriptions?.find((s) => paidStatuses.has(s.status));
  const currentPlan = activeSub?.plan ?? null;

  const openBillingPortal = async () => {
    setBusy("portal");
    try {
      const res = await apiPost<{ url?: string; error?: string }>(
        "/api/stripe/billing-portal",
        { returnBaseUrl: siteBase }
      );
      if (res?.url) {
        const webUrl =
          `/web?url=${encodeURIComponent(res.url)}&title=${encodeURIComponent("Payment method & invoices")}` +
          `&successPattern=${encodeURIComponent("my-community/subscriptions")}` +
          `&successRoute=${encodeURIComponent("/manage-subscription")}` +
          "&refreshOnSuccess=1";
        router.push(webUrl as never);
      } else {
        Alert.alert("Error", res?.error ?? "Could not open billing portal.");
      }
    } catch (e) {
      Alert.alert(
        "Error",
        (e as { error?: string })?.error ?? "Could not open billing portal."
      );
    } finally {
      setBusy(null);
    }
  };

  const changePlan = (planId: "subscribe" | "sponsor" | "seller") => {
    if (planId === currentPlan) {
      Alert.alert("Already on this plan", "Choose a different plan to switch.");
      return;
    }
    Alert.alert(
      "Switch plan?",
      "Your new price applies on your next billing date (no proration). You get the new plan’s perks right away.",
      [
        { text: "Not now", style: "cancel" },
        {
          text: "Switch",
          onPress: async () => {
            setBusy(`plan-${planId}`);
            try {
              await apiPost("/api/stripe/subscription/change-plan", {
                planId,
                interval: "monthly",
              });
              await syncStripeSubscriptionsFromClient();
              await refreshMember?.();
              Alert.alert("Plan updated", "Billing will move to the new price on your next renewal.");
            } catch (e) {
              Alert.alert(
                "Could not switch",
                (e as { error?: string })?.error ?? "Try again or use the billing portal."
              );
            } finally {
              setBusy(null);
            }
          },
        },
      ]
    );
  };

  const cancelMembership = () => {
    Alert.alert(
      "Cancel membership?",
      "This ends your paid membership. Listings, coupons, rewards, and directory pages tied to the plan are removed per our policy.",
      [
        { text: "Keep membership", style: "cancel" },
        {
          text: "Cancel now",
          style: "destructive",
          onPress: async () => {
            setBusy("cancel");
            try {
              await apiPost("/api/stripe/subscription/cancel", {});
              await syncStripeSubscriptionsFromClient();
              await refreshMember?.();
              Alert.alert("Canceled", "Your membership has been canceled.", [
                { text: "OK", onPress: () => router.back() },
              ]);
            } catch (e) {
              Alert.alert(
                "Could not cancel",
                (e as { error?: string })?.error ?? "Try the billing portal or contact support."
              );
            } finally {
              setBusy(null);
            }
          },
        },
      ]
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.heading} />
        </Pressable>
        <Text style={styles.headerTitle}>Manage subscription</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.currentLabel}>Current plan</Text>
        <Text style={styles.currentValue}>
          {currentPlan ? planDisplay(currentPlan) : "No active membership"}
        </Text>
        <Text style={styles.hint}>
          Update your card or view invoices in Stripe&apos;s secure portal. Switch plans here;
          billing changes apply on your next cycle unless noted in the portal.
        </Text>

        <Pressable
          style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
          onPress={openBillingPortal}
          disabled={busy !== null}
        >
          {busy === "portal" ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryBtnText}>Payment method & invoices</Text>
          )}
        </Pressable>

        <Text style={styles.sectionTitle}>Change plan</Text>
        {(["subscribe", "sponsor", "seller"] as const).map((p) => (
          <Pressable
            key={p}
            style={({ pressed }) => [
              styles.planRow,
              currentPlan === p && styles.planRowCurrent,
              pressed && styles.pressed,
            ]}
            onPress={() => changePlan(p)}
            disabled={busy !== null}
          >
            <Text style={styles.planRowText}>{planDisplay(p)}</Text>
            {currentPlan === p ? (
              <Text style={styles.planBadge}>Current</Text>
            ) : busy === `plan-${p}` ? (
              <ActivityIndicator size="small" color={theme.colors.primary} />
            ) : (
              <Ionicons name="chevron-forward" size={20} color="#999" />
            )}
          </Pressable>
        ))}

        <Text style={styles.sectionTitle}>Cancel</Text>
        <Pressable
          style={({ pressed }) => [styles.dangerBtn, pressed && styles.pressed]}
          onPress={cancelMembership}
          disabled={!currentPlan || busy !== null}
        >
          {busy === "cancel" ? (
            <ActivityIndicator color="#c62828" />
          ) : (
            <Text style={styles.dangerBtnText}>Cancel membership</Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 12,
    paddingTop: 48,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  backBtn: { padding: 8, width: 40 },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    color: "#333",
    textAlign: "center",
  },
  scroll: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
  currentLabel: { fontSize: 13, color: "#666", marginBottom: 4 },
  currentValue: { fontSize: 22, fontWeight: "700", color: theme.colors.heading, marginBottom: 12 },
  hint: { fontSize: 14, color: "#666", lineHeight: 20, marginBottom: 20 },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: theme.colors.heading,
    marginTop: 20,
    marginBottom: 10,
  },
  primaryBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  primaryBtnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  planRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#ddd",
    marginBottom: 8,
    backgroundColor: "#fafafa",
  },
  planRowCurrent: { borderColor: theme.colors.primary, backgroundColor: `${theme.colors.primary}12` },
  planRowText: { fontSize: 16, color: "#333", fontWeight: "500" },
  planBadge: { fontSize: 13, color: theme.colors.primary, fontWeight: "600" },
  dangerBtn: {
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#c62828",
  },
  dangerBtnText: { color: "#c62828", fontSize: 16, fontWeight: "600" },
  pressed: { opacity: 0.85 },
});
