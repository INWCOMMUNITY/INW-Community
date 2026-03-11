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
  Share,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Text as ThemedText, View as ThemedView } from "@/components/Themed";
import { theme } from "@/lib/theme";
import { signIn } from "@/lib/auth";
import { useAuth } from "@/contexts/AuthContext";
import { API_BASE } from "@/lib/api";
import type { SubscriptionPlan } from "@/lib/auth";

const PLAN_LABELS: Record<SubscriptionPlan, string> = {
  subscribe: "Resident",
  sponsor: "Business",
  seller: "Seller",
};

function getApiHost(): string {
  try {
    const base = (API_BASE ?? "").trim();
    if (base) return new URL(base.replace(/\/$/, "") || "https://www.inwcommunity.com").hostname;
  } catch {
    // ignore
  }
  return "inwcommunity.com";
}

export default function SignInScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ plan?: string; isSignUp?: string; returnTo?: string }>();
  const { refreshMember } = useAuth();
  const plan = (params.plan as SubscriptionPlan) || "subscribe";
  const returnTo = params.returnTo as string | undefined;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [errorPayload, setErrorPayload] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [signingIn, setSigningIn] = useState(false);

  const planLabel = PLAN_LABELS[plan];
  const signInUrl = `${(API_BASE ?? "").replace(/\/$/, "")}/api/auth/mobile-signin`;
  const siteBase = (API_BASE ?? "").replace(/\/$/, "") || "https://www.inwcommunity.com";
  const browserLoginUrl =
    `/web?url=${encodeURIComponent(`${siteBase}/login/mobile?plan=${plan}`)}` +
    `&title=${encodeURIComponent("Sign in")}` +
    `&successPattern=${encodeURIComponent("inwcommunity://auth")}` +
    `&successRoute=${encodeURIComponent(returnTo ?? "/(tabs)/home")}` +
    `&refreshOnSuccess=1`;

  async function handleSignIn() {
    setError("");
    setErrorDetails(null);
    setErrorPayload(null);
    setCopied(false);
    if (!email.trim() || !password) {
      setError("Email and password required");
      return;
    }
    setSigningIn(true);
    try {
      const meUrl = `${(API_BASE ?? "").replace(/\/$/, "")}/api/me`;
      const probeController = new AbortController();
      const probeTimeout = setTimeout(() => probeController.abort(), 10000);
      try {
        const probeRes = await fetch(meUrl, {
          method: "GET",
          headers: {
            Accept: "application/json",
            "User-Agent": "INWCommunity/1.0 (com.northwestcommunity.app; iOS)",
            ...(meUrl.includes("inwcommunity.com")
              ? { Origin: "https://www.inwcommunity.com", Referer: "https://www.inwcommunity.com/" }
              : {}),
          },
          signal: probeController.signal,
        });
        clearTimeout(probeTimeout);
        // Any response (e.g. 401) means server is reachable; proceed to sign-in.
      } catch (probeErr) {
        clearTimeout(probeTimeout);
        const msg = (probeErr as { message?: string }).message ?? String(probeErr);
        setErrorDetails(`Probe GET: ${meUrl}\nError: ${msg}`);
        const probePayload = [
          "--- INW Community sign-in error (probe) ---",
          `Time: ${new Date().toISOString()}`,
          `Platform: ${Platform.OS}`,
          `Probe URL: ${meUrl}`,
          `Error: ${msg}`,
          "--- Paste this when reporting the issue ---",
        ].join("\n");
        setErrorPayload(probePayload);
        setError(
          `Can't reach the server. Check Wi‑Fi or cellular — GET to server failed (${getApiHost()}).`
        );
        return;
      }

      await signIn(email.trim(), password, plan);
      await refreshMember();
      router.replace((returnTo ?? "/(tabs)/home") as import("expo-router").Href);
    } catch (e) {
      const err = e as {
        error?: string;
        status?: number;
        message?: string;
        name?: string;
        code?: string | number;
        [k: string]: unknown;
      };
      const msg = err.error ?? err.message ?? "";
      const rawError = String(e);
      setErrorDetails(`URL: ${signInUrl}\nError: ${msg || rawError}`);

      const payload = [
        "--- INW Community sign-in error ---",
        `Time: ${new Date().toISOString()}`,
        `Platform: ${Platform.OS}`,
        `API_BASE: ${(API_BASE ?? "").replace(/\/$/, "")}`,
        `Sign-in URL: ${signInUrl}`,
        `Error: ${msg || rawError}`,
        err.status != null ? `Status: ${err.status}` : null,
        err.name ? `Name: ${err.name}` : null,
        err.code != null ? `Code: ${err.code}` : null,
        "--- Paste this when reporting the issue ---",
      ]
        .filter(Boolean)
        .join("\n");
      setErrorPayload(payload);

      const isNetworkError =
        err.status === 0 ||
        /network request failed|failed to fetch|timed out|unable to resolve|econnrefused/i.test(msg);

      if (isNetworkError) {
        const host = getApiHost();
        setError(
          `Can't reach the server (${host}). Check your connection — try Wi‑Fi if on cellular, or another network. If Safari can open inwcommunity.com, the app may need an update.`
        );
      } else if (err.status === 401) {
        setError("Invalid email or password.");
      } else if (msg) {
        setError(msg);
      } else {
        setError("Sign in failed");
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

      <View style={styles.header}>
        <Text style={styles.title}>Sign in as {planLabel}</Text>
        <Text style={styles.serverHint}>Server: {getApiHost()}</Text>
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
          textContentType="emailAddress"
          autoComplete="email"
          autoCorrect={true}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholderTextColor={theme.colors.placeholder}
          textContentType="password"
          autoComplete="password"
          autoCorrect={true}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {errorDetails ? (
          <Text style={styles.errorDetails} selectable>
            {errorDetails}
          </Text>
        ) : null}
        {errorPayload ? (
          <Pressable
            style={styles.copyButton}
            onPress={async () => {
              try {
                await Clipboard.setStringAsync(errorPayload);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch {
                try {
                  await Share.share({
                    message: errorPayload,
                    title: "Sign-in error details",
                  });
                } catch {
                  // ignore
                }
              }
            }}
          >
            <Text style={styles.copyButtonText}>
              {copied ? "Copied to clipboard" : "Copy error details"}
            </Text>
          </Pressable>
        ) : null}
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
        <Pressable
          style={({ pressed }) => [styles.browserLink, pressed && { opacity: 0.8 }]}
          onPress={() => router.push(browserLoginUrl as never)}
          disabled={signingIn}
        >
          <Text style={styles.browserLinkText}>
            Sign in with browser (if app sign-in fails)
          </Text>
        </Pressable>
      </ThemedView>

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
  serverHint: {
    fontSize: 12,
    color: "#888",
    marginTop: 6,
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
  errorDetails: {
    color: "rgba(255,255,255,0.9)",
    marginBottom: 12,
    fontSize: 11,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  copyButton: {
    alignSelf: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 16,
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 8,
  },
  copyButtonText: {
    fontSize: 13,
    color: "#fff",
  },
  browserLink: {
    marginTop: 16,
    paddingVertical: 8,
    alignSelf: "center",
  },
  browserLinkText: {
    fontSize: 14,
    color: "rgba(255,255,255,0.95)",
    textDecorationLine: "underline",
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
});
