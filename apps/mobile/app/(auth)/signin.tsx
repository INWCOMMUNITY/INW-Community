import { useState } from "react";
import {
  StyleSheet,
  Pressable,
  TextInput,
  Text,
  View,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Text as ThemedText, View as ThemedView } from "@/components/Themed";
import { theme } from "@/lib/theme";
import { signIn } from "@/lib/auth";
import { useAuth } from "@/contexts/AuthContext";
import type { SubscriptionPlan } from "@/lib/auth";

const PLAN_LABELS: Record<SubscriptionPlan, string> = {
  subscribe: "Resident",
  sponsor: "Business",
  seller: "Seller",
};

export default function SignInScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ plan?: string; isSignUp?: string; returnTo?: string }>();
  const { refreshMember } = useAuth();
  const plan = (params.plan as SubscriptionPlan) || "subscribe";
  const returnTo = params.returnTo as string | undefined;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [signingIn, setSigningIn] = useState(false);

  const planLabel = PLAN_LABELS[plan];

  async function handleSignIn() {
    setError("");
    if (!email.trim() || !password) {
      setError("Email and password required");
      return;
    }
    setSigningIn(true);
    try {
      await signIn(email.trim(), password, plan);
      await refreshMember();
      router.replace((returnTo ?? "/(tabs)/home") as import("expo-router").Href);
    } catch (e) {
      const err = e as { error?: string; status?: number; message?: string };
      if (err.error) {
        setError(err.error);
      } else if (
        err.message?.toLowerCase().includes("fetch") ||
        err.message?.toLowerCase().includes("network") ||
        err.message?.toLowerCase().includes("failed to fetch")
      ) {
        setError(
          "Cannot reach server. Ensure: 1) Site is running (pnpm dev:main). 2) .env has EXPO_PUBLIC_API_URL set. 3) Phone and computer on same WiFi."
        );
      } else if (err.status === 401) {
        setError("Invalid email or password.");
      } else {
        setError(err.message ?? "Sign in failed");
      }
    } finally {
      setSigningIn(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Pressable style={styles.back} onPress={() => router.back()}>
        <Ionicons name="arrow-back" size={24} color={theme.colors.primary} />
        <Text style={styles.backText}>Back</Text>
      </Pressable>

      <View style={styles.header}>
        <Text style={styles.title}>Sign in as {planLabel}</Text>
      </View>

      <ThemedView style={styles.form} lightColor="#fff" darkColor={theme.colors.secondary}>
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
          placeholder="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholderTextColor={theme.colors.placeholder}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable
          style={({ pressed }) => [
            styles.button,
            signingIn && styles.buttonDisabled,
            pressed && styles.buttonPressed,
          ]}
          onPress={handleSignIn}
          disabled={signingIn}
        >
          {signingIn ? (
            <ActivityIndicator color={theme.colors.primary} />
          ) : (
            <Text style={styles.buttonText}>Sign In</Text>
          )}
        </Pressable>
      </ThemedView>

      <Text style={styles.testHint}>
        Universal test: universal@nwc.local / Universal123! (works as Resident, Business, or Seller)
      </Text>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    paddingTop: 48,
    backgroundColor: "#ffffff",
  },
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
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: "bold",
    color: theme.colors.heading,
    fontFamily: theme.fonts.heading,
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
  button: {
    backgroundColor: "#fff",
    paddingVertical: 12,
    alignItems: "center",
    borderRadius: 4,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonPressed: { opacity: 0.8 },
  buttonText: {
    color: theme.colors.primary,
    fontSize: 16,
    fontWeight: "600",
  },
  testHint: {
    marginTop: 24,
    fontSize: 12,
    color: theme.colors.text,
    textAlign: "center",
  },
});
