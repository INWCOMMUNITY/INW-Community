import type { ReactNode } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";

export function AppHeader({
  title,
  onBack,
  right,
  showBack = true,
  backgroundColor = theme.colors.primary,
}: {
  title: string;
  onBack?: () => void;
  right?: ReactNode;
  showBack?: boolean;
  backgroundColor?: string;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor }]}>
      {showBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack}
          style={({ pressed }) => [styles.sideBtn, pressed && styles.pressed]}
          hitSlop={12}
        >
          <Ionicons name="arrow-back" size={24} color={theme.colors.onPrimary} />
        </Pressable>
      ) : (
        <View style={styles.sideSlot} />
      )}
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.right}>{right ?? <View style={styles.sideSlot} />}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.md,
    backgroundColor: theme.colors.primary,
    borderBottomWidth: 2,
    borderBottomColor: theme.colors.cream,
  },
  sideBtn: {
    padding: theme.spacing.sm,
    marginLeft: -theme.spacing.sm,
    minWidth: 40,
  },
  sideSlot: {
    minWidth: 40,
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: "700",
    color: theme.colors.onPrimary,
    fontFamily: theme.fonts.heading,
    textAlign: "center",
  },
  right: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    minWidth: 40,
    gap: 4,
  },
  pressed: {
    opacity: 0.7,
  },
});
