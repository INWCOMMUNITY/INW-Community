import type { ReactNode } from "react";
import { View, StyleSheet, type ViewStyle } from "react-native";
import { theme } from "@/lib/theme";

export function AppCard({
  children,
  style,
}: {
  children: ReactNode;
  style?: ViewStyle;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.card,
    overflow: "hidden",
    ...theme.shadows.card,
  },
});
