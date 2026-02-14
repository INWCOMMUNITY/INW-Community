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
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiPost } from "@/lib/api";
import { signIn } from "@/lib/auth";
import { useAuth } from "@/contexts/AuthContext";
import { BusinessForm } from "@/components/BusinessForm";

type Step = "account" | "business";

export default function SignupBusinessScreen() {
  const router = useRouter();
  const { refreshMember } = useAuth();
  const [step, setStep] = useState<Step>("account");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleAccountSubmit = async () => {
    setError("");
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !password) {
      setError("All fields are required.");
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
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      });
      await signIn(email.trim(), password, "sponsor");
      await refreshMember();
      setStep("business");
    } catch (e) {
      const err = e as { error?: string };
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
        setError(err.error ?? "Sign up failed. Try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleBusinessDraft = async (data: Record<string, unknown>) => {
    setLoading(true);
    setError("");
    try {
      await apiPost("/api/auth/mobile-register-business", data);
      await refreshMember();
      router.replace("/(tabs)/my-community");
    } catch (e) {
      const err = e as { error?: string };
      setError(err.error ?? "Registration failed. Try again.");
    } finally {
      setLoading(false);
    }
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
            Create your account, then add your business information.
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
          Add your business details for your storefront. You can edit these details later. Business must be noncorporate, located in Eastern Washington or North Idaho.
        </Text>
        {error ? <Text style={styles.errorRed}>{error}</Text> : null}
        <BusinessForm
          onSuccess={() => {}}
          onDraftSubmit={handleBusinessDraft}
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
