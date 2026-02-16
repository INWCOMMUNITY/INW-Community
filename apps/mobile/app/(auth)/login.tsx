import { useState } from "react";
import {
  StyleSheet,
  Pressable,
  Text,
  View,
  ScrollView,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import type { SubscriptionPlan } from "@/lib/auth";

const PLAN_OPTIONS: {
  plan: SubscriptionPlan;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  signUpLabel: string;
}[] = [
  { plan: "subscribe", label: "Login as Resident", icon: "person", signUpLabel: "Sign up as Resident" },
  { plan: "sponsor", label: "Login as Business", icon: "business", signUpLabel: "Sign up as Business" },
  { plan: "seller", label: "Login as Seller", icon: "briefcase", signUpLabel: "Sign up as Seller" },
];

export default function LoginScreen() {
  const router = useRouter();
  const [isSignUp, setIsSignUp] = useState(false);

  const handleChoose = (plan: SubscriptionPlan) => {
    if (isSignUp && (plan === "sponsor" || plan === "seller")) {
      router.push(
        plan === "sponsor"
          ? "/signup-business"
          : "/signup-seller"
      );
      return;
    }
    if (isSignUp && plan === "subscribe") {
      router.push("/signup-resident");
      return;
    }
    router.push({
      pathname: "/signin",
      params: { plan, isSignUp: isSignUp ? "1" : "0" },
    });
  };

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
    >
      <View style={styles.header}>
        <Image
          source={require("@/assets/images/nwc-community-logo.png")}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel="Northwest Community logo"
        />
        <Text style={styles.title}>Northwest Community</Text>
        <Text style={styles.welcomeText}>
          Welcome Residents of Eastern Washington & North Idaho
        </Text>
        <Text style={styles.subtitle}>
          {isSignUp ? "Create an account" : "Sign in to continue"}
        </Text>
      </View>

      <View style={styles.toggle}>
        <Pressable
          style={[styles.toggleBtn, !isSignUp && styles.toggleBtnActive]}
          onPress={() => setIsSignUp(false)}
        >
          <Text style={[styles.toggleText, !isSignUp && styles.toggleTextActive]}>Login</Text>
        </Pressable>
        <Pressable
          style={[styles.toggleBtn, isSignUp && styles.toggleBtnActive]}
          onPress={() => setIsSignUp(true)}
        >
          <Text style={[styles.toggleText, isSignUp && styles.toggleTextActive]}>Sign up</Text>
        </Pressable>
      </View>

      <View style={styles.cards}>
        {PLAN_OPTIONS.map((opt) => (
          <Pressable
            key={opt.plan}
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            onPress={() => handleChoose(opt.plan)}
          >
            <View style={styles.cardIcon}>
              <Ionicons name={opt.icon} size={40} color={theme.colors.primary} />
            </View>
            <Text style={styles.cardLabel}>
              {isSignUp ? opt.signUpLabel : opt.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {isSignUp && (
        <Text style={styles.signUpHint}>
          Choose your account type to get started.
        </Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: "#ffffff" },
  container: {
    padding: 24,
    paddingTop: 64,
    alignItems: "center",
  },
  header: {
    marginBottom: 28,
    alignItems: "center",
  },
  logo: {
    width: 160,
    height: 160,
    marginBottom: 14,
  },
  welcomeText: {
    fontSize: 14,
    color: theme.colors.text,
    textAlign: "center",
    marginTop: 4,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: theme.colors.heading,
    fontFamily: theme.fonts.heading,
  },
  subtitle: {
    marginTop: 12,
    fontSize: 16,
    color: theme.colors.text,
  },
  toggle: {
    flexDirection: "row",
    marginBottom: 32,
    backgroundColor: theme.colors.cream,
    borderRadius: 8,
    padding: 4,
  },
  toggleBtn: {
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 6,
  },
  toggleBtnActive: {
    backgroundColor: theme.colors.primary,
  },
  toggleText: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.text,
  },
  toggleTextActive: {
    color: "#ffffff",
  },
  cards: {
    width: "100%",
    maxWidth: 320,
    gap: 16,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 12,
    padding: 20,
  },
  cardPressed: { opacity: 0.85 },
  cardIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.colors.cream,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 16,
  },
  cardLabel: {
    fontSize: 18,
    fontWeight: "600",
    color: theme.colors.heading,
    fontFamily: theme.fonts.heading,
  },
  signUpHint: {
    marginTop: 12,
    fontSize: 13,
    color: theme.colors.text,
    textAlign: "center",
    paddingHorizontal: 24,
  },
});
