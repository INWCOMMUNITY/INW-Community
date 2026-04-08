import { useState, useRef, Fragment } from "react";
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  TextInput,
  Alert,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { API_BASE, setToken } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useProfileView } from "@/contexts/ProfileViewContext";
import { BadgeEarnedPopup } from "@/components/BadgeEarnedPopup";

/** Profile tab (member profile / hubs switcher). */
const DEFAULT_POST_VERIFY_ROUTE = "/(tabs)/my-community";

interface EarnedBadge {
  slug: string;
  name: string;
  description?: string;
}

function fetchHeadersJson(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(API_BASE.includes("inwcommunity.com")
      ? { Origin: "https://www.inwcommunity.com", Referer: "https://www.inwcommunity.com/" }
      : {}),
  };
}

function paramFirst(v: string | string[] | undefined): string {
  if (v == null) return "";
  return typeof v === "string" ? v : v[0] ?? "";
}

export default function VerifyEmailPendingScreen() {
  const router = useRouter();
  const { refreshMember } = useAuth();
  const { setProfileView } = useProfileView();
  const params = useLocalSearchParams<{ email?: string; plan?: string; returnTo?: string }>();
  const email = paramFirst(params.email);
  const planParam = paramFirst(params.plan) || "subscribe";
  const returnToParam = paramFirst(params.returnTo);
  const returnTo =
    returnToParam.startsWith("/") && !returnToParam.includes("..")
      ? returnToParam
      : DEFAULT_POST_VERIFY_ROUTE;

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [earnedBadges, setEarnedBadges] = useState<EarnedBadge[]>([]);
  const [badgePopupIndex, setBadgePopupIndex] = useState(-1);
  const pendingNavRef = useRef<string | null>(null);

  async function verify() {
    setError(null);
    setResendMessage(null);
    if (!email?.trim()) {
      setError("Email is missing. Go back and sign up again.");
      return;
    }
    const digits = code.replace(/\D/g, "");
    if (digits.length !== 6) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    setBusy(true);
    try {
      const url = `${API_BASE.replace(/\/$/, "")}/api/auth/verify-email-code`;
      const res = await fetch(url, {
        method: "POST",
        headers: fetchHeadersJson(),
        body: JSON.stringify({
          email: email.trim(),
          code: digits,
          issueMobileSession: true,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
        token?: string;
        signInRequired?: boolean;
        alreadyVerified?: boolean;
        message?: string;
        code?: string;
        earnedBadges?: EarnedBadge[];
      };
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Could not verify. Try again.");
        return;
      }
      if (data.ok === false) {
        if (data.signInRequired) {
          Alert.alert(
            data.code === "ACCOUNT_SUSPENDED" ? "Account suspended" : "Sign in required",
            typeof data.message === "string"
              ? data.message
              : "Sign in with your password to continue.",
            [
              {
                text: "OK",
                onPress: () =>
                  router.replace({
                    pathname: "/signin",
                    params: { plan: planParam, emailVerified: "1", returnTo },
                  } as never),
              },
            ]
          );
        } else {
          setError(
            typeof data.error === "string"
              ? data.error
              : "Could not finish signing you in. Tap Verify again with the same code.",
          );
        }
        return;
      }
      if (typeof data.token === "string" && data.token.length > 0) {
        await setToken(data.token);
        await refreshMember().catch(() => {});
        setProfileView("profile");
        const badges =
          Array.isArray(data.earnedBadges) && data.earnedBadges.length > 0
            ? data.earnedBadges.filter((b) => b?.slug && b?.name)
            : [];
        if (badges.length > 0) {
          pendingNavRef.current = returnTo;
          setEarnedBadges(badges);
          setBadgePopupIndex(0);
        } else {
          router.replace(returnTo as never);
        }
        return;
      }
      if (data.signInRequired) {
        Alert.alert(
          data.alreadyVerified ? "Already verified" : "Email verified",
          typeof data.message === "string" ? data.message : "Sign in with your password to continue.",
          [
            {
              text: "OK",
              onPress: () =>
                router.replace({
                  pathname: "/signin",
                  params: { plan: planParam, emailVerified: "1", returnTo },
                } as never),
            },
          ]
        );
        return;
      }
      Alert.alert(
        "Could not finish signing in",
        "Tap Verify again, or sign in with your password. If your email was already verified, use Sign in.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Sign in",
            onPress: () =>
              router.replace({
                pathname: "/signin",
                params: { plan: planParam, emailVerified: "1", returnTo },
              } as never),
          },
        ]
      );
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (!email?.trim()) return;
    setResendMessage(null);
    setError(null);
    setResendBusy(true);
    try {
      const url = `${API_BASE.replace(/\/$/, "")}/api/auth/resend-verification`;
      const res = await fetch(url, {
        method: "POST",
        headers: fetchHeadersJson(),
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        error?: string;
      };
      const text =
        typeof data.error === "string" && data.error.trim()
          ? data.error
          : typeof data.message === "string" && data.message.trim()
            ? data.message
            : !res.ok
              ? "Could not send. Try again in a minute."
              : "If that email is registered, we sent a code.";
      setResendMessage(text);
    } catch {
      setResendMessage("Could not send. Try again in a minute.");
    } finally {
      setResendBusy(false);
    }
  }

  return (
    <Fragment>
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <Pressable
        style={styles.back}
        onPress={() => {
          if (router.canGoBack()) router.back();
          else router.replace("/login");
        }}
      >
        <Ionicons name="arrow-back" size={24} color={theme.colors.primary} />
        <Text style={styles.backText}>Back</Text>
      </Pressable>

      <Text style={styles.title}>Verify your email</Text>
      <Text style={styles.body}>
        Your app account isn&apos;t active until you verify, and signup badges are awarded only after verification.
        We sent a 6-digit code to <Text style={styles.em}>{email?.trim() || "your email"}</Text>. Enter it below to
        finish logging in—you won&apos;t need your password again on this device. Then we&apos;ll open your Profile
        tab.
      </Text>
      <Text style={styles.hint}>
        To get back to this screen later, sign in with the same email and password—you&apos;ll return here while your
        email is still pending.
      </Text>

      <TextInput
        style={styles.codeInput}
        placeholder="000000"
        placeholderTextColor={theme.colors.placeholder}
        value={code}
        onChangeText={setCode}
        keyboardType="number-pad"
        inputMode="numeric"
        maxLength={14}
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.9 }]}
        onPress={verify}
        disabled={busy}
      >
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryBtnText}>Verify &amp; continue</Text>
        )}
      </Pressable>

      <Pressable
        style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.9 }]}
        onPress={resend}
        disabled={resendBusy || !email?.trim()}
      >
        {resendBusy ? (
          <ActivityIndicator color={theme.colors.primary} />
        ) : (
          <Text style={styles.secondaryBtnText}>Resend code</Text>
        )}
      </Pressable>

      {resendMessage ? <Text style={styles.message}>{resendMessage}</Text> : null}
    </ScrollView>

    {badgePopupIndex >= 0 && badgePopupIndex < earnedBadges.length ? (
      <BadgeEarnedPopup
        visible
        onClose={() => {
          const next = badgePopupIndex + 1;
          if (next < earnedBadges.length) {
            setBadgePopupIndex(next);
          } else {
            setBadgePopupIndex(-1);
            setEarnedBadges([]);
            const dest = pendingNavRef.current ?? DEFAULT_POST_VERIFY_ROUTE;
            pendingNavRef.current = null;
            router.replace(dest as never);
          }
        }}
        badgeName={earnedBadges[badgePopupIndex].name}
        badgeSlug={earnedBadges[badgePopupIndex].slug}
        badgeDescription={earnedBadges[badgePopupIndex].description}
      />
    ) : null}
    </Fragment>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: 24,
    paddingTop: 48,
    backgroundColor: "#fff",
    flexGrow: 1,
  },
  back: { flexDirection: "row", alignItems: "center", marginBottom: 24 },
  backText: { marginLeft: 8, fontSize: 16, color: theme.colors.primary, fontWeight: "600" },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: theme.colors.heading,
    marginBottom: 12,
  },
  body: { fontSize: 16, color: "#444", lineHeight: 24, marginBottom: 12 },
  hint: { fontSize: 14, color: "#666", lineHeight: 21, marginBottom: 16 },
  em: { fontWeight: "600", color: theme.colors.heading },
  codeInput: {
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 22,
    letterSpacing: 4,
    fontVariant: ["tabular-nums"],
    marginBottom: 12,
    color: theme.colors.heading,
  },
  error: { color: "#b91c1c", fontSize: 14, marginBottom: 8 },
  primaryBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 12,
  },
  primaryBtnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  secondaryBtn: {
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },
  secondaryBtnText: { color: theme.colors.primary, fontSize: 16, fontWeight: "600" },
  message: { marginTop: 16, fontSize: 14, color: "#555", textAlign: "center" },
});
