import { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPost } from "@/lib/api";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

interface TodoItem {
  id: string;
  label: string;
  description: string;
  href?: string;
  onPress?: () => void;
  completed: boolean;
}

export default function ResaleHubBeforeYouStartScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [hasStripeConnect, setHasStripeConnect] = useState(false);
  const [hasShippo, setHasShippo] = useState(false);
  const [stripeLoading, setStripeLoading] = useState(false);

  const [hasPolicies, setHasPolicies] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [funds, shipping, me] = await Promise.all([
        apiGet<{ hasStripeConnect?: boolean } | { error?: string }>("/api/seller-funds"),
        apiGet<{ connected?: boolean } | { error?: string }>("/api/shipping/status"),
        apiGet<{
          sellerShippingPolicy?: string | null;
          sellerLocalDeliveryPolicy?: string | null;
          sellerPickupPolicy?: string | null;
          sellerReturnPolicy?: string | null;
        }>("/api/me"),
      ]);
      setHasStripeConnect(Boolean((funds as { hasStripeConnect?: boolean }).hasStripeConnect));
      setHasShippo(Boolean((shipping as { connected?: boolean }).connected));
      const p = me as {
        sellerShippingPolicy?: string | null;
        sellerLocalDeliveryPolicy?: string | null;
        sellerPickupPolicy?: string | null;
        sellerReturnPolicy?: string | null;
      };
      const anyPolicy = [p?.sellerShippingPolicy, p?.sellerLocalDeliveryPolicy, p?.sellerPickupPolicy, p?.sellerReturnPolicy]
        .some((v) => typeof v === "string" && v.trim().length > 0);
      setHasPolicies(anyPolicy);
    } catch {
      setHasStripeConnect(false);
      setHasShippo(false);
      setHasPolicies(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleStripeSetup = async () => {
    setStripeLoading(true);
    try {
      const res = await apiPost<{ url?: string; error?: string }>("/api/stripe/connect/onboard", {
        returnBaseUrl: siteBase,
      });
      if (res?.url) {
        const webUrl =
          `/web?url=${encodeURIComponent(res.url)}&title=Payment setup` +
          `&successPattern=${encodeURIComponent("seller-hub/store")}` +
          `&successRoute=${encodeURIComponent("/resale-hub/before-you-start")}` +
          "&refreshOnSuccess=1";
        router.push(webUrl as never);
      } else if (res?.error) {
        Alert.alert("Setup failed", res.error);
      }
    } catch (e: unknown) {
      const err = e as { error?: string; status?: number };
      const message = err?.error ?? (e instanceof Error ? e.message : "Please try again later.");
      Alert.alert(
        "Could not start payment setup",
        message,
        [
          { text: "OK" },
          {
            text: "Try Payouts page",
            onPress: () => router.push("/seller-hub/store/payouts"),
          },
        ]
      );
    } finally {
      setStripeLoading(false);
    }
  };

  const todoItems: TodoItem[] = [
    {
      id: "stripe",
      label: "Set up Stripe payments",
      description: "Connect your bank account to receive payouts from sales",
      completed: hasStripeConnect,
      onPress: hasStripeConnect ? undefined : handleStripeSetup,
    },
    {
      id: "shippo",
      label: "Set up Shippo for shipping",
      description: "Connect Shippo to buy shipping labels for orders",
      completed: hasShippo,
      href: "/seller-hub/shipping-setup",
    },
    {
      id: "policies",
      label: "Set your policies",
      description: "Shipping, delivery, pickup, and refund policies for your resale listings",
      completed: hasPolicies,
      href: "/policies",
    },
  ];

  const allComplete = hasStripeConnect && hasShippo && hasPolicies;
  const title = allComplete ? "Checklist" : "Before You Start";
  const subtitle = allComplete
    ? "You're all set. You can still open the links below to update or view."
    : "Complete these steps to start selling in Resale Hub. Set up payments, shipping, and your policies.";

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>

      <View style={styles.todoList}>
        {todoItems.map((item) => (
          <Pressable
            key={item.id}
            style={({ pressed }) => [
              styles.todoItem,
              item.completed && styles.todoItemCompleted,
              pressed && !item.completed && styles.todoItemPressed,
            ]}
            onPress={() => {
              if (item.completed && (item.id === "stripe" || item.id === "shippo")) return;
              if (item.onPress) item.onPress();
              else if (item.href) router.push(item.href as never);
            }}
            disabled={item.id === "stripe" && stripeLoading}
          >
            <View style={styles.todoLeft}>
              <View style={[styles.checkbox, item.completed && styles.checkboxCompleted]}>
                {item.completed ? (
                  <Ionicons name="checkmark" size={18} color="#fff" />
                ) : item.id === "stripe" && stripeLoading ? (
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                ) : (
                  <View style={styles.checkboxEmpty} />
                )}
              </View>
              <View style={styles.todoText}>
                <Text style={[styles.todoLabel, item.completed && styles.todoLabelCompleted]}>
                  {item.label}
                </Text>
                <Text style={styles.todoDesc}>{item.description}</Text>
              </View>
            </View>
            {(item.href || item.onPress) && (
              <Ionicons name="chevron-forward" size={20} color={theme.colors.primary} />
            )}
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff" },
  title: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 8,
    color: theme.colors.heading,
    fontFamily: theme.fonts.heading,
  },
  subtitle: {
    fontSize: 15,
    color: "#666",
    marginBottom: 24,
    lineHeight: 22,
  },
  todoList: {
    gap: 12,
  },
  todoItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: theme.colors.cream,
    borderRadius: 12,
    padding: 16,
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },
  todoItemCompleted: {
    backgroundColor: "#f0f7f0",
    borderColor: "#4caf50",
  },
  todoItemPressed: {
    opacity: 0.9,
  },
  todoLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  checkboxCompleted: {
    backgroundColor: "#4caf50",
    borderColor: "#4caf50",
  },
  checkboxEmpty: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "transparent",
  },
  todoText: {
    flex: 1,
  },
  todoLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.heading,
  },
  todoLabelCompleted: {
    color: "#2e7d32",
    textDecorationLine: "line-through",
  },
  todoDesc: {
    fontSize: 13,
    color: "#666",
    marginTop: 2,
  },
});
