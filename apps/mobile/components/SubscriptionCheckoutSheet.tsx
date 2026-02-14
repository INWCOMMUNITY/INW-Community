import { useCallback, useState } from "react";
import { Alert, Pressable, Text, ActivityIndicator, StyleSheet } from "react-native";
import { usePaymentSheet } from "@stripe/stripe-react-native";
import { theme } from "@/lib/theme";
import { apiPost } from "@/lib/api";

interface SubscriptionCheckoutSheetProps {
  planId: "sponsor" | "seller";
  businessData?: Record<string, unknown>;
  onSuccess: () => void;
  onError?: (message: string) => void;
  /** Called after payment - use to refresh member and navigate. Webhook may take a moment. */
  refreshMember?: () => Promise<void>;
}

export function SubscriptionCheckoutSheet({
  planId,
  businessData,
  onSuccess,
  onError,
  refreshMember,
}: SubscriptionCheckoutSheetProps) {
  const { initPaymentSheet, presentPaymentSheet } = usePaymentSheet();
  const [loading, setLoading] = useState(false);

  const handleCheckout = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiPost<{
        clientSecret?: string;
        ephemeralKey?: string;
        customerId?: string;
        subscriptionId?: string;
        completed?: boolean;
        error?: string;
      }>("/api/stripe/mobile-subscription-setup", {
        planId,
        businessData: businessData ?? undefined,
      });

      if (data.completed) {
        if (refreshMember) {
          await refreshMember();
        }
        onSuccess();
        return;
      }

      if (data.error) {
        onError?.(data.error);
        Alert.alert("Setup failed", data.error);
        return;
      }

      if (!data.clientSecret || !data.ephemeralKey || !data.customerId) {
        const msg = "Invalid setup response";
        onError?.(msg);
        Alert.alert("Error", msg);
        return;
      }

      const { error: initError } = await initPaymentSheet({
        merchantDisplayName: "Northwest Community",
        paymentIntentClientSecret: data.clientSecret,
        customerId: data.customerId,
        customerEphemeralKeySecret: data.ephemeralKey,
        allowsDelayedPaymentMethods: true,
        returnURL: "mobile://stripe-redirect",
        applePay: { merchantCountryCode: "US" },
        googlePay: {
          merchantCountryCode: "US",
          testEnv: __DEV__ ?? false,
        },
      });

      if (initError) {
        onError?.(initError.message);
        Alert.alert("Payment setup failed", initError.message);
        return;
      }

      const { error: presentError } = await presentPaymentSheet();

      if (presentError) {
        if (presentError.code !== "Canceled") {
          onError?.(presentError.message);
          Alert.alert("Payment failed", presentError.message);
        }
        return;
      }

      if (refreshMember) {
        await refreshMember();
        await new Promise((r) => setTimeout(r, 2000));
        await refreshMember();
      }
      onSuccess();
    } catch (e) {
      const err = e as { error?: string };
      const msg = err.error ?? "Checkout failed. Please try again.";
      onError?.(msg);
      Alert.alert("Error", msg);
    } finally {
      setLoading(false);
    }
  }, [
    planId,
    businessData,
    initPaymentSheet,
    presentPaymentSheet,
    onSuccess,
    onError,
  ]);

  return (
    <Pressable
      style={({ pressed }) => [
        styles.button,
        (loading || pressed) && styles.buttonDisabled,
      ]}
      onPress={handleCheckout}
      disabled={loading}
    >
      {loading ? (
        <ActivityIndicator size="small" color="#fff" />
      ) : (
        <Text style={styles.buttonText}>
          {planId === "sponsor"
            ? "Subscribe as Business"
            : "Subscribe as Seller"}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 16,
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: {
    color: theme.colors.buttonText ?? "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
