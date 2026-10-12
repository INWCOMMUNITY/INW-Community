import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Modal,
  TextInput,
  FlatList,
  Keyboard,
  Platform,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme } from "@/lib/theme";

export type StoreCategoryOption = {
  label: string;
  subcategories: string[];
};

type CategoryPickerProps = {
  categories: StoreCategoryOption[];
  category: string;
  subcategory: string;
  onChange: (category: string, subcategory: string) => void;
  placeholderColor: string;
};

type Row =
  | { key: string; type: "category"; label: string; subtitle: string }
  | { key: string; type: "sub"; category: string; subcategory: string }
  | { key: string; type: "none"; category: string };

function matches(text: string, query: string): boolean {
  return text.toLowerCase().includes(query);
}

export function CategoryPicker({
  categories,
  category,
  subcategory,
  onChange,
  placeholderColor,
}: CategoryPickerProps) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [browseLabel, setBrowseLabel] = useState<string | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const browsed = categories.find((c) => c.label === browseLabel) ?? null;
  const q = query.trim().toLowerCase();

  useEffect(() => {
    if (!open) {
      setKeyboardHeight(0);
      return;
    }
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvent, (event) => {
      setKeyboardHeight(event.endCoordinates?.height ?? 0);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [open]);

  const rows = useMemo((): Row[] => {
    if (browsed) {
      const subs = q
        ? browsed.subcategories.filter((s) => matches(s, q))
        : browsed.subcategories;
      return [
        ...(q ? [] : [{ key: `none-${browsed.label}`, type: "none" as const, category: browsed.label }]),
        ...subs.map((s) => ({
          key: `${browsed.label}::${s}`,
          type: "sub" as const,
          category: browsed.label,
          subcategory: s,
        })),
      ];
    }

    if (!q) {
      return categories.map((c) => ({
        key: c.label,
        type: "category" as const,
        label: c.label,
        subtitle: c.subcategories.length
          ? `${c.subcategories.length} subcategories`
          : "No subcategories",
      }));
    }

    const hits: Row[] = [];
    for (const c of categories) {
      const nameHit = matches(c.label, q);
      const subHits = c.subcategories.filter((s) => matches(s, q));
      if (nameHit) {
        hits.push({
          key: `cat-${c.label}`,
          type: "category",
          label: c.label,
          subtitle: subHits.length
            ? "Browse all subcategories"
            : c.subcategories.length
              ? "Browse subcategories"
              : "Select category",
        });
      }
      for (const s of subHits) {
        hits.push({
          key: `${c.label}::${s}`,
          type: "sub",
          category: c.label,
          subcategory: s,
        });
      }
    }
    return hits;
  }, [browsed, categories, q]);

  const openPicker = () => {
    setQuery("");
    setBrowseLabel(category && categories.some((c) => c.label === category) ? category : null);
    setOpen(true);
  };

  const closePicker = () => {
    Keyboard.dismiss();
    setOpen(false);
  };

  const select = (nextCategory: string, nextSubcategory: string) => {
    onChange(nextCategory, nextSubcategory);
    closePicker();
  };

  const drillIn = (label: string) => {
    const cat = categories.find((c) => c.label === label);
    if (!cat || cat.subcategories.length === 0) {
      select(label, "");
      return;
    }
    setQuery("");
    setBrowseLabel(label);
  };

  const sheetHeight = Math.max(
    320,
    Math.min(windowHeight * 0.88, windowHeight - keyboardHeight - insets.top - 12)
  );

  const summary = subcategory ? subcategory : category;

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Category</Text>
      <Pressable
        style={({ pressed }) => [styles.trigger, pressed && styles.triggerPressed]}
        onPress={openPicker}
        accessibilityRole="button"
        accessibilityLabel="Category"
      >
        <View style={styles.triggerCopy}>
          <Text style={[styles.triggerText, !summary && styles.placeholder]} numberOfLines={1}>
            {summary || "Choose a category"}
          </Text>
          {subcategory && category ? (
            <Text style={styles.triggerCaption} numberOfLines={1}>
              {category}
            </Text>
          ) : null}
        </View>
        <Ionicons name="chevron-down" size={20} color="#6b7280" />
      </Pressable>

      <Modal
        visible={open}
        animationType="slide"
        transparent
        onRequestClose={closePicker}
      >
        <View style={[styles.modalRoot, { paddingBottom: keyboardHeight }]}>
          <Pressable style={styles.dismissLayer} onPress={closePicker} accessibilityLabel="Close category picker" />
          <View
            style={[
              styles.sheet,
              { height: sheetHeight, paddingBottom: keyboardHeight > 0 ? 12 : Math.max(insets.bottom, 12) },
            ]}
          >
            <View style={styles.sheetHeader}>
              {browsed ? (
                <Pressable
                  style={styles.headerSide}
                  onPress={() => {
                    setQuery("");
                    setBrowseLabel(null);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="All categories"
                >
                  <Ionicons name="chevron-back" size={22} color={theme.colors.primary} />
                </Pressable>
              ) : (
                <View style={styles.headerSide} />
              )}
              <Text style={styles.sheetTitle} numberOfLines={1}>
                {browsed ? browsed.label : "Category"}
              </Text>
              <Pressable style={styles.headerSide} onPress={closePicker} accessibilityRole="button" accessibilityLabel="Close">
                <Text style={styles.closeText}>Close</Text>
              </Pressable>
            </View>

            <TextInput
              style={styles.search}
              placeholder={browsed ? "Search subcategories" : "Search categories or subcategories"}
              placeholderTextColor={placeholderColor}
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
              autoCapitalize="none"
              clearButtonMode="while-editing"
            />

            <FlatList
              data={rows}
              keyExtractor={(item) => item.key}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
              style={styles.list}
              contentContainerStyle={rows.length === 0 ? styles.emptyWrap : undefined}
              ListEmptyComponent={
                <Text style={styles.emptyText}>
                  {q ? "No matches. Try another word." : "No categories yet."}
                </Text>
              }
              renderItem={({ item }) => {
                if (item.type === "none") {
                  const selected = category === item.category && !subcategory;
                  return (
                    <Pressable
                      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                      onPress={() => select(item.category, "")}
                    >
                      <View style={styles.rowCopy}>
                        <Text style={[styles.rowText, selected && styles.rowTextActive]}>No subcategory</Text>
                        <Text style={styles.rowCaption}>Use {item.category} only</Text>
                      </View>
                      {selected ? (
                        <Ionicons name="checkmark-circle" size={22} color={theme.colors.primary} />
                      ) : null}
                    </Pressable>
                  );
                }
                if (item.type === "sub") {
                  const selected = category === item.category && subcategory === item.subcategory;
                  return (
                    <Pressable
                      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                      onPress={() => select(item.category, item.subcategory)}
                    >
                      <View style={styles.rowCopy}>
                        <Text style={[styles.rowText, selected && styles.rowTextActive]}>{item.subcategory}</Text>
                        {!browsed ? <Text style={styles.rowCaption}>{item.category}</Text> : null}
                      </View>
                      {selected ? (
                        <Ionicons name="checkmark-circle" size={22} color={theme.colors.primary} />
                      ) : null}
                    </Pressable>
                  );
                }
                return (
                  <Pressable
                    style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                    onPress={() => drillIn(item.label)}
                  >
                    <View style={styles.rowCopy}>
                      <Text
                        style={[
                          styles.rowText,
                          category === item.label && !subcategory && styles.rowTextActive,
                        ]}
                      >
                        {item.label}
                      </Text>
                      <Text style={styles.rowCaption}>{item.subtitle}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
                  </Pressable>
                );
              }}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: "600", color: "#000", marginBottom: 8 },
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
  triggerCopy: { flex: 1 },
  triggerText: { fontSize: 16, color: theme.colors.text },
  triggerCaption: { fontSize: 13, color: theme.colors.labelMuted, marginTop: 2 },
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
    paddingTop: 8,
    paddingHorizontal: 16,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    minHeight: 44,
  },
  headerSide: { width: 64, justifyContent: "center" },
  sheetTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 17,
    fontWeight: "700",
    color: theme.colors.heading,
  },
  closeText: { color: theme.colors.primary, fontSize: 16, fontWeight: "600", textAlign: "right" },
  search: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: theme.colors.text,
    marginBottom: 8,
  },
  list: { flex: 1 },
  emptyWrap: { flexGrow: 1, justifyContent: "center", padding: 24 },
  emptyText: { textAlign: "center", color: theme.colors.labelMuted, fontSize: 15 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#eee",
    gap: 12,
  },
  rowPressed: { opacity: 0.88 },
  rowCopy: { flex: 1 },
  rowText: { fontSize: 16, color: theme.colors.text },
  rowTextActive: { color: theme.colors.primary, fontWeight: "600" },
  rowCaption: { fontSize: 13, color: theme.colors.labelMuted, marginTop: 2 },
});
