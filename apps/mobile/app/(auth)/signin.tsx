import { useRef, useState } from "react";
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
import { useRouter, useLocalSearchParams, type Href } from "expo-router";
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

function signupRouteForPlan(p: SubscriptionPlan): Href {
  if (p === "subscribe") return "/signup-resident";
  if (p === "sponsor") return "/signup-business";
  return "/signup-seller";
}

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
  const params = useLocalSearchParams<{
    plan?: string;
    isSignUp?: string;
    returnTo?: string;
    emailVerified?: string;
    passwordReset?: string;
  }>();
  const { refreshMember } = useAuth();
  const plan = (params.plan as SubscriptionPlan) || "subscribe";
  const returnToRaw = params.returnTo;
  const returnToParam =
    typeof returnToRaw === "string"
      ? returnToRaw
      : Array.isArray(returnToRaw)
        ? returnToRaw[0]
        : undefined;
  const returnTo = returnToParam
    ? (() => {
        try {
          return decodeURIComponent(returnToParam);
        } catch {
          return returnToParam;
        }
      })()
    : undefined;
  const emailJustVerified = params.emailVerified === "1";
  const passwordJustReset = params.passwordReset === "1";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [emailNotRecognized, setEmailNotRecognized] = useState(false);
  const [emailNotVerified, setEmailNotVerified] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [errorPayload, setErrorPayload] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [credentialFailCount, setCredentialFailCount] = useState(0);
  const lastFailedEmailRef = useRef("");

  const planLabel = PLAN_LABELS[plan];
  const signInUrl = `${(API_BASE ?? "").replace(/\/$/, "")}/api/auth/mobile-signin`;

  async function handleSignIn() {
    setError("");
    setEmailNotRecognized(false);
    setEmailNotVerified(false);
    setResendMessage(null);
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

      const trimmedEmail = email.trim();
      await signIn(trimmedEmail, password, plan);
      await refreshMember();
      const defaultRoute = emailJustVerified ? "/(tabs)/my-community" : "/(tabs)/home";
      router.replace((returnTo ?? defaultRoute) as import("expo-router").Href);
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

      const isNetworkError =
        err.status === 0 ||
        /network request failed|failed to fetch|timed out|unable to resolve|econnrefused/i.test(msg);

      if (isNetworkError) {
        const host = getApiHost();
        setErrorDetails(`URL: ${signInUrl}\nError: ${msg || rawError}`);
        setErrorPayload(
          [
            "--- INW Community sign-in error ---",
            `Time: ${new Date().toISOString()}`,
            `Platform: ${Platform.OS}`,
            `API_BASE: ${(API_BASE ?? "").replace(/\/$/, "")}`,
            `Sign-in URL: ${signInUrl}`,
            `Error: ${msg || rawError}`,
            err.status != null ? `Status: ${err.status}` : null,
            "--- Paste this when reporting the issue ---",
          ]
            .filter(Boolean)
            .join("\n")
        );
        setError(
          `Can't reach the server (${host}). Check your connection — try Wi‑Fi if on cellular, or another network. If Safari can open inwcommunity.com, the app may need an update.`
        );
      } else if (err.status === 401 && msg === "EMAIL_NOT_FOUND") {
        setErrorDetails(null);
        setErrorPayload(null);
        lastFailedEmailRef.current = email.trim();
        setCredentialFailCount((c) => c + 1);
        setEmailNotRecognized(true);
        setError("");
      } else if (err.status === 403 && (msg === "EMAIL_NOT_VERIFIED" || err.code === "EMAIL_NOT_VERIFIED")) {
        setErrorDetails(null);
        setErrorPayload(null);
        lastFailedEmailRef.current = email.trim();
        setCredentialFailCount((c) => c + 1);
        setEmailNotVerified(true);
        setError("");
      } else if (err.status === 401) {
        setErrorDetails(null);
        setErrorPayload(null);
        lastFailedEmailRef.current = email.trim();
        setCredentialFailCount((c) => c + 1);
        if (msg === "INVALID_PASSWORD") {
          setError("Incorrect password.");
        } else {
          setError("Invalid email or password.");
        }
      } else {
        setErrorDetails(`URL: ${signInUrl}\nError: ${msg || rawError}`);
        setErrorPayload(
          [
            "--- INW Community sign-in error ---",
            `Time: ${new Date().toISOString()}`,
            `Platform: ${Platform.OS}`,
            `Sign-in URL: ${signInUrl}`,
            `Error: ${msg || rawError}`,
            err.status != null ? `Status: ${err.status}` : null,
            err.name ? `Name: ${err.name}` : null,
            err.code != null ? `Code: ${err.code}` : null,
            "--- Paste this when reporting the issue ---",
          ]
            .filter(Boolean)
            .join("\n")
        );
        lastFailedEmailRef.current = email.trim();
        setCredentialFailCount((c) => c + 1);
        if (msg) {
          setError(msg);
        } else {
          setError("Sign in failed");
        }
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
      </View>

      {emailJustVerified ? (
        <View style={styles.verifiedBanner}>
          <Text style={styles.verifiedBannerText}>Email verified. You can sign in below.</Text>
        </View>
      ) : null}
      {passwordJustReset ? (
        <View style={styles.verifiedBanner}>
          <Text style={styles.verifiedBannerText}>Password updated. Sign in with your new password.</Text>
        </View>
      ) : null}

      <ThemedView style={styles.form} lightColor="#fff" darkColor={theme.colors.secondary}>
        <TextInput
          style={styles.input}
          placeholder="Email"
          value={email}
          onChangeText={(t) => {
            if (t.trim() !== lastFailedEmailRef.current) {
              setCredentialFailCount(0);
            }
            setEmail(t);
          }}
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
        {credentialFailCount >= 2 ? (
          <Text
            style={styles.forgotPasswordLink}
            onPress={() => router.push("/forgot-password" as import("expo-router").Href)}
          >
            Forgot password?
          </Text>
        ) : null}
        {emailNotRecognized ? (
          <View style={styles.errorSignUpBlock}>
            <Text style={styles.errorSignUpMessage}>Email not recognized. New to NWC?</Text>
            <Text
              style={styles.errorSignUpCta}
              onPress={() => router.push(signupRouteForPlan(plan))}
            >
              Sign Up!
            </Text>
          </View>
        ) : null}
        {emailNotVerified ? (
          <View style={styles.verifyBlock}>
            <Text style={styles.verifyText}>
              This email isn&apos;t verified yet. Check your inbox for a 6-digit code from Northwest Community.
            </Text>
            <Pressable
              style={({ pressed }) => [styles.resendBtn, pressed && { opacity: 0.85 }]}
              disabled={resendBusy || !email.trim()}
              onPress={async () => {
                setResendMessage(null);
                setResendBusy(true);
                try {
                  const url = `${(API_BASE ?? "").replace(/\/$/, "")}/api/auth/resend-verification`;
                  const res = await fetch(url, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      Accept: "application/json",
                      ...(API_BASE.includes("inwcommunity.com")
                        ? {
                            Origin: "https://www.inwcommunity.com",
                            Referer: "https://www.inwcommunity.com/",
                          }
                        : {}),
                    },
                    body: JSON.stringify({ email: email.trim() }),
                  });
                  const data = (await res.json().catch(() => ({}))) as { message?: string };
                  setResendMessage(
                    typeof data.message === "string"
                      ? data.message
                      : "If that email is registered, we sent a code."
                  );
                } catch {
                  setResendMessage("Could not send. Try again in a minute.");
                } finally {
                  setResendBusy(false);
                }
              }}
            >
              <Text style={styles.resendBtnText}>{resendBusy ? "Sending…" : "Resend verification code"}</Text>
            </Pressable>
            {resendMessage ? <Text style={styles.resendNote}>{resendMessage}</Text> : null}
          </View>
        ) : null}
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
  verifiedBanner: {
    marginBottom: 16,
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#dcfce7",
    borderWidth: 1,
    borderColor: "#166534",
  },
  verifiedBannerText: {
    color: "#14532d",
    fontSize: 14,
    fontWeight: "600",
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
    marginBottom: 8,
    color: "#000",
    backgroundColor: "#fff",
  },
  forgotPasswordLink: {
    alignSelf: "flex-end",
    fontSize: 14,
    fontWeight: "600",
    color: "#fff",
    textDecorationLine: "underline",
    marginBottom: 12,
  },
  error: {
    color: "#fff",
    marginBottom: 12,
    fontSize: 14,
  },
  errorSignUpBlock: {
    marginBottom: 12,
  },
  errorSignUpMessage: {
    color: "#fff",
    fontSize: 14,
    marginBottom: 6,
  },
  errorSignUpCta: {
    fontSize: 14,
    fontWeight: "800",
    color: "#fff",
  },
  verifyBlock: {
    marginBottom: 12,
  },
  verifyText: {
    color: "#fff",
    fontSize: 14,
    marginBottom: 10,
    lineHeight: 20,
  },
  resendBtn: {
    alignSelf: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#fff",
  },
  resendBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  resendNote: {
    color: "rgba(255,255,255,0.95)",
    fontSize: 13,
    marginTop: 8,
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
