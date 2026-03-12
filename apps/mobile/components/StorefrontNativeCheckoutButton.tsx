import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
} from "react-native";
import { StripeProvider, usePaymentSheet } from "@stripe/stripe-react-native";
import { theme } from "@/lib/theme";
import { apiPost } from "@/lib/api";

/** Single Connect payment: init + present inside a StripeProvider with stripeAccountId so the SDK finds the PI. */
function ConnectSheetRunner({
  payment,
  onSuccess,
  onError,
}: {
  payment: { clientSecret: string; orderIds: string[]; stripeAccountId?: string };
  onSuccess: () => void;
  onError: (message: string) => void;
}) {
  const { initPaymentSheet, presentPaymentSheet } = usePaymentSheet();
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      const { error: initErr } = await initPaymentSheet({
        merchantDisplayName: "Northwest Community",
        paymentIntentClientSecret: payment.clientSecret,
        returnURL: "mobile://stripe-redirect",
        applePay: { merchantCountryCode: "US" },
        googlePay: { merchantCountryCode: "US", testEnv: __DEV__ ?? false },
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
        onError(initErr.message ?? "Payment session could not be loaded.");
        return;
      }
      const { error: presentErr } = await presentPaymentSheet();
      if (presentErr) {
        if (presentErr.code === "Canceled") {
          onError(""); // User cancelled; caller will reset state
        } else {
          onError(presentErr.message ?? "Payment failed");
        }
        return;
      }
      onSuccess();
    })();
  }, [payment.clientSecret, payment.orderIds, initPaymentSheet, presentPaymentSheet, onSuccess, onError]);
  return null;
}

export interface StorefrontCheckoutPayload {
  items: { storeItemId: string; quantity: number; variant?: unknown; fulfillmentType?: string }[];
  shippingCostCents: number;
  shippingAddress?: { street: string; aptOrSuite?: string; city: string; state: string; zip: string };
  /** When true, address was selected from Places (still verified with EasyPost at checkout). */
  shippingAddressVerifiedFromPlaces?: boolean;
  localDeliveryDetails?: unknown;
  cashOrderIds?: string[];
}

interface StorefrontNativeCheckoutButtonProps {
  payload: StorefrontCheckoutPayload;
  onSuccess: (orderIds?: string[]) => void;
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
  const [connectSheet, setConnectSheet] = useState<{ payments: { clientSecret: string; orderIds: string[]; stripeAccountId?: string }[]; index: number } | null>(null);
  const completedRef = useRef(false);
  const pendingConnectRef = useRef(false);
  const stripePk = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
  const stripeMerchantId = process.env.EXPO_PUBLIC_STRIPE_MERCHANT_IDENTIFIER ?? "merchant.com.northwestcommunity";

  const CHECKOUT_TIMEOUT_MS = 60000;

  const onConnectSheetSuccess = useCallback(() => {
    setConnectSheet((prev) => {
      if (!prev || prev.index + 1 >= prev.payments.length) {
        completedRef.current = true;
        pendingConnectRef.current = false;
        setLoading(false);
        setCheckingOut(false);
        const allOrderIds = prev ? prev.payments.flatMap((p) => p.orderIds ?? []) : [];
        onSuccess(allOrderIds);
        return null;
      }
      return { payments: prev.payments, index: prev.index + 1 };
    });
  }, [onSuccess, setCheckingOut]);

  const onConnectSheetError = useCallback(
    (message: string) => {
      setConnectSheet(null);
      completedRef.current = true;
      pendingConnectRef.current = false;
      setLoading(false);
      setCheckingOut(false);
      if (message) {
        onError(message);
        const isStale = /No such payment_intent|payment_intent.*does not exist/i.test(message);
        if (isStale) {
          Alert.alert("Session expired", "Tap Checkout again to start a new one." + (message ? ` (${message})` : ""), [{ text: "OK" }]);
        } else {
          Alert.alert("Payment failed", message);
        }
      }
    },
    [onError, setCheckingOut]
  );

  const handlePress = useCallback(async () => {
    if (disabled || loading) return;
    const pk = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
    if (!pk.trim() || pk.includes("placeholder")) {
      onError(
        "Payment is not configured for this build. Set EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY in EAS project environment variables (or in apps/mobile/.env for local dev), then create a new build."
      );
      return;
    }
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
      let checkoutPayload: StorefrontCheckoutPayload = payload;
      const hasShipping = !!(payload.shippingAddress?.street && payload.shippingAddress?.city && payload.shippingAddress?.state && payload.shippingAddress?.zip);
      if (hasShipping) {
        type ValidateRes = {
          valid?: boolean;
          formatted?: { street: string; city: string; state: string; zip: string };
          suggestedFormatted?: { street: string; city: string; state: string; zip: string };
          error?: string;
        };
        let validateData = await apiPost<ValidateRes>("/api/validate-address", {
          street: payload.shippingAddress!.street,
          city: payload.shippingAddress!.city,
          state: payload.shippingAddress!.state,
          zip: payload.shippingAddress!.zip,
          requireCarrierVerification: true,
        });
        if (!validateData.valid && validateData.suggestedFormatted) {
          validateData = await apiPost<ValidateRes>("/api/validate-address", {
            street: validateData.suggestedFormatted.street,
            city: validateData.suggestedFormatted.city,
            state: validateData.suggestedFormatted.state,
            zip: validateData.suggestedFormatted.zip,
            requireCarrierVerification: true,
          });
        }
        if (!validateData.valid) {
          onError(validateData.error ?? "This address cannot be used for shipping. Please check street, city, state, and ZIP.");
          setLoading(false);
          setCheckingOut(false);
          if (timeoutId != null) clearTimeout(timeoutId);
          return;
        }
        checkoutPayload = {
          ...payload,
          shippingAddress: {
            ...validateData.formatted!,
            aptOrSuite: payload.shippingAddress!.aptOrSuite?.trim() || undefined,
          },
        };
      }

      const data = await apiPost<{
        payments?: { clientSecret: string; orderIds: string[]; stripeAccountId?: string }[];
        error?: string;
      }>("/api/stripe/storefront-checkout-intent", checkoutPayload);

      if (data.error) {
        onError(data.error);
        return;
      }

      const payments = data.payments ?? [];
      if (payments.length === 0) {
        onError("Checkout could not be started. Try redirect checkout.");
        return;
      }

      // Connect PIs are on the seller's Stripe account. The SDK must use StripeProvider stripeAccountId
      // or Stripe returns "no such payment_intent". Use nested provider + ConnectSheetRunner.
      const firstPayment = payments[0];
      if (firstPayment?.stripeAccountId?.trim()) {
        clearTimeout(timeoutId);
        setConnectSheet({ payments, index: 0 });
        pendingConnectRef.current = true;
        return;
      }

      // Fallback when API doesn't return stripeAccountId (e.g. old backend).
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

      const allOrderIds = payments.flatMap((p) => p.orderIds ?? []);
      onSuccess(allOrderIds);
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
      if (!pendingConnectRef.current) {
        setLoading(false);
        setCheckingOut(false);
      }
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
  const showConnectSheet = connectSheet != null && connectSheet.payments[connectSheet.index]?.stripeAccountId?.trim();

  return (
    <>
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
      {showConnectSheet && (
        <StripeProvider
          publishableKey={stripePk}
          stripeAccountId={connectSheet.payments[connectSheet.index].stripeAccountId!}
          urlScheme="mobile"
          merchantIdentifier={stripeMerchantId}
        >
          <ConnectSheetRunner
            payment={connectSheet.payments[connectSheet.index]}
            onSuccess={onConnectSheetSuccess}
            onError={onConnectSheetError}
          />
        </StripeProvider>
      )}
    </>
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
