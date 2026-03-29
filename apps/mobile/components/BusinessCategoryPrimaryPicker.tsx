import { useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  Modal,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { theme } from "@/lib/theme";
import type { CategoryPreset } from "@/lib/business-category-suggest";
import {
  filterBusinessCategoryPresets,
  recommendedBusinessCategoryPresets,
} from "@/lib/business-category-suggest";

interface Props {
  value: string;
  onChange: (primary: string) => void;
  shortDescription: string;
  fullDescription: string;
  presets: CategoryPreset[];
  required?: boolean;
}

export function BusinessCategoryPrimaryPicker({
  value,
  onChange,
  shortDescription,
  fullDescription,
  presets,
  required = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [customMode, setCustomMode] = useState(false);
  const [customText, setCustomText] = useState("");

  const filtered = useMemo(
    () => filterBusinessCategoryPresets(presets, search),
    [presets, search]
  );

  const recommended = useMemo(
    () =>
      recommendedBusinessCategoryPresets(
        presets,
        shortDescription,
        fullDescription,
        search,
        8
      ),
    [presets, shortDescription, fullDescription, search]
  );

  const recommendedLabels = useMemo(
    () => new Set(recommended.map((r) => r.label)),
    [recommended]
  );

  function pickPreset(p: CategoryPreset) {
    onChange(p.label);
    setOpen(false);
    setSearch("");
    setCustomMode(false);
    setCustomText("");
  }

  function applyCustom() {
    const t = customText.trim();
    if (!t) return;
    onChange(t);
    setOpen(false);
    setSearch("");
    setCustomMode(false);
    setCustomText("");
  }

  return (
    <View>
      <Pressable
        style={[
          styles.trigger,
          required && !value.trim() ? styles.triggerInvalid : null,
        ]}
        onPress={() => {
          setOpen(true);
          setCustomMode(false);
          setSearch("");
        }}
      >
        <Text style={[styles.triggerText, !value.trim() && styles.triggerPlaceholder]}>
          {value.trim() || "Choose primary category"}
        </Text>
        <Text style={styles.chev}>{open ? "▲" : "▼"}</Text>
      </Pressable>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalRoot}
        >
          <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
          <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Primary category</Text>
          <TextInput
            style={styles.search}
            value={search}
            onChangeText={setSearch}
            placeholder="Search categories…"
            placeholderTextColor={theme.colors.placeholder}
            autoCorrect={false}
            autoCapitalize="none"
          />
          <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
            {!customMode && recommended.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Suggested for your description</Text>
                {recommended.map((p) => (
                  <Pressable
                    key={p.label}
                    style={styles.row}
                    onPress={() => pickPreset(p)}
                  >
                    <Text style={styles.rowText}>{p.label}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {!customMode ? (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>
                  {search.trim() ? "Matching categories" : "All categories"}
                </Text>
                {filtered.map((p) => (
                  <Pressable
                    key={p.label}
                    style={styles.row}
                    onPress={() => pickPreset(p)}
                  >
                    <Text
                      style={[
                        styles.rowText,
                        recommendedLabels.has(p.label) ? styles.rowMuted : null,
                      ]}
                    >
                      {p.label}
                    </Text>
                  </Pressable>
                ))}
                {filtered.length === 0 ? (
                  <Text style={styles.empty}>
                    No matches. Try another search or use a custom category.
                  </Text>
                ) : null}
              </View>
            ) : null}
            {!customMode ? (
              <Pressable
                style={styles.customLink}
                onPress={() => {
                  setCustomMode(true);
                  setCustomText(
                    value.trim() && !presets.some((x) => x.label === value.trim())
                      ? value.trim()
                      : ""
                  );
                }}
              >
                <Text style={styles.customLinkText}>+ Custom category</Text>
              </Pressable>
            ) : (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Custom primary category</Text>
                <TextInput
                  style={styles.search}
                  value={customText}
                  onChangeText={setCustomText}
                  placeholder="e.g. Specialty retail"
                  placeholderTextColor={theme.colors.placeholder}
                  onSubmitEditing={applyCustom}
                />
                <View style={styles.customActions}>
                  <Pressable style={styles.primaryBtn} onPress={applyCustom}>
                    <Text style={styles.primaryBtnText}>Use custom</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      setCustomMode(false);
                      setCustomText("");
                    }}
                  >
                    <Text style={styles.backLink}>Back to list</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </ScrollView>
          <Pressable style={styles.closeBtn} onPress={() => setOpen(false)}>
            <Text style={styles.closeBtnText}>Close</Text>
          </Pressable>
        </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 6,
    padding: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#fff",
  },
  triggerInvalid: { borderColor: "#f87171" },
  triggerText: { fontSize: 16, color: theme.colors.text, flex: 1 },
  triggerPlaceholder: { color: theme.colors.placeholder },
  chev: { color: "#9ca3af", fontSize: 12 },
  modalRoot: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  sheet: {
    width: "100%",
    maxHeight: "85%",
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    paddingBottom: 28,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 10,
    color: theme.colors.heading,
  },
  search: {
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 6,
    padding: 10,
    fontSize: 16,
    marginBottom: 10,
    color: theme.colors.text,
  },
  scroll: { maxHeight: 400 },
  section: { marginBottom: 16 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#6b7280",
    textTransform: "uppercase",
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  row: {
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
  },
  rowText: { fontSize: 16, color: theme.colors.text },
  rowMuted: { color: "#4b5563" },
  empty: { fontSize: 14, color: "#6b7280", paddingVertical: 8 },
  customLink: { paddingVertical: 12 },
  customLinkText: { fontSize: 16, color: theme.colors.primary, fontWeight: "600" },
  customActions: { gap: 12, marginTop: 8 },
  primaryBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  primaryBtnText: { color: theme.colors.buttonText, fontWeight: "600", fontSize: 16 },
  backLink: { fontSize: 15, color: "#6b7280" },
  closeBtn: { marginTop: 8, alignItems: "center", padding: 8 },
  closeBtnText: { fontSize: 16, color: theme.colors.primary, fontWeight: "600" },
});
