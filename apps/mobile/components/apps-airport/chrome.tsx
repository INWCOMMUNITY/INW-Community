import { Pressable, StyleSheet, Text, View } from "react-native";
import { theme } from "@/lib/theme";

export function HubButton({
  label,
  onPress,
  disabled,
  tone = "primary",
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: "primary" | "honey" | "earth";
}) {
  const bg =
    tone === "honey" ? "#c99d5f" : tone === "earth" ? theme.colors.earth : theme.colors.primary;
  return (
    <Pressable
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: bg },
        disabled && styles.disabled,
        pressed && !disabled && { opacity: 0.85 },
      ]}
      disabled={disabled}
      onPress={onPress}
    >
      <Text style={styles.btnText}>{label}</Text>
    </Pressable>
  );
}

export function StatusBadge({ label, tone }: { label: string; tone: "ok" | "warn" | "muted" }) {
  const bg = tone === "ok" ? "#e8f5e9" : tone === "warn" ? "#fff8e1" : "#f5f5f5";
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
}

export const airportStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 20, paddingBottom: 48 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  title: { fontSize: 22, fontWeight: "700", color: theme.colors.heading },
  subtitle: { fontSize: 14, color: "#666", marginTop: 6, marginBottom: 16, lineHeight: 20 },
  error: { color: "#b91c1c", marginBottom: 10 },
  ok: { color: "#065f46", backgroundColor: "#ecfdf5", padding: 10, borderRadius: 8, marginBottom: 10 },
  card: {
    borderWidth: 4,
    borderColor: theme.colors.primary,
    borderRadius: 10,
    padding: 16,
    marginBottom: 16,
    backgroundColor: "#fff",
  },
  cardTitle: { fontSize: 20, fontWeight: "700", color: theme.colors.heading },
  cardBody: { fontSize: 14, color: "#525252", marginTop: 8, lineHeight: 20 },
  shopLine: { fontSize: 14, color: "#262626", marginTop: 10 },
  meta: { fontSize: 13, color: "#525252", marginTop: 4 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 },
  actions: { gap: 10, marginTop: 14 },
  hint: { fontSize: 14, color: "#666", lineHeight: 20, marginBottom: 12 },
  label: { fontSize: 14, fontWeight: "600", color: "#111", marginBottom: 6, marginTop: 8 },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: "#111",
  },
  listCard: {
    borderWidth: 1,
    borderColor: "#e5e5e5",
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  listTitle: { fontSize: 16, fontWeight: "600", color: "#111", flex: 1 },
  meta: { fontSize: 13, color: "#525252", marginTop: 4 },
  issue: { fontSize: 13, color: "#92400e", marginTop: 6 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  chip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: "#ccc" },
  chipOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipText: { fontSize: 13, color: "#333" },
  chipTextOn: { color: "#fff", fontWeight: "600" },
});

const styles = StyleSheet.create({
  btn: { borderRadius: 8, paddingVertical: 12, paddingHorizontal: 16, alignItems: "center" },
  btnText: { color: "#fff", fontSize: 15, fontWeight: "700", textAlign: "center" },
  disabled: { opacity: 0.45 },
  badge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  badgeText: { fontSize: 12, fontWeight: "700", color: theme.colors.heading },
});
