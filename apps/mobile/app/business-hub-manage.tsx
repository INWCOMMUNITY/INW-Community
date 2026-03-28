import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";

/** Three in-app destinations: posts list, rewards management, coupons management. */
const ACTIONS: {
  label: string;
  href: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  {
    label: "My Business Posts",
    href: "/business-hub-my-posts",
    icon: "megaphone-outline",
  },
  {
    label: "My Business Rewards",
    href: "/business-hub-offered-rewards",
    icon: "ribbon-outline",
  },
  {
    label: "My Business Coupons",
    href: "/business-hub-offered-coupons",
    icon: "pricetags-outline",
  },
  {
    label: "My Business Events",
    href: "/business-hub-my-events",
    icon: "calendar-outline",
  },
];

export default function BusinessHubManageScreen() {
  const router = useRouter();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Pressable style={styles.backRow} onPress={() => router.back()}>
        <Ionicons name="arrow-back" size={24} color={theme.colors.primary} />
        <Text style={styles.backText}>Back</Text>
      </Pressable>
      <Text style={styles.title}>Manage NWC Business</Text>
      <Text style={styles.subtitle}>
        Review and manage posts, rewards, coupons, and business calendar events.
      </Text>
      <View style={styles.buttonStack}>
        {ACTIONS.map((action) => (
          <Pressable
            key={action.href}
            style={({ pressed }) => [styles.greenButton, pressed && styles.greenButtonPressed]}
            onPress={() => (router.push as (h: string) => void)(action.href)}
          >
            <Ionicons name={action.icon} size={26} color="#fff" />
            <Text style={styles.greenButtonText}>{action.label}</Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 16, paddingBottom: 40 },
  backRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 48,
    marginBottom: 8,
    gap: 8,
  },
  backText: { fontSize: 16, color: theme.colors.primary, fontWeight: "600" },
  title: { fontSize: 22, fontWeight: "700", color: theme.colors.heading, marginBottom: 6 },
  subtitle: { fontSize: 14, color: "#666", marginBottom: 20 },
  buttonStack: { gap: 12 },
  greenButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    width: "100%",
    backgroundColor: theme.colors.primary,
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
  },
  greenButtonPressed: { opacity: 0.88 },
  greenButtonText: {
    fontSize: 17,
    fontWeight: "700",
    color: "#fff",
  },
});
