/**
 * Web / SSR: @stripe/stripe-react-native uses native codegen and cannot load in Metro web.
 * Metro resolves the package to this file when platform is web (see metro.config.js).
 */
const React = require("react");

function StripeProvider({ children }) {
  return children ?? null;
}

function usePaymentSheet() {
  return {
    initPaymentSheet: async () => ({
      error: { message: "In-app Stripe is not available on web; use the native app or checkout in browser." },
    }),
    presentPaymentSheet: async () => ({
      error: { code: "Failed", message: "Not available on web" },
    }),
  };
}

function usePlatformPay() {
  return {
    isPlatformPaySupported: async () => false,
    confirmPlatformPayPayment: async () => ({ error: new Error("Not available on web") }),
  };
}

const PlatformPay = {
  IntervalUnit: { Year: "year", Month: "month" },
  PaymentRequestType: { Recurring: "Recurring" },
  PaymentType: { Recurring: "Recurring" },
};

module.exports = {
  StripeProvider,
  usePaymentSheet,
  usePlatformPay,
  PlatformPay,
};
