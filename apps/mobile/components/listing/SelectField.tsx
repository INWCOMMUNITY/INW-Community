import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Modal,
  ScrollView,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";

type Option = { value: string; label: string };

type SelectFieldProps = {
  label: string;
  value: string;
  options: readonly Option[];
  onChange: (value: string) => void;
  placeholder?: string;
};

export function SelectField({
  label,
  value,
  options,
  onChange,
  placeholder = "Select…",
}: SelectFieldProps) {
  const [open, setOpen] = useState(false);
  const { height: windowHeight } = useWindowDimensions();
  const selectedLabel = options.find((o) => o.value === value)?.label;

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        style={({ pressed }) => [styles.trigger, pressed && styles.triggerPressed]}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <Text style={[styles.triggerText, !selectedLabel && styles.placeholder]} numberOfLines={2}>
          {selectedLabel ?? placeholder}
        </Text>
        <Ionicons name="chevron-down" size={20} color="#6b7280" />
      </Pressable>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.dismissLayer} onPress={() => setOpen(false)} />
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{label}</Text>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              style={{ maxHeight: Math.min(windowHeight * 0.62, 420) }}
            >
              {options.map((opt) => {
                const selected = opt.value === value;
                return (
                  <Pressable
                    key={opt.value}
                    style={({ pressed }) => [styles.row, pressed && { opacity: 0.88 }]}
                    onPress={() => {
                      onChange(opt.value);
                      setOpen(false);
                    }}
                  >
                    <Text style={[styles.rowText, selected && styles.rowTextActive]}>{opt.label}</Text>
                    {selected ? (
                      <Ionicons name="checkmark-circle" size={22} color={theme.colors.primary} />
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 8 },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#000",
    marginBottom: 8,
  },
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: "#fff",
    gap: 8,
  },
  triggerPressed: { opacity: 0.9 },
  triggerText: {
    flex: 1,
    fontSize: 16,
    color: theme.colors.text,
  },
  placeholder: { color: "#888" },
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  dismissLayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 16,
    paddingBottom: 24,
    paddingHorizontal: 16,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: theme.colors.heading,
    marginBottom: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#eee",
    gap: 12,
  },
  rowText: {
    flex: 1,
    fontSize: 16,
    color: theme.colors.text,
  },
  rowTextActive: {
    color: theme.colors.primary,
    fontWeight: "600",
  },
});
