import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";

type Option = { value: string; label: string };

type RadioOptionListProps = {
  options: readonly Option[];
  value: string;
  onChange: (value: string) => void;
};

export function RadioOptionList({ options, value, onChange }: RadioOptionListProps) {
  return (
    <View style={styles.list}>
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <Pressable
            key={opt.value}
            style={({ pressed }) => [
              styles.row,
              selected && styles.rowActive,
              pressed && styles.rowPressed,
            ]}
            onPress={() => onChange(opt.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
          >
            <Text style={[styles.label, selected && styles.labelActive]}>{opt.label}</Text>
            {selected ? (
              <Ionicons name="checkmark-circle" size={22} color={theme.colors.primary} />
            ) : (
              <View style={styles.radioEmpty} />
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 8, marginBottom: 4 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "#fff",
  },
  rowActive: {
    borderColor: theme.colors.primary,
    backgroundColor: "#f0f7ff",
  },
  rowPressed: { opacity: 0.9 },
  label: {
    flex: 1,
    fontSize: 15,
    color: theme.colors.text,
    paddingRight: 8,
  },
  labelActive: {
    color: theme.colors.primary,
    fontWeight: "600",
  },
  radioEmpty: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: "#d1d5db",
  },
});
