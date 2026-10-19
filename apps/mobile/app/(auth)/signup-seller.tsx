import { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Switch,
  Image,
  Alert,
} from "react-native";
import { useRouter, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, usePreventRemove } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import {
  signupAgeSwitchOutline,
  switchIosBackgroundColor,
  switchThumbColor,
  switchTrackColor,
  theme,
} from "@/lib/theme";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { clearPendingReferralCode, getPendingReferralCode } from "@/lib/referral-code";
import { signIn } from "@/lib/auth";
import { useAuth } from "@/contexts/AuthContext";
import { BusinessForm } from "@/components/BusinessForm";
import { SubscriptionCheckoutWithFallback } from "@/components/SubscriptionCheckoutWithFallback";
import { OnboardingProgress } from "@/components/seller-onboarding/OnboardingProgress";
import { OnboardingSection } from "@/components/seller-onboarding/OnboardingSection";
import { ShippingSetupPanel } from "@/app/seller-hub/shipping-setup";
import { PolicyPreviewField, SellerPolicyQuestions } from "@/components/seller/SellerPolicyQuestions";
import {
  freeShippingPolicyLead,
  handlingTimeBoldLine,
  policyFromStored,
  showsFreeReturns,
  type SellerReturnLabelPolicy,
} from "@/lib/seller-return-label-policy";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

type Step = "account" | "business" | "contact" | "subscribe" | "shipping" | "policies" | "payouts" | "import";

const STEP_ORDER: Step[] = ["account", "business", "contact", "subscribe", "shipping", "policies", "payouts", "import"];

const STEP_INDEX: Record<Step, number> = {
  account: 1,
  business: 2,
  contact: 3,
  subscribe: 4,
  shipping: 5,
  policies: 6,
  payouts: 7,
  import: 8,
};

type SellerStatus = {
  step?: string;
  hasSubscription?: boolean;
  stripeConnectStarted?: boolean;
  etsyConnected?: boolean;
  etsyShopName?: string | null;
  shopifyConnected?: boolean;
  shopifyShopDomain?: string | null;
  firstName?: string;
  lastName?: string;
  phone?: string;
};

function normalizeStart(start?: string): Step | null {
  if (start === "checkout") return "subscribe";
  if (start && (STEP_ORDER as string[]).includes(start)) return start as Step;
  return null;
}

function toWizardStep(step?: string): Step {
  const normalized = normalizeStart(step);
  return normalized ?? "business";
}

const ONBOARDING_STEP_KEY = "nwc-seller-onboarding-step";

function laterStep(serverStep: Step, remembered?: string | null): Step {
  const saved = normalizeStart(remembered ?? undefined);
  if (saved && STEP_INDEX[saved] > STEP_INDEX[serverStep]) return saved;
  return serverStep;
}

export default function SignupSellerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ start?: string; billing?: string }>();
  const { refreshMember, member, signOut } = useAuth();
  const startParam = typeof params.start === "string" ? params.start : undefined;

  const [step, setStep] = useState<Step>(normalizeStart(startParam) ?? "account");
  const [billingInterval, setBillingInterval] = useState<"monthly" | "yearly">(
    params.billing === "yearly" ? "yearly" : "monthly"
  );
  const [placed, setPlaced] = useState(!member);
  const placedKey = useRef<string | null>(null);
  const [hasSubscription, setHasSubscription] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [policyName, setPolicyName] = useState("This seller");
  const [policyDraft, setPolicyDraft] = useState<SellerReturnLabelPolicy>(() => policyFromStored({}));
  const [policyShipping, setPolicyShipping] = useState("");
  const [policyReturns, setPolicyReturns] = useState("");
  const [businessData, setBusinessData] = useState<Record<string, unknown> | null>(null);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [allowRemoveWithoutPrompt, setAllowRemoveWithoutPrompt] = useState(false);
  const [shippingReady, setShippingReady] = useState(false);
  const [offerFreeShippingOnInw, setOfferFreeShippingOnInw] = useState(false);
  const [acceptReturnsDays, setAcceptReturnsDays] = useState("30");
  const [stripeReady, setStripeReady] = useState(false);
  const [payoutLoading, setPayoutLoading] = useState(false);
  const [etsyConnected, setEtsyConnected] = useState(false);
  const [etsyShopName, setEtsyShopName] = useState<string | null>(null);
  const [shopifyConnected, setShopifyConnected] = useState(false);
  const [shopifyShopDomain, setShopifyShopDomain] = useState<string | null>(null);
  const [shopifyShop, setShopifyShop] = useState("");

  useEffect(() => {
    if (step !== "policies") return;
    let cancelled = false;
    apiGet<{
      sellerPolicyName?: string;
      sellerShippingPolicy?: string | null;
      sellerReturnPolicy?: string | null;
      handlingTime?: string | null;
      returnLabelPayer?: string | null;
      returnLabelPayerByReason?: unknown;
      chargeReturnShipping?: boolean;
      offerFreeShippingOnInw?: boolean;
      acceptReturns?: boolean;
      acceptReturnsDays?: number;
    }>("/api/me")
      .then((data) => {
        if (cancelled) return;
        setPolicyName(data.sellerPolicyName?.trim() || "This seller");
        setPolicyDraft(policyFromStored(data));
        setPolicyShipping(data.sellerShippingPolicy ?? "");
        setPolicyReturns(data.sellerReturnPolicy ?? "");
        setOfferFreeShippingOnInw(data.offerFreeShippingOnInw === true);
        setAcceptReturnsDays(String(data.acceptReturnsDays ?? 30));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [step]);

  useFocusEffect(
    useCallback(() => {
      if (!member) {
        setPlaced(true);
        return;
      }
      let cancelled = false;
      const requested = normalizeStart(startParam);
      const query = requested ? `?requested=${encodeURIComponent(requested)}` : "";
      apiGet<SellerStatus>(`/api/signup/seller/status${query}`)
        .then(async (status) => {
          if (cancelled) return;
          setHasSubscription(Boolean(status.hasSubscription));
          setStripeReady(Boolean(status.stripeConnectStarted));
          setEtsyConnected(Boolean(status.etsyConnected));
          setEtsyShopName(status.etsyShopName ?? null);
          setShopifyConnected(Boolean(status.shopifyConnected));
          setShopifyShopDomain(status.shopifyShopDomain ?? null);
          const key = requested ?? "auto";
          if (placedKey.current !== key) {
            placedKey.current = key;
            if (status.firstName) setFirstName(status.firstName);
            if (status.lastName) setLastName(status.lastName);
            if (status.phone) setPhone(status.phone);
            const remembered = await AsyncStorage.getItem(ONBOARDING_STEP_KEY);
            if (!cancelled) setStep(laterStep(toWizardStep(status.step), remembered));
          }
          setPlaced(true);
        })
        .catch(() => {
          if (!cancelled) setPlaced(true);
        });
      return () => {
        cancelled = true;
      };
    }, [member, startParam])
  );

  const previousStep = (): Step | null => {
    const idx = STEP_ORDER.indexOf(step);
    if (idx <= 0) return null;
    const prev = STEP_ORDER[idx - 1];
    if (hasSubscription && (prev === "account" || prev === "business" || prev === "contact" || prev === "subscribe")) {
      return null;
    }
    return prev;
  };

  const onPreventRemove = useCallback(
    ({ data }: { data: { action: object } }) => {
      const prev = (() => {
        const idx = STEP_ORDER.indexOf(step);
        if (idx <= 0) return null;
        const candidate = STEP_ORDER[idx - 1];
        if (
          hasSubscription &&
          (candidate === "account" || candidate === "business" || candidate === "contact" || candidate === "subscribe")
        ) {
          return null;
        }
        return candidate;
      })();
      if (prev) {
        const msg =
          step === "business"
            ? "Going back will discard the business details you entered on this step."
            : step === "contact"
              ? "Going back will discard the name and phone you entered on this step."
              : "Going back leaves this step. You can return to it.";
        Alert.alert("Leave this step?", msg, [
          { text: "Stay", style: "cancel" },
          { text: "Leave step", style: "destructive", onPress: () => setStep(prev) },
        ]);
        return;
      }
      if (step === "account") {
        Alert.alert("Leave Sign Up?", "Are you sure you want to leave Seller sign up? Progress will not be saved.", [
          { text: "Stay", style: "cancel" },
          {
            text: "Leave",
            style: "destructive",
            onPress: async () => {
              await signOut();
              setAllowRemoveWithoutPrompt(true);
              setTimeout(() => navigation.dispatch(data.action as never), 0);
            },
          },
        ]);
        return;
      }
      setAllowRemoveWithoutPrompt(true);
      setTimeout(() => navigation.dispatch(data.action as never), 0);
    },
    [step, hasSubscription, navigation, signOut]
  );

  usePreventRemove(!allowRemoveWithoutPrompt, onPreventRemove);

  const openPolicy = (path: "terms" | "privacy", title: string) => {
    router.push(
      `/web?url=${encodeURIComponent(`${siteBase}/${path}`)}&title=${encodeURIComponent(title)}` as never
    );
  };

  const handleAccountSubmit = async () => {
    setError("");
    if (!ageConfirmed) {
      setError("You must confirm you are 16 years or older to sign up.");
      return;
    }
    if (!email.trim() || !password) {
      setError("Email and password are required.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setLoading(true);
    try {
      const ref = await getPendingReferralCode();
      const signupRes = await apiPost<{ requiresEmailVerification?: boolean }>("/api/auth/signup", {
        email: email.trim().toLowerCase(),
        password,
        signupIntent: "seller",
        ...(ref ? { ref } : {}),
      });
      await clearPendingReferralCode();
      if (signupRes?.requiresEmailVerification === true) {
        (router.replace as (href: string) => void)(
          `/verify-email-pending?email=${encodeURIComponent(email.trim())}&plan=seller`
        );
        return;
      }
      const signed = await signIn(email.trim(), password, "seller");
      if ("requiresEmailVerification" in signed && signed.requiresEmailVerification) {
        (router.replace as (href: string) => void)(
          `/verify-email-pending?email=${encodeURIComponent(signed.email)}&plan=seller`
        );
        return;
      }
      await refreshMember();
      setStep("business");
    } catch (e) {
      const err = e as { error?: string };
      if (err.error?.toLowerCase().includes("already registered")) {
        try {
          const signed = await signIn(email.trim(), password, "seller");
          if ("requiresEmailVerification" in signed && signed.requiresEmailVerification) {
            (router.replace as (href: string) => void)(
              `/verify-email-pending?email=${encodeURIComponent(signed.email)}&plan=seller`
            );
            return;
          }
          await refreshMember();
          setStep("business");
          return;
        } catch {
          setError("Email already registered. Sign in from the login screen.");
        }
      } else {
        setError(err.error ?? "Sign up failed. Try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleContactSubmit = async () => {
    setError("");
    if (!firstName.trim() || !lastName.trim() || !phone.trim()) {
      setError("First name, last name, and phone are required.");
      return;
    }
    setLoading(true);
    try {
      const payload: Record<string, unknown> = { phone: phone.trim() || null };
      if (firstName.trim()) payload.firstName = firstName.trim();
      if (lastName.trim()) payload.lastName = lastName.trim();
      await apiPatch("/api/me", payload);
      setStep("subscribe");
    } catch (e) {
      const err = e as { error?: string };
      setError(err.error ?? "Failed to save info.");
    } finally {
      setLoading(false);
    }
  };

  const handleCheckoutSuccess = () => {
    refreshMember().catch(() => {});
    setHasSubscription(true);
    setStep("shipping");
  };

  const startPayouts = async () => {
    setError("");
    setPayoutLoading(true);
    try {
      const res = await apiPost<{ url?: string; reused?: boolean; error?: string }>(
        "/api/stripe/connect/onboard",
        { returnBaseUrl: siteBase, mobileReturnPath: "/signup-seller?start=payouts" }
      );
      if (res?.reused) {
        setStripeReady(true);
        return;
      }
      if (res?.url) {
        router.push(
          `/web?url=${encodeURIComponent(res.url)}&title=${encodeURIComponent("Payment Setup")}` as never
        );
        return;
      }
      setError(res?.error ?? "Payment setup failed");
    } catch (e) {
      const err = e as { error?: string };
      setError(err.error ?? "Failed to get setup link");
    } finally {
      setPayoutLoading(false);
    }
  };

  const connectEtsy = async () => {
    setError("");
    setLoading(true);
    try {
      const body = await apiPost<{ authorizeUrl?: string }>("/api/etsy/connect", {});
      if (!body.authorizeUrl) {
        setError("Could not start Etsy connection.");
        return;
      }
      await WebBrowser.openBrowserAsync(body.authorizeUrl);
      const status = await apiGet<SellerStatus>("/api/signup/seller/status?requested=import");
      setEtsyConnected(Boolean(status.etsyConnected));
      setEtsyShopName(status.etsyShopName ?? null);
    } catch (e) {
      const err = e as { error?: string };
      setError(err.error ?? "Could not start Etsy connection.");
    } finally {
      setLoading(false);
    }
  };

  const connectShopify = async () => {
    setError("");
    if (!shopifyShop.trim()) {
      setError("Enter your Shopify store address.");
      return;
    }
    setLoading(true);
    try {
      const body = await apiPost<{ authorizeUrl?: string }>("/api/shopify/connect", { shop: shopifyShop.trim() });
      if (!body.authorizeUrl) {
        setError("Could not start Shopify connection.");
        return;
      }
      await WebBrowser.openBrowserAsync(body.authorizeUrl);
      const status = await apiGet<SellerStatus>("/api/signup/seller/status?requested=import");
      setShopifyConnected(Boolean(status.shopifyConnected));
      setShopifyShopDomain(status.shopifyShopDomain ?? null);
    } catch (e) {
      const err = e as { error?: string };
      setError(err.error ?? "Could not start Shopify connection.");
    } finally {
      setLoading(false);
    }
  };

  const goToSellerHub = () => {
    setAllowRemoveWithoutPrompt(true);
    void AsyncStorage.setItem(ONBOARDING_STEP_KEY, "import");
    setTimeout(() => router.replace("/seller-hub" as never), 0);
  };

  function advance(next: Step) {
    void AsyncStorage.setItem(ONBOARDING_STEP_KEY, next);
    setStep(next);
  }

  if (member && !placed) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator color={theme.colors.earth} />
      </View>
    );
  }

  const progress = <OnboardingProgress stepIndex={STEP_INDEX[step]} />;
  const back = previousStep();
  const topSpace = insets.top + 12;

  return (
    <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      {step === "business" ? (
        <View style={{ flex: 1, paddingTop: topSpace }}>
        <BusinessForm
          categoryCatalog="seller"
          onSuccess={() => {}}
          onDraftSubmit={(data) => {
            setBusinessData(data);
            setError("");
            setStep("contact");
          }}
          draftButtonLabel="Continue"
          onBack={back ? () => setStep(back) : undefined}
          headerContent={
            <View>
              {progress}
              <Text style={styles.intro}>
                Add the details shoppers see on your storefront. Categories can be your own, not only the directory list.
              </Text>
              {error ? <Text style={styles.error}>{error}</Text> : null}
            </View>
          }
          footerContent={progress}
        />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingTop: topSpace }]}
          keyboardShouldPersistTaps="handled"
        >
          {progress}
          {step === "account" ? (
            <OnboardingSection
              title="Account"
              description="Create your account. Next you will add your storefront, shipping, and payouts in order."
            >
              <TextInput
                style={styles.input}
                placeholder="Email"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholderTextColor={theme.colors.placeholder}
              />
              <View style={styles.ageRow}>
                <View style={signupAgeSwitchOutline}>
                  <Switch
                    value={ageConfirmed}
                    onValueChange={setAgeConfirmed}
                    trackColor={switchTrackColor()}
                    thumbColor={switchThumbColor(ageConfirmed)}
                    ios_backgroundColor={switchIosBackgroundColor}
                  />
                </View>
                <Text style={styles.ageLabel}>
                  I confirm I am 16 years or older (users under 18 need parent/guardian permission).
                </Text>
              </View>
              <TextInput
                style={styles.input}
                placeholder="Password (min 8 characters)"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                placeholderTextColor={theme.colors.placeholder}
              />
              <Text style={styles.termsText}>
                By signing up, you agree to our{" "}
                <Text style={styles.termsLink} onPress={() => openPolicy("terms", "Terms of Service")}>
                  Terms of Service
                </Text>
                {" "}and{" "}
                <Text style={styles.termsLink} onPress={() => openPolicy("privacy", "Privacy Policy")}>
                  Privacy Policy
                </Text>
                .
              </Text>
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <StepActions
                onBack={() => {
                  if (router.canGoBack()) router.back();
                  else router.replace("/(tabs)" as never);
                }}
                onContinue={() => void handleAccountSubmit()}
                continueLabel="Continue"
                loading={loading}
              />
            </OnboardingSection>
          ) : null}

          {step === "contact" ? (
            <OnboardingSection
              title="Contact"
              description="Your name and phone, so we can reach you. Shipping details come in the next steps."
            >
              <TextInput
                style={styles.input}
                placeholder="First name"
                value={firstName}
                onChangeText={setFirstName}
                placeholderTextColor={theme.colors.placeholder}
                autoCapitalize="words"
              />
              <TextInput
                style={styles.input}
                placeholder="Last name"
                value={lastName}
                onChangeText={setLastName}
                placeholderTextColor={theme.colors.placeholder}
                autoCapitalize="words"
              />
              <TextInput
                style={styles.input}
                placeholder="Phone"
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                placeholderTextColor={theme.colors.placeholder}
              />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <StepActions
                onBack={back ? () => setStep(back) : undefined}
                onContinue={() => void handleContactSubmit()}
                continueLabel="Continue"
                loading={loading}
              />
            </OnboardingSection>
          ) : null}

          {step === "subscribe" ? (
            <OnboardingSection title="Subscription">
              <Image
                source={require("@/assets/images/nwc-community-logo.png")}
                style={styles.logo}
                resizeMode="contain"
                accessibilityLabel="Northwest Community"
              />
              <Text style={styles.subscribeTitle}>Subscribe as a Northwest Community Seller</Text>
              <View style={styles.billingRow}>
                <Pressable
                  style={[styles.billingChip, billingInterval === "monthly" && styles.billingChipOn]}
                  onPress={() => setBillingInterval("monthly")}
                >
                  <Text style={[styles.billingChipText, billingInterval === "monthly" && styles.billingChipTextOn]}>
                    Monthly
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.billingChip, billingInterval === "yearly" && styles.billingChipOn]}
                  onPress={() => setBillingInterval("yearly")}
                >
                  <Text style={[styles.billingChipText, billingInterval === "yearly" && styles.billingChipTextOn]}>
                    Yearly
                  </Text>
                </Pressable>
              </View>
              <Text style={styles.price}>
                {billingInterval === "yearly" ? "$200.00" : "$20.00"}{" "}
                <Text style={styles.priceUnit}>{billingInterval === "yearly" ? "per year" : "per month"}</Text>
              </Text>
              {billingInterval === "yearly" ? (
                <Text style={styles.copy}>About $16.67/mo billed annually</Text>
              ) : null}
              <Text style={styles.copy}>
                The seller subscription includes everything in the business plan, as well as access to our storefront, third-party syncing with Shopify and/or Etsy, shipping items, and getting paid directly through payouts. INW has a monthly subscription because we do not take a percentage of the items you sell.
              </Text>
              <Text style={styles.copy}>
                That means when you sell items with us, you only pay about <Text style={styles.bold}>4.4% + 30¢ per transaction</Text>. That covers credit card processing, tax processing, and a sales tax reserve. That <Text style={styles.bold}>averages 7% less than most third-party retailers</Text>.
              </Text>
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <View style={styles.subscribeActions}>
                <SubscriptionCheckoutWithFallback
                  planId="seller"
                  businessData={businessData ?? undefined}
                  interval={billingInterval}
                  onSuccess={handleCheckoutSuccess}
                  refreshMember={refreshMember}
                  onExternalCheckoutStart={() => setAllowRemoveWithoutPrompt(true)}
                />
                {back ? (
                  <Pressable style={styles.subscribeBack} onPress={() => setStep(back)}>
                    <Text style={styles.backBtnText}>Back</Text>
                  </Pressable>
                ) : null}
              </View>
            </OnboardingSection>
          ) : null}

          {step === "shipping" ? (
            <>
              <Text style={styles.intro}>
                Connect Shippo, then add a shipping option unless you offer free shipping on INW. New listings then ship free, so a package is not required.
              </Text>
              <OnboardingSection title="Shipping">
                <ShippingSetupPanel
                  embedded
                  onProgress={(progressState) => {
                    setOfferFreeShippingOnInw(Boolean(progressState.offerFreeShippingOnInw));
                    setShippingReady(
                      progressState.shippoConnected &&
                        (progressState.offerFreeShippingOnInw || progressState.optionCount >= 1)
                    );
                  }}
                />
                {error ? <Text style={styles.error}>{error}</Text> : null}
                <StepActions
                  onBack={back ? () => setStep(back) : undefined}
                  onContinue={() => advance("policies")}
                  continueLabel="Continue"
                  continueDisabled={!shippingReady}
                />
              </OnboardingSection>
            </>
          ) : null}

          {step === "policies" ? (
            <OnboardingSection
              title="Policies"
              description="The bold free shipping line, handling time, and FREE RETURNS show at the top of the policy. Type the rest underneath."
            >
              <SellerPolicyQuestions policy={policyDraft} onChange={setPolicyDraft} />
              <PolicyPreviewField
                label="Shipping Policy"
                leads={[freeShippingPolicyLead(offerFreeShippingOnInw)]}
                lead={handlingTimeBoldLine(policyName, policyDraft.handlingTime)}
                value={policyShipping}
                onChangeText={setPolicyShipping}
                placeholder="Anything else buyers should know about shipping."
              />
              <Text style={styles.fieldLabel}>Accept returns for</Text>
              <View style={styles.daysRow}>
                <TextInput
                  style={[styles.input, styles.daysInput]}
                  value={acceptReturnsDays}
                  onChangeText={(t) => setAcceptReturnsDays(t.replace(/[^0-9]/g, ""))}
                  keyboardType="number-pad"
                  placeholder="30"
                  placeholderTextColor={theme.colors.placeholder}
                />
                <Text style={styles.ageLabel}>days after delivery</Text>
              </View>
              <Text style={styles.hint}>Mention this return window in your refund policy below.</Text>
              {policyDraft.returnLabelPayer !== "seller" ? (
                <Text style={styles.hint}>
                  You did not select “I do.” Say in this policy who pays for the return label.
                </Text>
              ) : null}
              <PolicyPreviewField
                label="Refund Policy"
                leads={[showsFreeReturns(policyDraft) ? "FREE RETURNS" : null]}
                value={policyReturns}
                onChangeText={setPolicyReturns}
                placeholder={`e.g. Refunds and returns within ${acceptReturnsDays || "30"} days.`}
              />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <StepActions
                onBack={() => setStep("shipping")}
                onContinue={() => {
                  setError("");
                  setLoading(true);
                  void apiPatch("/api/me", {
                    handlingTime: policyDraft.handlingTime,
                    returnLabelPayer: policyDraft.returnLabelPayer,
                    returnLabelPayerByReason: policyDraft.returnLabelPayerByReason,
                    sellerShippingPolicy: policyShipping.trim() || null,
                    sellerReturnPolicy: policyReturns.trim() || null,
                    acceptReturns: true,
                    acceptReturnsDays: Math.min(365, Math.max(1, Number(acceptReturnsDays) || 30)),
                  })
                    .then(() => advance("payouts"))
                    .catch((e) => setError((e as { error?: string }).error ?? "Could not save policies."))
                    .finally(() => setLoading(false));
                }}
                continueLabel={loading ? "Saving…" : "Continue"}
                loading={loading}
                continueDisabled={loading || !policyDraft.handlingTime}
              />
            </OnboardingSection>
          ) : null}

          {step === "payouts" ? (
            <>
              <View style={styles.walletWrap}>
                <View style={styles.walletCircle}>
                  <Ionicons name="wallet-outline" size={32} color="#fff" />
                </View>
              </View>
              <OnboardingSection
                title="Payouts"
                description="Set up Stripe so buyers can pay you. You will leave this page for Stripe, then come back here."
              >
                {stripeReady ? (
                  <Text style={styles.readyNote}>Stripe payouts are started for this account.</Text>
                ) : null}
                {error ? <Text style={styles.error}>{error}</Text> : null}
                <Pressable
                  style={({ pressed }) => [styles.payoutBtn, (payoutLoading || pressed) && styles.disabled]}
                  onPress={() => void startPayouts()}
                  disabled={payoutLoading}
                >
                  {payoutLoading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.continueText}>{stripeReady ? "Review payout setup" : "Set Up Payouts"}</Text>
                  )}
                </Pressable>
                <StepActions
                  onBack={() => setStep("policies")}
                  onContinue={() => advance("import")}
                  continueLabel="Continue"
                  continueDisabled={!stripeReady}
                />
              </OnboardingSection>
            </>
          ) : null}

          {step === "import" ? (
            <>
              <Text style={styles.intro}>
                If you already sell on Etsy or Shopify, connect that shop and import your listings. If you only sell on INW, continue to your seller hub.
              </Text>
              <OnboardingSection
                title="Etsy"
                description="Connect your shop if you want to bring listings over."
              >
                {etsyConnected ? (
                  <Text style={styles.readyNote}>Connected{etsyShopName ? `: ${etsyShopName}` : ""}.</Text>
                ) : (
                  <Pressable style={styles.continueBtn} onPress={() => void connectEtsy()} disabled={loading}>
                    <Text style={styles.continueText}>Connect Etsy</Text>
                  </Pressable>
                )}
                {etsyConnected ? (
                  <Pressable
                    style={[styles.continueBtn, { marginTop: 8 }]}
                    onPress={() => router.push("/seller-hub/etsy/import" as never)}
                  >
                    <Text style={styles.continueText}>Import Etsy listings</Text>
                  </Pressable>
                ) : null}
              </OnboardingSection>
              <OnboardingSection
                title="Shopify"
                description="Connect your shop if you want to bring listings over."
              >
                {shopifyConnected ? (
                  <Text style={styles.readyNote}>
                    Connected{shopifyShopDomain ? `: ${shopifyShopDomain}` : ""}.
                  </Text>
                ) : (
                  <>
                    <TextInput
                      style={styles.input}
                      placeholder="your-store.myshopify.com"
                      value={shopifyShop}
                      onChangeText={setShopifyShop}
                      autoCapitalize="none"
                      placeholderTextColor={theme.colors.placeholder}
                    />
                    <Pressable style={styles.continueBtn} onPress={() => void connectShopify()} disabled={loading}>
                      <Text style={styles.continueText}>Connect Shopify</Text>
                    </Pressable>
                  </>
                )}
                {shopifyConnected ? (
                  <Pressable
                    style={[styles.continueBtn, { marginTop: 8 }]}
                    onPress={() => router.push("/seller-hub/shopify/import" as never)}
                  >
                    <Text style={styles.continueText}>Import Shopify listings</Text>
                  </Pressable>
                ) : null}
              </OnboardingSection>
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <StepActions
                onBack={() => setStep("payouts")}
                onContinue={goToSellerHub}
                continueLabel="Go to Seller Hub"
                loading={loading}
              />
            </>
          ) : null}
          {progress}
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}

function StepActions({
  onBack,
  onContinue,
  continueLabel,
  loading,
  continueDisabled,
}: {
  onBack?: () => void;
  onContinue: () => void;
  continueLabel: string;
  loading?: boolean;
  continueDisabled?: boolean;
}) {
  return (
    <View style={styles.buttonRow}>
      {onBack ? (
        <Pressable style={styles.backBtn} onPress={onBack} disabled={loading}>
          <Text style={styles.backBtnText}>Back</Text>
        </Pressable>
      ) : null}
      <Pressable
        style={[styles.continueBtn, !onBack && styles.continueBtnFull, (loading || continueDisabled) && styles.disabled]}
        onPress={onContinue}
        disabled={loading || continueDisabled}
      >
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.continueText}>{continueLabel}</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#f7f3ee" },
  boot: { flex: 1, backgroundColor: "#f7f3ee", alignItems: "center", justifyContent: "center" },
  scroll: { padding: 16, paddingTop: 24, paddingBottom: 40 },
  intro: {
    fontSize: 15,
    lineHeight: 22,
    color: theme.colors.text,
    marginBottom: 16,
  },
  fieldLabel: { fontSize: 14, fontWeight: "600", color: "#374151", marginBottom: 6, marginTop: 8 },
  input: {
    borderWidth: 1.5,
    borderColor: theme.colors.primary,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 12,
    color: theme.colors.text,
    backgroundColor: "#fff",
  },
  daysRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  daysInput: { width: 88, marginBottom: 0 },
  inputDisabled: { opacity: 0.5 },
  hint: { fontSize: 13, color: "#6b7280", marginTop: 8, marginBottom: 4, lineHeight: 18 },
  ageRow: { flexDirection: "row", alignItems: "center", marginBottom: 12, gap: 8 },
  ageLabel: { flex: 1, fontSize: 14, lineHeight: 20, color: theme.colors.text },
  termsText: { fontSize: 13, color: theme.colors.text, marginBottom: 12, lineHeight: 18 },
  termsLink: { textDecorationLine: "underline", fontWeight: "600", color: theme.colors.earth },
  error: { color: "#c00", marginBottom: 12, fontSize: 14 },
  buttonRow: { flexDirection: "row", gap: 8, alignItems: "center", marginTop: 8 },
  backBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: theme.colors.earth,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: "#fff",
  },
  backBtnText: { color: theme.colors.earth, fontSize: 16, fontWeight: "700" },
  continueBtn: {
    flex: 1,
    backgroundColor: theme.colors.earth,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
  },
  continueBtnFull: { flex: 1 },
  continueText: { color: "#fff", fontSize: 16, fontWeight: "700", textAlign: "center" },
  disabled: { opacity: 0.55 },
  logo: { width: 80, height: 80, borderRadius: 40, alignSelf: "center", marginBottom: 12 },
  billingRow: { flexDirection: "row", justifyContent: "center", gap: 8, marginBottom: 12 },
  billingChip: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 8,
    backgroundColor: "#fff",
  },
  billingChipOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  billingChipText: { fontSize: 15, color: "#374151", fontWeight: "600" },
  billingChipTextOn: { color: "#fff" },
  subscribeTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: theme.colors.heading,
    textAlign: "center",
    marginBottom: 8,
    fontFamily: theme.fonts.heading,
  },
  price: { fontSize: 32, fontWeight: "700", textAlign: "center", color: "#111827", marginBottom: 12 },
  priceUnit: { fontSize: 18, fontWeight: "400", color: "#4b5563" },
  copy: { fontSize: 16, lineHeight: 24, color: "#374151", textAlign: "center", marginBottom: 12 },
  bold: { fontWeight: "700" },
  subscribeActions: { gap: 8, marginTop: 8 },
  subscribeBack: {
    width: "100%",
    borderWidth: 1.5,
    borderColor: theme.colors.earth,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: "#fff",
  },
  walletWrap: { alignItems: "center", marginBottom: 12 },
  walletCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: theme.colors.earth,
    alignItems: "center",
    justifyContent: "center",
  },
  readyNote: {
    backgroundColor: "#FDEDCC",
    color: theme.colors.earth,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    fontSize: 14,
  },
  payoutBtn: {
    backgroundColor: theme.colors.earth,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
    width: "100%",
    marginBottom: 8,
  },
});
