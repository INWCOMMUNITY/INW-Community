import { useCallback, useState, useEffect } from "react";
import { Alert, Pressable, Text, ActivityIndicator, StyleSheet, Platform } from "react-native";
import { usePaymentSheet, PlatformPay } from "@stripe/stripe-react-native";
import { theme } from "@/lib/theme";
import { apiPost } from "@/lib/api";
import {
  syncStripeSubscriptionsFromClient,
  waitForMemberPlanAfterCheckout,
} from "@/lib/subscription-checkout-entitlements";
import { useEventInvitePopupSuppression } from "@/contexts/EventInvitePopupSuppressionContext";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/$/, "");

type ApplePayPresentation = {
  amountCents: number;
  currency: string;
  intervalUnit: "month" | "year";
  intervalCount: number;
  planLabel: string;
};

function iosMajorVersion(): number {
  if (Platform.OS !== "ios") return 0;
  const v = Platform.Version;
  if (typeof v === "number") return Math.floor(v);
  const head = String(v).split(".")[0];
  return parseInt(head, 10) || 0;
}

function buildApplePayConfig(presentation: ApplePayPresentation | undefined) {
  const base = { merchantCountryCode: "US" as const };
  if (Platform.OS !== "ios" || !presentation) {
    return base;
  }

  if (iosMajorVersion() < 16) {
    return base;
  }

  const amountStr =
    presentation.amountCents > 0 ? (presentation.amountCents / 100).toFixed(2) : "0.00";
  const managementUrl = `${siteBase.replace(/\/$/, "")}/my-community/subscriptions`;
  const intervalUnit =
    presentation.intervalUnit === "year"
      ? PlatformPay.IntervalUnit.Year
      : PlatformPay.IntervalUnit.Month;
  const intervalPhrase =
    presentation.intervalUnit === "year"
      ? presentation.intervalCount > 1
        ? `every ${presentation.intervalCount} years`
        : "every year"
      : presentation.intervalCount > 1
        ? `every ${presentation.intervalCount} months`
        : "every month";

  return {
    ...base,
    request: {
      type: PlatformPay.PaymentRequestType.Recurring,
      description: `${presentation.planLabel} (${intervalPhrase})`,
      managementUrl,
      billing: {
        paymentType: PlatformPay.PaymentType.Recurring,
        intervalUnit,
        intervalCount: Math.max(1, presentation.intervalCount),
        label: presentation.planLabel,
        amount: amountStr,
      },
    },
  };
}

interface SubscriptionCheckoutSheetProps {
  planId: "subscribe" | "sponsor" | "seller";
  businessData?: Record<string, unknown>;
  interval?: "monthly" | "yearly";
  onSuccess: () => void;
  onError?: (message: string) => void;
  refreshMember?: () => Promise<void>;
  /** Called immediately before presenting payment UI (native sheet or external browser). */
  onCheckoutUiOpening?: () => void;
}

export function SubscriptionCheckoutSheet({
  planId,
  businessData,
  interval,
  onSuccess,
  onError,
  refreshMember,
  onCheckoutUiOpening,
}: SubscriptionCheckoutSheetProps) {
  const { initPaymentSheet, presentPaymentSheet } = usePaymentSheet();
  const [loading, setLoading] = useState(false);
  const { incrementSuppression, decrementSuppression } = useEventInvitePopupSuppression();
  useEffect(() => {
    if (!loading) return;
    incrementSuppression();
    return () => decrementSuppression();
  }, [loading, incrementSuppression, decrementSuppression]);

  const finalizeAfterPayment = useCallback(async () => {
    await syncStripeSubscriptionsFromClient();
    await waitForMemberPlanAfterCheckout(planId);
    if (refreshMember) {
      await refreshMember().catch(() => {});
    }
    onSuccess();
  }, [planId, refreshMember, onSuccess]);

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
        applePayPresentation?: ApplePayPresentation;
      }>("/api/stripe/mobile-subscription-setup", {
        planId,
        interval: interval ?? "monthly",
        businessData: businessData ?? undefined,
      });

      if (data.completed) {
        await syncStripeSubscriptionsFromClient();
        await waitForMemberPlanAfterCheckout(planId);
        if (refreshMember) {
          await refreshMember().catch(() => {});
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

      const applePay = buildApplePayConfig(data.applePayPresentation);

      const { error: initError } = await initPaymentSheet({
        merchantDisplayName: "Northwest Community",
        paymentIntentClientSecret: data.clientSecret,
        customerId: data.customerId,
        customerEphemeralKeySecret: data.ephemeralKey,
        allowsDelayedPaymentMethods: true,
        returnURL: "mobile://stripe-redirect",
        // Stripe RN types expect a narrowed RecurringPaymentRequest literal; runtime shape matches ApplePayParams.
        applePay: applePay as import("@stripe/stripe-react-native/lib/typescript/src/types/PaymentSheet").ApplePayParams,
        googlePay: {
          merchantCountryCode: "US",
          testEnv: __DEV__ ?? false,
        },
        appearance: {
          colors: {
            primary: "#505542",
            background: "#FDEDCC",
            componentBackground: "#FFFFFF",
            componentText: "#3E432F",
            primaryText: "#3E432F",
            secondaryText: "#505542",
            icon: "#505542",
          },
        },
      });

      if (initError) {
        onError?.(initError.message);
        Alert.alert("Payment setup failed", initError.message);
        return;
      }

      onCheckoutUiOpening?.();

      const { error: presentError } = await presentPaymentSheet();

      if (presentError) {
        if (presentError.code !== "Canceled") {
          onError?.(presentError.message);
          Alert.alert("Payment failed", presentError.message);
        }
        return;
      }

      await finalizeAfterPayment();
    } catch (e) {
      const err = e as { error?: string; status?: number };
      let msg = err.error ?? "Checkout failed. Please try again.";
      if (err.status === 401) msg = "Please sign in again.";
      if (err.status === 503) msg = "Stripe is not configured on the server.";
      if (__DEV__) console.warn("[SubscriptionCheckout]", err.status, err.error);
      onError?.(msg);
      Alert.alert("Error", msg);
    } finally {
      setLoading(false);
    }
  }, [
    planId,
    businessData,
    interval,
    initPaymentSheet,
    presentPaymentSheet,
    onSuccess,
    onError,
    refreshMember,
    onCheckoutUiOpening,
    finalizeAfterPayment,
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
          {planId === "subscribe"
            ? "Subscribe"
            : planId === "sponsor"
              ? "Subscribe to Business plan"
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
