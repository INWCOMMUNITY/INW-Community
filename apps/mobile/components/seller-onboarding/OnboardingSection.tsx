import type { ReactNode } from "react";
import { View, Text, StyleSheet } from "react-native";
import { theme } from "@/lib/theme";

export function OnboardingSection({
  title,
  description,
  children,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.card}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {description ? <Text style={styles.description}>{description}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: theme.colors.primary,
    padding: 16,
    marginBottom: 16,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    color: theme.colors.heading,
    fontFamily: theme.fonts.heading,
    marginBottom: 4,
  },
  description: {
    fontSize: 13,
    color: "#6b7280",
    lineHeight: 18,
    marginBottom: 12,
  },
});
