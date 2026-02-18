import { useState, useCallback } from "react";
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
  Linking,
  Switch,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiPost, apiPatch } from "@/lib/api";
import { signIn } from "@/lib/auth";
import { useAuth } from "@/contexts/AuthContext";
import { BusinessForm } from "@/components/BusinessForm";
import { SubscriptionCheckoutWithFallback } from "@/components/SubscriptionCheckoutWithFallback";

type Step = "account" | "business" | "contact" | "checkout";

export default function SignupSellerScreen() {
  const router = useRouter();
  const { refreshMember, member } = useAuth();

  useFocusEffect(
    useCallback(() => {
      if (step === "checkout" && member?.subscriptionPlan === "seller") {
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
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
        signupIntent: "seller",
      });
      await signIn(email.trim(), password, "seller");
      await refreshMember();
      setStep("business");
    } catch (e) {
      const err = e as { error?: string };
      if (err.error?.toLowerCase().includes("already registered")) {
        try {
          await signIn(email.trim(), password, "seller");
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

  const handleBusinessDraft = (data: Record<string, unknown>) => {
    setBusinessData(data);
    setError("");
    setStep("contact");
  };

  const handleContactSubmit = async () => {
    setError("");
    setLoading(true);
    try {
      const deliveryAddress =
        street.trim() || city.trim() || state.trim() || zip.trim()
          ? {
              street: street.trim() || undefined,
              city: city.trim() || undefined,
              state: state.trim() || undefined,
              zip: zip.trim() || undefined,
            }
          : null;
      const payload: Record<string, unknown> = {
        phone: phone.trim() || null,
        deliveryAddress,
      };
      if (firstName.trim()) payload.firstName = firstName.trim();
      if (lastName.trim()) payload.lastName = lastName.trim();
      await apiPatch("/api/me", payload);
      setStep("checkout");
    } catch (e) {
      const err = e as { error?: string };
      setError(err.error ?? "Failed to save info.");
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
          <Text style={styles.title}>Sign up as Seller</Text>
          <Text style={styles.subtitle}>
            Create your account to start selling on the Community Storefront.
          </Text>
          <View style={styles.form}>
            <View style={styles.ageRow}>
              <Switch
                value={ageConfirmed}
                onValueChange={setAgeConfirmed}
                trackColor={{ false: "#ccc", true: theme.colors.primary }}
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
                onPress={() => Linking.openURL(`${process.env.EXPO_PUBLIC_API_URL || "https://inwcommunity.com"}/terms`)}
              >
                Terms of Service
              </Text>
              {" "}and{" "}
              <Text
                style={styles.termsLink}
                onPress={() => Linking.openURL(`${process.env.EXPO_PUBLIC_API_URL || "https://inwcommunity.com"}/privacy`)}
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
        <Text style={styles.title}>Business Information</Text>
        <Text style={styles.subtitle}>
          Add your business details for your storefront. You can edit these later. Business must be noncorporate, located in Eastern Washington or North Idaho.
        </Text>
        {error ? <Text style={styles.errorRed}>{error}</Text> : null}
        <BusinessForm
          onSuccess={() => {}}
          onDraftSubmit={handleBusinessDraft}
          draftButtonLabel="Continue"
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
          <Text style={styles.title}>Contact & Shipping</Text>
          <Text style={styles.subtitle}>
            Contact details for order fulfillment. All fields are optional. You can update these later.
          </Text>
          <View style={styles.form}>
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
            <Text style={styles.sectionLabel}>Shipping address (optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="Street"
              value={street}
              onChangeText={setStreet}
              placeholderTextColor={theme.colors.placeholder}
            />
            <View style={styles.row}>
              <TextInput
                style={[styles.input, styles.inputHalf]}
                placeholder="City"
                value={city}
                onChangeText={setCity}
                placeholderTextColor={theme.colors.placeholder}
              />
              <TextInput
                style={[styles.input, styles.inputQuarter]}
                placeholder="State"
                value={state}
                onChangeText={setState}
                placeholderTextColor={theme.colors.placeholder}
                autoCapitalize="characters"
              />
              <TextInput
                style={[styles.input, styles.inputQuarter]}
                placeholder="ZIP"
                value={zip}
                onChangeText={setZip}
                keyboardType="number-pad"
                placeholderTextColor={theme.colors.placeholder}
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
      <View style={styles.container}>
        <Pressable style={styles.back} onPress={() => setStep("contact")}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.primary} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <Text style={styles.title}>Complete Subscription</Text>
        <Text style={styles.subtitle}>
          Subscribe as a Seller to list items on the Community Storefront. You can cancel anytime.
        </Text>
        <SubscriptionCheckoutWithFallback
          planId="seller"
          businessData={businessData ?? undefined}
          onSuccess={handleCheckoutSuccess}
          refreshMember={refreshMember}
        />
      </View>
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
  form: {
    padding: 20,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#000",
    backgroundColor: theme.colors.primary,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#fff",
    marginTop: 16,
    marginBottom: 8,
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
  row: { flexDirection: "row", gap: 8 },
  inputHalf: { flex: 1 },
  inputQuarter: { flex: 0.5 },
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