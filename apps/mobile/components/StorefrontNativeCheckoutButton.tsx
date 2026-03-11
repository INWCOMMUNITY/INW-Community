import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
} from "react-native";
import { usePaymentSheet } from "@stripe/stripe-react-native";
import { theme } from "@/lib/theme";
import { apiPost } from "@/lib/api";

export interface StorefrontCheckoutPayload {
  items: { storeItemId: string; quantity: number; variant?: unknown; fulfillmentType?: string }[];
  shippingCostCents: number;
  shippingAddress?: { street: string; aptOrSuite?: string; city: string; state: string; zip: string };
  localDeliveryDetails?: unknown;
  cashOrderIds?: string[];
}

interface StorefrontNativeCheckoutButtonProps {
  payload: StorefrontCheckoutPayload;
  onSuccess: () => void;
  onError: (message: string) => void;
  setCheckingOut: (v: boolean) => void;
  disabled: boolean;
  buttonStyle?: object;
  buttonDisabledStyle?: object;
}

export function StorefrontNativeCheckoutButton({
  payload,
  onSuccess,
  onError,
  setCheckingOut,
  disabled,
  buttonStyle,
  buttonDisabledStyle,
}: StorefrontNativeCheckoutButtonProps) {
  const { initPaymentSheet, presentPaymentSheet } = usePaymentSheet();
  const [loading, setLoading] = useState(false);
  const completedRef = useRef(false);

  const CHECKOUT_TIMEOUT_MS = 60000;

  const handlePress = useCallback(async () => {
    if (disabled || loading) return;
    setCheckingOut(true);
    setLoading(true);
    onError("");
    completedRef.current = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      if (completedRef.current) return;
      completedRef.current = true;
      onError("Checkout timed out. Please try again.");
      setLoading(false);
      setCheckingOut(false);
    }, CHECKOUT_TIMEOUT_MS);

    try {
      const data = await apiPost<{
        payments?: { clientSecret: string; orderIds: string[] }[];
        error?: string;
      }>("/api/stripe/storefront-checkout-intent", payload);

      if (data.error) {
        onError(data.error);
        return;
      }

      const payments = data.payments ?? [];
      if (payments.length === 0) {
        onError("Checkout could not be started. Try redirect checkout.");
        return;
      }

      // Each tap fetches fresh PaymentIntents from the API. Retry after "session expired" relies on
      // re-initing with this new clientSecret; @stripe/stripe-react-native does not expose a reset API.
      for (let i = 0; i < payments.length; i++) {
        const p = payments[i];
        const { error: initErr } = await initPaymentSheet({
          merchantDisplayName: "Northwest Community",
          paymentIntentClientSecret: p.clientSecret,
          returnURL: "mobile://stripe-redirect",
          applePay: { merchantCountryCode: "US" },
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

        if (initErr) {
          const msg = initErr.message ?? "";
          const isStaleIntent = /No such payment_intent|payment_intent.*does not exist/i.test(msg);
          if (__DEV__) {
            console.warn("[StorefrontCheckout] initPaymentSheet failed", {
              step: "init",
              code: (initErr as { code?: string }).code,
              message: msg,
              isStaleIntent,
            });
          }
          if (isStaleIntent) {
            const detail = msg ? ` (${msg})` : "";
            onError("Payment session expired. Please try checkout again." + detail);
            Alert.alert(
              "Session expired",
              "The previous payment session is no longer valid. Tap Checkout again to start a new one." + detail,
              [{ text: "OK" }]
            );
          } else {
            onError(msg);
          }
          return;
        }

        const { error: presentErr } = await presentPaymentSheet();

        if (presentErr) {
          if (presentErr.code !== "Canceled") {
            const msg = presentErr.message ?? "Payment failed";
            const isStaleIntent = /No such payment_intent|payment_intent.*does not exist/i.test(msg);
            if (__DEV__) {
              console.warn("[StorefrontCheckout] presentPaymentSheet failed", {
                step: "present",
                code: presentErr.code,
                message: msg,
                isStaleIntent,
              });
            }
            if (isStaleIntent) {
              const detail = msg ? ` (${msg})` : "";
              onError("Payment session expired. Please try checkout again." + detail);
              Alert.alert(
                "Session expired",
                "The payment session expired. Tap Checkout again to start a new one." + detail,
                [{ text: "OK" }]
              );
            } else {
              onError(msg);
              Alert.alert("Payment failed", msg);
            }
          }
          return;
        }
      }

      onSuccess();
    } catch (e) {
      const err = e as { error?: string; status?: number };
      if (err.status === 401) {
        const message = err.error ?? "Your session expired. Please sign in again to checkout.";
        onError(message);
        Alert.alert(
          "Sign in required",
          message + " After signing in, return to your cart and tap Checkout again.",
          [{ text: "OK" }]
        );
      } else {
        onError(err.error ?? "Checkout failed");
      }
    } finally {
      if (timeoutId != null) clearTimeout(timeoutId);
      completedRef.current = true;
      // All error paths above return from try; finally always runs so loading/checkout state
      // is reset and "Tap Checkout again" is tappable.
      setLoading(false);
      setCheckingOut(false);
    }
  }, [
    payload,
    disabled,
    loading,
    initPaymentSheet,
    presentPaymentSheet,
    onSuccess,
    onError,
    setCheckingOut,
  ]);

  const isDisabled = disabled || loading;

  return (
    <Pressable
      style={[styles.button, buttonStyle, isDisabled && (buttonDisabledStyle ?? styles.buttonDisabled)]}
      onPress={handlePress}
      disabled={isDisabled}
    >
      {loading ? (
        <ActivityIndicator size="small" color="#fff" />
      ) : (
        <Text style={styles.buttonText}>Checkout</Text>
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
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: {
    color: theme.colors.buttonText ?? "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
