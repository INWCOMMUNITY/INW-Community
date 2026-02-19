import { useCallback, useEffect } from "react";
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { getToken } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { SubscriptionCheckoutWithFallback } from "@/components/SubscriptionCheckoutWithFallback";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

export default function SubscribeScreen() {
  const router = useRouter();
  const { refreshMember, member, loading: authLoading } = useAuth();

  const handleSuccess = useCallback(() => {
    router.replace("/(tabs)/my-community");
  }, [router]);

  const handleError = useCallback((message: string) => {
    if (__DEV__) console.warn("[Subscribe]", message);
  }, []);

  // Redirect to signin if not logged in
  useEffect(() => {
    let cancelled = false;
    getToken().then((token) => {
      if (!cancelled && !token) {
        router.replace({
          pathname: "/signin",
          params: { plan: "subscribe", returnTo: "/subscribe" },
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (authLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (!member) {
    return null; // Will redirect in useEffect
  }

  // Already a subscriber - redirect to my-community
  const isSubscriber = member.isSubscriber || (member.subscriptions?.length ?? 0) > 0;
  if (isSubscriber) {
    router.replace("/(tabs)/my-community");
    return null;
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { backgroundColor: theme.colors.primary }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Subscribe to NWC</Text>
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.logoWrap}>
          <Image
            source={require("@/assets/images/nwc-community-logo.png")}
            style={styles.logo}
            resizeMode="contain"
            accessibilityLabel="Northwest Community"
          />
        </View>
        <Text style={styles.intro}>
          Support Northwest Community with a subscription. Subscribers get 2x
          points, access to coupons, exclusive events, and more.
        </Text>
        <View style={styles.checkoutSection}>
          <SubscriptionCheckoutWithFallback
            planId="subscribe"
            onSuccess={handleSuccess}
            onError={handleError}
            refreshMember={refreshMember}
          />
        </View>
        <Pressable
          style={styles.webLink}
          onPress={() =>
            router.push(
              ("/web?url=" +
                encodeURIComponent(`${siteBase}/support-nwc`) +
                "&title=View plans") as import("expo-router").Href
            )
          }
        >
          <Text style={styles.webLinkText}>
            View all plans (monthly & yearly) on website
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 12,
    paddingTop: 48,
    gap: 12,
  },
  backBtn: {
    padding: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: "600",
    color: "#fff",
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  logoWrap: {
    alignItems: "center",
    marginBottom: 20,
  },
  logo: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  intro: {
    fontSize: 18,
    color: theme.colors.text,
    lineHeight: 28,
    marginBottom: 24,
  },
  checkoutSection: {
    marginBottom: 24,
  },
  webLink: {
    paddingVertical: 12,
    alignItems: "center",
  },
  webLinkText: {
    fontSize: 14,
    color: theme.colors.primary,
    textDecorationLine: "underline",
  },
});
