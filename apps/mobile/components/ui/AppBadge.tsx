import { View, Text, StyleSheet } from "react-native";
import { theme } from "@/lib/theme";

export function AppBadge({
  label,
  exclamation,
}: {
  label?: string | number;
  exclamation?: boolean;
}) {
  const text = exclamation ? "!" : label == null ? "" : Number(label) > 99 ? "99+" : String(label);
  if (!text) return null;

  return (
    <View style={styles.badge}>
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: theme.radii.badge,
    paddingHorizontal: 6,
    backgroundColor: theme.colors.cream,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    fontSize: 12,
    fontWeight: "800",
    color: theme.colors.primary,
  },
});
