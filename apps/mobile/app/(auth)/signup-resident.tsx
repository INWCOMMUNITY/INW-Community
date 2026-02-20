import { useState } from "react";
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
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiPost } from "@/lib/api";
import { signIn } from "@/lib/auth";
import { useAuth } from "@/contexts/AuthContext";

export default function SignupResidentScreen() {
  const router = useRouter();
  const { refreshMember } = useAuth();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [retypePassword, setRetypePassword] = useState("");
  const [city, setCity] = useState("");
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
    setLoading(true);
    try {
      await apiPost("/api/auth/signup", {
        email: email.trim().toLowerCase(),
        password,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        city: city.trim() || undefined,
        signupIntent: "resident",
      });
      await signIn(email.trim(), password, "subscribe");
      await refreshMember();
      router.replace("/(tabs)");
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
      <Pressable style={styles.back} onPress={() => router.back()}>
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
          />
          <TextInput
            style={styles.input}
            placeholder="Last name"
            value={lastName}
            onChangeText={setLastName}
            placeholderTextColor={theme.colors.placeholder}
            autoCapitalize="words"
            textContentType="familyName"
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
          />
          <TextInput
            style={styles.input}
            placeholder="Password (min 8 characters)"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholderTextColor={theme.colors.placeholder}
            textContentType="newPassword"
          />
          <TextInput
            style={styles.input}
            placeholder="Retype password"
            value={retypePassword}
            onChangeText={setRetypePassword}
            secureTextEntry
            placeholderTextColor={theme.colors.placeholder}
            textContentType="newPassword"
          />
          <View style={styles.ageRow}>
            <Switch
              value={ageConfirmed}
              onValueChange={setAgeConfirmed}
              trackColor={{ false: "#fff", true: "#d2b48c" }}
              thumbColor="#fff"
            />
            <Text style={styles.ageLabel}>I confirm I am 16 years or older (users under 18 need parent/guardian permission)</Text>
          </View>
          <TextInput
            style={styles.input}
            placeholder="City of residence"
            value={city}
            onChangeText={setCity}
            placeholderTextColor={theme.colors.placeholder}
            autoCapitalize="words"
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