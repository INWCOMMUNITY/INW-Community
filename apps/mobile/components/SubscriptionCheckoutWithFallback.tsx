import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Linking,
} from "react-native";
import { theme } from "@/lib/theme";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

interface SubscriptionCheckoutWithFallbackProps {
  planId: "sponsor" | "seller";
  businessData?: Record<string, unknown>;
  onSuccess: () => void;
  onError?: (message: string) => void;
  refreshMember?: () => Promise<void>;
}

function StripeErrorFallback({
  onOpenWeb,
}: {
  onOpenWeb: () => void;
}) {
  return (
    <View style={styles.fallback}>
      <Text style={styles.fallbackText}>
        Native payment requires a development build. Complete your signup on our website.
      </Text>
      <Pressable
        style={({ pressed }) => [styles.fallbackBtn, pressed && styles.pressed]}
        onPress={onOpenWeb}
      >
        <Text style={styles.fallbackBtnText}>Open signup on website</Text>
      </Pressable>
    </View>
  );
}

export function SubscriptionCheckoutWithFallback(props: SubscriptionCheckoutWithFallbackProps) {
  const stripeKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
  const hasValidKey = !!stripeKey && !stripeKey.includes("placeholder");

  const [StripeModule, setStripeModule] = useState<React.ComponentType<typeof props> | null>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);

  const openWebSignup = useCallback(() => {
    const plan = props.planId === "sponsor" ? "sponsor" : "seller";
    Linking.openURL(`${siteBase}/signup?plan=${plan}`).catch(() => {});
  }, [props.planId]);

  useEffect(() => {
    if (!hasValidKey) {
      setLoadError(new Error("Stripe not configured"));
      return;
    }
    Promise.all([
      import("@stripe/stripe-react-native"),
      import("./SubscriptionCheckoutSheet"),
    ])
      .then(([stripe, { SubscriptionCheckoutSheet }]) => {
        const Wrapped = () => (
          <stripe.StripeProvider publishableKey={stripeKey}>
            <SubscriptionCheckoutSheet {...props} />
          </stripe.StripeProvider>
        );
        setStripeModule(() => Wrapped);
      })
      .catch((e) => {
        setLoadError(e instanceof Error ? e : new Error(String(e)));
      });
  }, [hasValidKey, stripeKey]);

  if (!hasValidKey || loadError) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackText}>
          Native checkout requires Stripe to be configured. Complete your signup on our website.
        </Text>
        <Pressable
          style={({ pressed }) => [styles.fallbackBtn, pressed && styles.pressed]}
          onPress={openWebSignup}
        >
          <Text style={styles.fallbackBtnText}>Open signup on website</Text>
        </Pressable>
      </View>
    );
  }

  if (!StripeModule) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="small" color={theme.colors.primary} />
        <Text style={styles.loadingText}>Loading checkout…</Text>
      </View>
    );
  }

  const Component = StripeModule;
  return (
    <CheckoutErrorBoundary
      fallback={<StripeErrorFallback onOpenWeb={openWebSignup} />}
    >
      <Component {...props} />
    </CheckoutErrorBoundary>
  );
}

class CheckoutErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  fallback: {
    marginTop: 16,
    padding: 16,
    borderRadius: 8,
    backgroundColor: theme.colors.cream,
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },
  fallbackText: {
    fontSize: 15,
    color: theme.colors.text,
    marginBottom: 12,
  },
  fallbackBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: "center",
  },
  fallbackBtnPressed: { opacity: 0.8 },
  fallbackBtnText: {
    color: theme.colors.buttonText ?? "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  loading: {
    marginTop: 16,
    alignItems: "center",
    gap: 8,
  },
  loadingText: {
    fontSize: 14,
    color: theme.colors.text,
  },
  pressed: { opacity: 0.8 },
});
