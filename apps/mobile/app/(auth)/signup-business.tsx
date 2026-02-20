import { useState, useCallback, useRef } from "react";
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
import { useRouter, useFocusEffect } from "expo-router";
import { useNavigation, usePreventRemove } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiPost, apiPatch } from "@/lib/api";
import { signIn } from "@/lib/auth";
import { useAuth } from "@/contexts/AuthContext";
import { BusinessForm } from "@/components/BusinessForm";
import { SubscriptionCheckoutWithFallback } from "@/components/SubscriptionCheckoutWithFallback";

type Step = "account" | "business" | "contact" | "checkout";

const STEP_ORDER: Step[] = ["account", "business", "contact", "checkout"];

export default function SignupBusinessScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { refreshMember, member, signOut } = useAuth();

  useFocusEffect(
    useCallback(() => {
      if (step === "checkout" && member?.subscriptionPlan === "sponsor") {
        router.replace("/(tabs)/my-community");
      }
    }, [step, member?.subscriptionPlan])
  );
  const [step, setStep] = useState<Step>("account");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [businessData, setBusinessData] = useState<Record<string, unknown> | null>(null);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [billingInterval, setBillingInterval] = useState<"monthly" | "yearly">("monthly");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const isExitingRef = useRef(false);

  usePreventRemove(!isExitingRef.current, ({ data }) => {
    const idx = STEP_ORDER.indexOf(step);
    if (idx > 0) {
      setStep(STEP_ORDER[idx - 1]);
    } else {
      Alert.alert(
        "Leave Sign Up?",
        "Are you sure you want to leave Business sign up? Progress will not be saved.",
        [
          { text: "Stay", style: "cancel" },
          {
            text: "Leave",
            style: "destructive",
            onPress: async () => {
              await signOut();
              isExitingRef.current = true;
              navigation.dispatch(data.action);
            },
          },
        ]
      );
    }
  });

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
      await apiPost("/api/auth/signup", {
        email: email.trim().toLowerCase(),
        password,
        signupIntent: "business",
      });
      await signIn(email.trim(), password, "sponsor");
      await refreshMember();
      setStep("business");
    } catch (e) {
      const err = e as { error?: string; status?: number };
      if (err.error?.toLowerCase().includes("already registered")) {
        try {
          await signIn(email.trim(), password, "sponsor");
          await refreshMember();
          setStep("business");
          return;
        } catch {
          setError("Email already registered. Sign in from the login screen.");
        }
      } else {
        const msg = err.error ?? "Sign up failed. Try again.";
        setError(msg);
        if (__DEV__ && err.status === 0) {
          console.warn("[signup-business] API error:", msg, "API_BASE=", process.env.EXPO_PUBLIC_API_URL || "localhost:3000");
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleBusinessDraft = (data: Record<string, unknown>) => {
    setBusinessData(data);
    setError("");
    setStep("contact");
  };

  const handleContactSubmit = async () => {
    setError("");
    if (!firstName.trim() || !lastName.trim()) {
      setError("First name and last name are required.");
      return;
    }
    if (!street.trim() || !city.trim() || !state.trim() || !zip.trim()) {
      setError("Full mailing address is required for tax calculation.");
      return;
    }
    setLoading(true);
    try {
      const validation = await apiPost<{
        valid: boolean;
        error?: string;
        formatted?: { street: string; city: string; state: string; zip: string };
      }>("/api/validate-address", {
        street: street.trim(),
        city: city.trim(),
        state: state.trim(),
        zip: zip.trim(),
      });

      if (!validation.valid) {
        setError(validation.error ?? "We couldn't verify this address. Please check and try again.");
        setLoading(false);
        return;
      }

      if (validation.formatted) {
        setStreet(validation.formatted.street);
        setCity(validation.formatted.city);
        setState(validation.formatted.state);
        setZip(validation.formatted.zip);
      }

      const addr = validation.formatted ?? {
        street: street.trim(),
        city: city.trim(),
        state: state.trim(),
        zip: zip.trim(),
      };

      await apiPatch("/api/me", {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim() || null,
        deliveryAddress: addr,
      });
      setStep("checkout");
    } catch (e) {
      const err = e as { error?: string };
      setError(err.error ?? "Failed to save contact info.");
    } finally {
      setLoading(false);
    }
  };

  const handleCheckoutSuccess = () => {
    refreshMember()
      .then(() => router.replace("/(tabs)/my-community"))
      .catch((e) => {
        if (__DEV__) console.warn("[handleCheckoutSuccess]", e);
        router.replace("/(tabs)/my-community");
      });
  };

  if (step === "account") {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable style={styles.back} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.primary} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Text style={styles.title}>Sign up as Business</Text>
          <Text style={styles.subtitle}>
            Create your account with email and password. You will add business and contact info next.
          </Text>
          <View style={styles.form}>
            <View style={styles.ageRow}>
              <Switch
                value={ageConfirmed}
                onValueChange={setAgeConfirmed}
                trackColor={{ false: "#fff", true: "#d2b48c" }}
                thumbColor="#fff"
              />
              <Text style={styles.ageLabel}>I confirm I am 16 years or older</Text>
            </View>
            <TextInput
              style={styles.input}
              placeholder="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholderTextColor={theme.colors.placeholder}
            />
            <TextInput
              style={styles.input}
              placeholder="Password (min 8 characters)"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholderTextColor={theme.colors.placeholder}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Text style={styles.termsText}>
              By signing up, you agree to our{" "}
              <Text
                style={styles.termsLink}
                onPress={() =>
                  router.push(
                    `/web?url=${encodeURIComponent(`${process.env.EXPO_PUBLIC_API_URL || "https://inwcommunity.com"}/terms`)}&title=${encodeURIComponent("Terms of Service")}` as never
                  )
                }
              >
                Terms of Service
              </Text>
              {" "}and{" "}
              <Text
                style={styles.termsLink}
                onPress={() =>
                  router.push(
                    `/web?url=${encodeURIComponent(`${process.env.EXPO_PUBLIC_API_URL || "https://inwcommunity.com"}/privacy`)}&title=${encodeURIComponent("Privacy Policy")}` as never
                  )
                }
              >
                Privacy Policy
              </Text>
              .
            </Text>
            <Pressable
              style={({ pressed }) => [
                styles.button,
                (loading || pressed) && styles.buttonDisabled,
              ]}
              onPress={handleAccountSubmit}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Continue</Text>
              )}
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  if (step === "business") {
    return (
      <View style={styles.container}>
        <Pressable style={styles.back} onPress={() => setStep("account")}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.primary} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <BusinessForm
          onSuccess={() => {}}
          onDraftSubmit={handleBusinessDraft}
          draftButtonLabel="Continue"
          headerContent={
            <>
              <Text style={styles.title}>Business Information</Text>
              <Text style={styles.subtitle}>
                Add your business details for your storefront. You can edit these later. Business must be noncorporate, located in Eastern Washington or North Idaho.
              </Text>
              {error ? <Text style={styles.errorRed}>{error}</Text> : null}
            </>
          }
        />
      </View>
    );
  }

  if (step === "contact") {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable style={styles.back} onPress={() => setStep("business")}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.primary} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Text style={styles.title}>Contact & Mailing Address</Text>
          <Text style={styles.subtitle}>
            Private contact details for NWC to reach you. Your mailing address is used to calculate applicable sales tax. This information is not shared publicly.
          </Text>
          <View style={styles.form}>
            <TextInput
              style={styles.input}
              placeholder="First name *"
              value={firstName}
              onChangeText={setFirstName}
              placeholderTextColor={theme.colors.placeholder}
              autoCapitalize="words"
              textContentType="givenName"
            />
            <TextInput
              style={styles.input}
              placeholder="Last name *"
              value={lastName}
              onChangeText={setLastName}
              placeholderTextColor={theme.colors.placeholder}
              autoCapitalize="words"
              textContentType="familyName"
            />
            <TextInput
              style={styles.input}
              placeholder="Phone (optional)"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              placeholderTextColor={theme.colors.placeholder}
              textContentType="telephoneNumber"
            />
            <TextInput
              style={styles.input}
              placeholder="Street address *"
              value={street}
              onChangeText={setStreet}
              placeholderTextColor={theme.colors.placeholder}
              autoCapitalize="words"
              textContentType="streetAddressLine1"
            />
            <TextInput
              style={styles.input}
              placeholder="City *"
              value={city}
              onChangeText={setCity}
              placeholderTextColor={theme.colors.placeholder}
              autoCapitalize="words"
              textContentType="addressCity"
            />
            <View style={styles.row}>
              <TextInput
                style={[styles.input, styles.halfInput]}
                placeholder="State *"
                value={state}
                onChangeText={setState}
                placeholderTextColor={theme.colors.placeholder}
                autoCapitalize="characters"
                maxLength={2}
                textContentType="addressState"
              />
              <TextInput
                style={[styles.input, styles.halfInput]}
                placeholder="ZIP *"
                value={zip}
                onChangeText={setZip}
                placeholderTextColor={theme.colors.placeholder}
                keyboardType="number-pad"
                maxLength={10}
                textContentType="postalCode"
              />
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable
              style={({ pressed }) => [
                styles.button,
                (loading || pressed) && styles.buttonDisabled,
              ]}
              onPress={handleContactSubmit}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Continue to Checkout</Text>
              )}
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  if (step === "checkout") {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
        <Pressable style={styles.back} onPress={() => setStep("contact")}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.primary} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <View style={styles.checkoutLogoWrap}>
          <Image
            source={require("@/assets/images/nwc-community-logo.png")}
            style={styles.checkoutLogo}
            resizeMode="contain"
            accessibilityLabel="Northwest Community"
          />
        </View>
        <Text style={styles.checkoutTitle}>Subscribe as a Local Business</Text>
        <Text style={styles.checkoutSubtitle}>
          Join Northwest Community&apos;s Local Business Directory on the website and app. Offer coupons, post events on our calendar, gain visibility, and reward the community for supporting local businesses. Thank you for being here. Reach out anytime!
        </Text>
        <View style={styles.pricingWrap}>
          <View style={styles.intervalToggle}>
            <Pressable
              style={[styles.intervalBtn, billingInterval === "monthly" && styles.intervalBtnActive]}
              onPress={() => setBillingInterval("monthly")}
            >
              <Text style={[styles.intervalBtnText, billingInterval === "monthly" && styles.intervalBtnTextActive]}>Monthly</Text>
            </Pressable>
            <Pressable
              style={[styles.intervalBtn, billingInterval === "yearly" && styles.intervalBtnActive]}
              onPress={() => setBillingInterval("yearly")}
            >
              <Text style={[styles.intervalBtnText, billingInterval === "yearly" && styles.intervalBtnTextActive]}>Yearly</Text>
            </Pressable>
          </View>
          <View style={styles.priceCard}>
            {billingInterval === "monthly" ? (
              <Text style={styles.priceText}><Text style={styles.priceAmount}>$25</Text> a month</Text>
            ) : (
              <>
                <Text style={styles.priceText}><Text style={styles.priceAmount}>$250</Text> a year</Text>
                <Text style={styles.priceSavings}>Save $50 a year</Text>
              </>
            )}
          </View>
        </View>
        <View style={styles.checkoutBtnWrap}>
          <SubscriptionCheckoutWithFallback
            planId="sponsor"
            businessData={businessData ?? undefined}
            interval={billingInterval}
            onSuccess={handleCheckoutSuccess}
            refreshMember={refreshMember}
          />
        </View>
      </ScrollView>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff", padding: 24, paddingTop: 48 },
  scrollContent: { paddingBottom: 32 },
  back: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 24,
  },
  backText: {
    marginLeft: 8,
    fontSize: 16,
    color: theme.colors.primary,
    fontWeight: "600",
  },
  title: {
    fontSize: 22,
    fontWeight: "bold",
    color: theme.colors.heading,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: theme.colors.text,
    marginBottom: 24,
    lineHeight: 22,
  },
  checkoutLogoWrap: {
    alignItems: "center",
    marginBottom: 20,
  },
  checkoutLogo: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  checkoutTitle: {
    fontSize: 22,
    fontWeight: "bold",
    color: theme.colors.heading,
    marginBottom: 12,
    textAlign: "center",
  },
  checkoutSubtitle: {
    fontSize: 17,
    color: theme.colors.text,
    marginBottom: 24,
    lineHeight: 26,
    textAlign: "center",
  },
  pricingWrap: {
    alignSelf: "center",
    width: "80%",
    marginBottom: 20,
  },
  intervalToggle: {
    flexDirection: "row",
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    overflow: "hidden",
  },
  intervalBtn: {
    paddingVertical: 14,
    backgroundColor: "#fff",
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  intervalBtnActive: {
    backgroundColor: theme.colors.primary,
  },
  intervalBtnText: {
    fontSize: 18,
    fontWeight: "600",
    color: theme.colors.primary,
  },
  intervalBtnTextActive: {
    color: "#fff",
  },
  priceCard: {
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    borderWidth: 2,
    borderTopWidth: 0,
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.cream ?? "#faf5ee",
  },
  priceText: {
    fontSize: 19,
    color: theme.colors.text,
  },
  priceAmount: {
    fontSize: 24,
    fontWeight: "bold",
    color: theme.colors.heading,
  },
  priceSavings: {
    fontSize: 14,
    color: theme.colors.primary,
    fontWeight: "600",
    marginTop: 3,
  },
  checkoutBtnWrap: {
    alignItems: "center",
    width: "100%",
  },
  form: {
    padding: 20,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#000",
    backgroundColor: theme.colors.primary,
  },
  row: {
    flexDirection: "row",
    gap: 12,
  },
  halfInput: {
    flex: 1,
  },
  input: {
    borderWidth: 2,
    borderColor: "#000",
    borderRadius: 4,
    padding: 12,
    fontSize: 16,
    marginBottom: 12,
    color: "#000",
    backgroundColor: "#fff",
  },
  error: {
    color: "#fff",
    marginBottom: 12,
    fontSize: 14,
  },
  termsText: {
    fontSize: 12,
    color: "#fff",
    marginBottom: 12,
    lineHeight: 18,
  },
  termsLink: {
    textDecorationLine: "underline",
    fontWeight: "600",
  },
  ageRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
    gap: 8,
  },
  ageLabel: {
    flex: 1,
    fontSize: 14,
    color: "#fff",
  },
  errorRed: {
    color: "#c00",
    marginBottom: 12,
    fontSize: 14,
  },
  button: {
    backgroundColor: "#fff",
    paddingVertical: 12,
    alignItems: "center",
    borderRadius: 4,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: {
    color: theme.colors.primary,
    fontSize: 16,
    fontWeight: "600",
  },
});