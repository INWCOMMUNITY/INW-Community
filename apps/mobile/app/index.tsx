import { useEffect } from "react";
import { View, StyleSheet, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { theme } from "@/lib/theme";
import { useAuth } from "@/contexts/AuthContext";

export default function IndexScreen() {
  const router = useRouter();
  const { member, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!member) {
      router.replace("/(auth)/login");
      return;
    }

    const intent = member.signupIntent;
    const hasSub = (member.subscriptions ?? []).length > 0;

    if ((intent === "business" || intent === "seller") && !hasSub) {
      const route =
        intent === "business"
          ? "/(auth)/signup-business"
          : "/(auth)/signup-seller";
      router.replace(route as never);
      return;
    }

    router.replace("/(tabs)/home");
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
