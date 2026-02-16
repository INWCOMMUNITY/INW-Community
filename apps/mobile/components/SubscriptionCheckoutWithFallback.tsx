import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Linking,
} from "react-native";
import Constants from "expo-constants";
import * as WebBrowser from "expo-web-browser";
import { useFocusEffect } from "expo-router";
import { theme } from "@/lib/theme";
import { apiPost } from "@/lib/api";
import { SubscriptionCheckoutSheet } from "./SubscriptionCheckoutSheet";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
const siteBase = API_BASE.replace(/\/$/, "");

interface SubscriptionCheckoutWithFallbackProps {
  planId: "sponsor" | "seller";
  businessData?: Record<string, unknown>;
  onSuccess: () => void;
  onError?: (message: string) => void;
  refreshMember?: () => Promise<void>;
}

function WebCheckoutFallback(props: SubscriptionCheckoutWithFallbackProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useFocusEffect(
    useCallback(() => {
      props.refreshMember?.().catch(() => {});
    }, [props.refreshMember])
  );

  const handleCheckout = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const data = await apiPost<{ url?: string }>("/api/stripe/checkout", {
        planId: props.planId,
        interval: "monthly",
        businessData: props.businessData ?? undefined,
        returnBaseUrl: siteBase,
      });
      if (!data?.url) {
        setError("Could not start checkout. Try again.");
        return;
      }
      await WebBrowser.openBrowserAsync(data.url, {
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
      });
      await props.refreshMember?.();
    } catch (e) {
      const err = e as { error?: string };
      setError(err.error ?? "Checkout failed. Please try again.");
      props.onError?.(err.error ?? "Checkout failed");
    } finally {
      setLoading(false);
    }
  }, [props.planId, props.businessData, props.refreshMember, props.onError]);

  return (
    <View style={styles.fallback}>
      <Text style={styles.fallbackText}>
        Native payment isn&apos;t available. Complete checkout in your browser.
      </Text>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <Pressable
        style={({ pressed }) => [
          styles.fallbackBtn,
          (loading || pressed) && styles.pressed,
        ]}
        onPress={handleCheckout}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.fallbackBtnText}>Pay in browser</Text>
        )}
      </Pressable>
    </View>
  );
}

class CheckoutErrorBoundary extends React.Component<
  {
    children: React.ReactNode;
    fallback: React.ReactNode;
  },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    if (__DEV__) console.warn("[CheckoutErrorBoundary]", error?.message ?? error);
  }

  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

/**
 * In-app Stripe Payment Sheet when native module loads. Falls back to web checkout in Expo Go.
 */
export function SubscriptionCheckoutWithFallback(props: SubscriptionCheckoutWithFallbackProps) {
  const stripeKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
  const hasValidKey = !!stripeKey && !stripeKey.includes("placeholder");

  const [StripeProvider, setStripeProvider] = useState<
    React.ComponentType<{ publishableKey: string; urlScheme: string; children: React.ReactNode }> | null
  >(null);
  const [loadError, setLoadError] = useState(false);

  const webFallback = <WebCheckoutFallback {...props} />;

  const isExpoGo = Constants.appOwnership === "expo";

  useEffect(() => {
    if (!hasValidKey) {
      setLoadError(true);
      return;
    }
    if (isExpoGo) {
      setLoadError(true);
      return;
    }
    import("@stripe/stripe-react-native")
      .then((mod) => {
        const Provider = mod?.StripeProvider;
        if (Provider && typeof Provider === "function") {
          setStripeProvider(() => Provider);
        } else {
          setLoadError(true);
        }
      })
      .catch(() => setLoadError(true));
  }, [hasValidKey, isExpoGo]);

  if (!hasValidKey) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackText}>Stripe is not configured.</Text>
        <Pressable
          style={({ pressed }) => [styles.fallbackBtn, pressed && styles.pressed]}
          onPress={() =>
            Linking.openURL(
              `${siteBase}/support-nwc`
            ).catch(() => {})
          }
        >
          <Text style={styles.fallbackBtnText}>Open signup on website</Text>
        </Pressable>
      </View>
    );
  }

  if (loadError) {
    return webFallback;
  }

  if (!StripeProvider) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="small" color={theme.colors.primary} />
        <Text style={styles.loadingText}>Loading checkout…</Text>
      </View>
    );
  }

  return (
    <CheckoutErrorBoundary fallback={webFallback}>
      <StripeProvider publishableKey={stripeKey} urlScheme="mobile">
        <SubscriptionCheckoutSheet
          planId={props.planId}
          businessData={props.businessData}
          onSuccess={props.onSuccess}
          onError={props.onError}
          refreshMember={props.refreshMember}
        />
      </StripeProvider>
    </CheckoutErrorBoundary>
  );
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
  errorText: {
    fontSize: 14,
    color: "#c00",
    marginBottom: 12,
  },
  fallbackBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: "center",
  },
  fallbackBtnText: {
    color: theme.colors.buttonText ?? "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  pressed: { opacity: 0.8 },
  loading: {
    marginTop: 16,
    alignItems: "center",
    gap: 8,
  },
  loadingText: {
    fontSize: 14,
    color: theme.colors.text,
  },
});
