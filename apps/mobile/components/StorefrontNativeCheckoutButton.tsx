import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text } from "react-native";
import { theme } from "@/lib/theme";
import { apiPost } from "@/lib/api";

export interface StorefrontCheckoutPayload {
  items: { storeItemId: string; quantity: number; variant?: unknown; fulfillmentType?: string }[];
  shippingCostCents: number;
  shippingAddress?: { street: string; aptOrSuite?: string; city: string; state: string; zip: string };
  /** When true, address was selected from Places (still verified with Shippo at checkout). */
  shippingAddressVerifiedFromPlaces?: boolean;
  localDeliveryDetails?: unknown;
  cashOrderIds?: string[];
  returnBaseUrl?: string;
}

interface StorefrontNativeCheckoutButtonProps {
  /** Static payload (e.g. all card lines). Ignored when `getPayload` is set. */
  payload?: StorefrontCheckoutPayload;
  /** Build payload at tap time — use for mixed cash-then-card checkout. */
  getPayload?: () => Promise<StorefrontCheckoutPayload>;
  /** Stripe-hosted Checkout URL (platform collects tax; sellers paid via Connect after payment). */
  onHostedCheckoutUrl: (url: string) => void;
  onError: (message: string) => void;
  setCheckingOut: (v: boolean) => void;
  disabled: boolean;
  buttonStyle?: object;
  buttonDisabledStyle?: object;
  /** When address is validated and corrected to Shippo format, call with formatted address so parent can update form. */
  onShippingAddressFormatted?: (address: { street: string; city: string; state: string; zip: string; aptOrSuite?: string }) => void;
}

export function StorefrontNativeCheckoutButton({
  payload,
  getPayload,
  onHostedCheckoutUrl,
  onError,
  setCheckingOut,
  disabled,
  buttonStyle,
  buttonDisabledStyle,
  onShippingAddressFormatted,
}: StorefrontNativeCheckoutButtonProps) {
  const [loading, setLoading] = useState(false);
  const completedRef = useRef(false);

  const CHECKOUT_TIMEOUT_MS = 60000;

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
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    try {
      let checkoutPayload: StorefrontCheckoutPayload;
      try {
        if (getPayload) {
          checkoutPayload = await getPayload();
        } else if (payload) {
          checkoutPayload = payload;
        } else {
          onError("Checkout is not configured.");
          setLoading(false);
          setCheckingOut(false);
          return;
        }
      } catch (prepErr: unknown) {
        const err = prepErr as { error?: string; status?: number };
        onError(err.error ?? "Checkout could not be started.");
        setLoading(false);
        setCheckingOut(false);
        return;
      }

      timeoutId = setTimeout(() => {
        if (completedRef.current) return;
        completedRef.current = true;
        onError("Checkout timed out. Please try again.");
        setLoading(false);
        setCheckingOut(false);
      }, CHECKOUT_TIMEOUT_MS);

      const hasShipping = !!(
        checkoutPayload.shippingAddress?.street &&
        checkoutPayload.shippingAddress?.city &&
        checkoutPayload.shippingAddress?.state &&
        checkoutPayload.shippingAddress?.zip
      );
      if (hasShipping) {
        type ValidateRes = {
          valid?: boolean;
          formatted?: { street: string; city: string; state: string; zip: string };
          suggestedFormatted?: { street: string; city: string; state: string; zip: string };
          error?: string;
        };
        try {
          let validateData = await apiPost<ValidateRes>("/api/validate-address", {
            street: checkoutPayload.shippingAddress!.street,
            city: checkoutPayload.shippingAddress!.city,
            state: checkoutPayload.shippingAddress!.state,
            zip: checkoutPayload.shippingAddress!.zip,
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
            ...checkoutPayload,
            shippingAddress: {
              ...validateData.formatted!,
              aptOrSuite: checkoutPayload.shippingAddress!.aptOrSuite?.trim() || undefined,
            },
          };
          onShippingAddressFormatted?.(checkoutPayload.shippingAddress!);
        } catch (validateErr: unknown) {
          const err = validateErr as { error?: string; status?: number };
          if (err.status === 503 && (err.error ?? "").toLowerCase().includes("temporarily unavailable")) {
            checkoutPayload = { ...checkoutPayload };
          } else {
            onError(err.error ?? "Address verification failed. Please try again.");
            setLoading(false);
            setCheckingOut(false);
            if (timeoutId != null) clearTimeout(timeoutId);
            return;
          }
        }
      }

      const data = await apiPost<{ url?: string; error?: string }>("/api/stripe/storefront-checkout", checkoutPayload);

      if (data.error) {
        onError(data.error);
        return;
      }
      if (data.url) {
        if (timeoutId != null) clearTimeout(timeoutId);
        completedRef.current = true;
        setLoading(false);
        setCheckingOut(false);
        onHostedCheckoutUrl(data.url);
        return;
      }
      onError("Checkout could not be started.");
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
      setLoading(false);
      setCheckingOut(false);
    }
  }, [
    payload,
    getPayload,
    disabled,
    loading,
    onHostedCheckoutUrl,
    onError,
    setCheckingOut,
    onShippingAddressFormatted,
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
