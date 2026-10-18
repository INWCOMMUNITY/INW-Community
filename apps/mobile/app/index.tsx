import { useEffect } from "react";
import { View, StyleSheet, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { theme } from "@/lib/theme";
import { useAuth } from "@/contexts/AuthContext";
import { apiGet } from "@/lib/api";

export default function IndexScreen() {
  const router = useRouter();
  const { member, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!member) {
      router.replace("/(tabs)/home");
      return;
    }

    const intent = member.signupIntent;
    const hasSub = (member.subscriptions ?? []).length > 0;

    if (intent === "business" && !hasSub) {
      router.replace("/(auth)/signup-business" as never);
      return;
    }

    if (intent !== "seller") {
      router.replace("/(tabs)/home");
      return;
    }

    let cancelled = false;
    apiGet<{ onboardingStep?: string | null }>("/api/signup/seller/status")
      .then((status) => {
        if (cancelled) return;
        const step = status.onboardingStep;
        if (step === "business" || step === "contact" || step === "subscribe" || step === "shipping" || step === "policies" || step === "payouts") {
          router.replace(`/(auth)/signup-seller?start=${step}` as never);
          return;
        }
        router.replace("/(tabs)/home");
      })
      .catch(() => {
        if (cancelled) return;
        router.replace((hasSub ? "/(tabs)/home" : "/(auth)/signup-seller") as never);
      });
    return () => {
      cancelled = true;
    };
  }, [member, loading, router]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={theme.colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
  },
});
