import { useState, useEffect } from "react";
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
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  signupAgeSwitchOutline,
  switchIosBackgroundColor,
  switchThumbColor,
  switchTrackColor,
  theme,
} from "@/lib/theme";
import { apiPost } from "@/lib/api";
import { signIn } from "@/lib/auth";
import { useAuth } from "@/contexts/AuthContext";
import { BadgeEarnedPopup } from "@/components/BadgeEarnedPopup";
import { PREBUILT_CITIES } from "@/lib/prebuilt-cities";
import { normalizeResidentCity } from "@/lib/city-utils";
import {
  clearPendingReferralCode,
  getPendingReferralCode,
  setPendingReferralCode,
} from "@/lib/referral-code";

interface EarnedBadge {
  slug: string;
  name: string;
  description?: string;
}

export default function SignupResidentScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ ref?: string }>();
  const { refreshMember } = useAuth();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [retypePassword, setRetypePassword] = useState("");
  /** Selected prebuilt city, "Other", or "" (optional). */
  const [cityPicker, setCityPicker] = useState("");
  const [customCity, setCustomCity] = useState("");
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [earnedBadges, setEarnedBadges] = useState<EarnedBadge[]>([]);
  const [badgePopupIndex, setBadgePopupIndex] = useState(-1);

  useEffect(() => {
    const raw = params.ref;
    const code = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : undefined;
    if (code) void setPendingReferralCode(code);
  }, [params.ref]);

  const finishSignup = async () => {
    try {
      await AsyncStorage.multiRemove([
        "nwc_community_ugc_terms_v1",
        "nwc_community_ugc_terms_v2",
      ]).catch(() => {});
      await signIn(email.trim(), password, "subscribe");
      await refreshMember?.();
      router.replace("/(tabs)");
    } catch {
      setError("Signed up but could not sign in. Please log in from the login screen.");
    }
  };

  const handleSubmit = async () => {
    setError("");
    if (!ageConfirmed) {
      setError("You must confirm you are 16 years or older to sign up.");
      return;
    }
    if (!firstName.trim() || !lastName.trim()) {
      setError("First name and last name are required.");
      return;
    }
    if (!email.trim()) {
      setError("Email is required.");
      return;
    }
    if (!password) {
      setError("Password is required.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== retypePassword) {
      setError("Passwords do not match.");
      return;
    }
    let cityOut: string | undefined;
    if (cityPicker === "Other") {
      const n = normalizeResidentCity(customCity);
      cityOut = n.trim() || undefined;
    } else if (cityPicker) {
      cityOut = cityPicker;
    }

    setLoading(true);
    try {
      const ref = await getPendingReferralCode();
      const res = await apiPost<{ ok?: boolean; earnedBadges?: EarnedBadge[] }>("/api/auth/signup", {
        email: email.trim().toLowerCase(),
        password,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        city: cityOut,
        signupIntent: "resident",
        ...(ref ? { ref } : {}),
      });
      await clearPendingReferralCode();
      if (res?.earnedBadges?.length) {
        setEarnedBadges(res.earnedBadges);
        setBadgePopupIndex(0);
      } else {
        await finishSignup();
      }
    } catch (e) {
      const err = e as { error?: string };
      setError(err.error ?? "Sign up failed. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Pressable
        style={styles.back}
        onPress={() => {
          if (router.canGoBack()) {
            router.back();
          } else {
            router.replace("/(tabs)" as import("expo-router").Href);
          }
        }}
      >
        <Ionicons name="arrow-back" size={24} color={theme.colors.primary} />
        <Text style={styles.backText}>Back</Text>
      </Pressable>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>Sign up as Resident</Text>
        <Text style={styles.subtitle}>
          Join the community. No subscription required.
        </Text>
        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="First name"
            value={firstName}
            onChangeText={setFirstName}
            placeholderTextColor={theme.colors.placeholder}
            autoCapitalize="words"
            textContentType="givenName"
            autoCorrect={true}
          />
          <TextInput
            style={styles.input}
            placeholder="Last name"
            value={lastName}
            onChangeText={setLastName}
            placeholderTextColor={theme.colors.placeholder}
            autoCapitalize="words"
            textContentType="familyName"
            autoCorrect={true}
          />
          <TextInput
            style={styles.input}
            placeholder="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholderTextColor={theme.colors.placeholder}
            textContentType="emailAddress"
            autoCorrect={true}
          />
          <TextInput
            style={styles.input}
            placeholder="Password (min 8 characters)"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholderTextColor={theme.colors.placeholder}
            textContentType="newPassword"
            autoCorrect={true}
          />
          <TextInput
            style={styles.input}
            placeholder="Retype password"
            value={retypePassword}
            onChangeText={setRetypePassword}
            secureTextEntry
            placeholderTextColor={theme.colors.placeholder}
            textContentType="newPassword"
            autoCorrect={true}
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
            <Text style={styles.ageLabel}>I confirm I am 16 years or older (users under 18 need parent/guardian permission)</Text>
          </View>
          <Text style={styles.cityLabel}>City of residence (optional)</Text>
          <Text style={styles.cityHint}>
            Same list as business profiles. Choose Other if your city is not listed.
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.pickerScroll}
            contentContainerStyle={styles.pickerRow}
          >
            {[...PREBUILT_CITIES, "Other"].map((c) => (
              <Pressable
                key={c}
                style={[
                  styles.pickerOption,
                  cityPicker === c && styles.pickerOptionSelected,
                ]}
                onPress={() => setCityPicker((prev) => (prev === c ? "" : c))}
              >
                <Text
                  style={[
                    styles.pickerOptionText,
                    cityPicker === c && styles.pickerOptionTextSelected,
                  ]}
                  numberOfLines={1}
                >
                  {c}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          {cityPicker === "Other" ? (
            <TextInput
              style={styles.input}
              placeholder="Enter your city (e.g. CDA → Coeur d'Alene)"
              value={customCity}
              onChangeText={setCustomCity}
              placeholderTextColor={theme.colors.placeholder}
              autoCapitalize="words"
              autoCorrect={true}
            />
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Text style={styles.termsText}>
            By signing up, you agree to our{" "}
            <Text
              style={styles.termsLink}
              onPress={() =>
                router.push(
                  `/web?url=${encodeURIComponent(`${process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com"}/terms`)}&title=${encodeURIComponent("Terms of Service")}` as never
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
                  `/web?url=${encodeURIComponent(`${process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com"}/privacy`)}&title=${encodeURIComponent("Privacy Policy")}` as never
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
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Sign up</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>

      {badgePopupIndex >= 0 && badgePopupIndex < earnedBadges.length && (
        <BadgeEarnedPopup
          visible
          onClose={() => {
            const next = badgePopupIndex + 1;
            if (next < earnedBadges.length) {
              setBadgePopupIndex(next);
            } else {
              setBadgePopupIndex(-1);
              setEarnedBadges([]);
              finishSignup();
            }
          }}
          badgeName={earnedBadges[badgePopupIndex].name}
          badgeSlug={earnedBadges[badgePopupIndex].slug}
          badgeDescription={earnedBadges[badgePopupIndex].description}
        />
      )}
    </KeyboardAvoidingView>
  );
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
  cityLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#fff",
    marginBottom: 4,
  },
  cityHint: {
    fontSize: 12,
    color: "#fff",
    opacity: 0.9,
    marginBottom: 8,
    lineHeight: 17,
  },
  pickerScroll: { marginBottom: 12, marginHorizontal: -4 },
  pickerRow: { flexDirection: "row", gap: 8, paddingHorizontal: 4, flexWrap: "wrap" },
  pickerOption: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#fff",
  },
  pickerOptionSelected: { backgroundColor: "#fff" },
  pickerOptionText: { fontSize: 13, color: "#fff" },
  pickerOptionTextSelected: { color: theme.colors.primary },
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