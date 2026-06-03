import React, { useCallback, useState } from "react";
import { Alert, View, Text, StyleSheet, TextInput, Pressable } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { theme as defaultTheme } from "@/lib/theme";

export type OptionRow = { value: string; quantity: number };
export type InventoryMode = "simple" | "options";

export type ListingVariant = { name: string; options: OptionRow[] };

const DEFAULT_OPTION_PRESETS = ["Size", "Color", "Material"];
const PLACEHOLDER_COLOR = "#888888";
const OPTION_ROW_HEIGHT = 44;

function reorderOptionRows(rows: OptionRow[], from: number, to: number): OptionRow[] {
  if (from === to || from < 0 || to < 0 || from >= rows.length || to >= rows.length) {
    return rows;
  }
  const next = [...rows];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

type SortableOptionRowProps = {
  row: OptionRow;
  index: number;
  rowCount: number;
  placeholderColor: string;
  onQtyChange: (index: number, qty: number) => void;
  onRemove: (index: number, value: string) => void;
  onReorder: (from: number, to: number) => void;
};

function SortableOptionRow({
  row,
  index,
  rowCount,
  placeholderColor,
  onQtyChange,
  onRemove,
  onReorder,
}: SortableOptionRowProps) {
  const translateY = useSharedValue(0);
  const isDragging = useSharedValue(false);

  const pan = Gesture.Pan()
    .activateAfterLongPress(180)
    .onStart(() => {
      isDragging.value = true;
    })
    .onUpdate((e) => {
      translateY.value = e.translationY;
    })
    .onEnd((e) => {
      const shift = Math.round(e.translationY / OPTION_ROW_HEIGHT);
      const to = Math.max(0, Math.min(rowCount - 1, index + shift));
      if (to !== index) {
        runOnJS(onReorder)(index, to);
      }
      translateY.value = withSpring(0);
      isDragging.value = false;
    })
    .onFinalize(() => {
      translateY.value = withSpring(0);
      isDragging.value = false;
    });

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    zIndex: isDragging.value ? 10 : 0,
    backgroundColor: isDragging.value ? "#f0f7ff" : "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: isDragging.value ? 0.12 : 0,
    shadowRadius: isDragging.value ? 4 : 0,
    elevation: isDragging.value ? 4 : 0,
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.tableRow, animStyle]}>
        <View style={styles.dragCol}>
          <Text style={styles.dragHandle}>⠿</Text>
        </View>
        <Text style={[styles.tableCell, styles.valueCol]} numberOfLines={1}>
          {row.value}
        </Text>
        <TextInput
          style={[styles.qtyInput, styles.qtyCol]}
          placeholder="0"
          placeholderTextColor={placeholderColor}
          value={String(row.quantity || "")}
          onChangeText={(t) => {
            const n = parseInt(t.replace(/\D/g, ""), 10);
            onQtyChange(index, Number.isNaN(n) ? 0 : n);
          }}
          keyboardType="number-pad"
        />
        <Pressable style={styles.actionCol} onPress={() => onRemove(index, row.value)} hitSlop={8}>
          <Text style={styles.removeText}>Remove</Text>
        </Pressable>
      </Animated.View>
    </GestureDetector>
  );
}

export function parseVariantsToEditor(raw: unknown): {
  mode: InventoryMode;
  optionName: string;
  optionRows: OptionRow[];
  hadMultipleAxes: boolean;
} {
  if (!raw || !Array.isArray(raw) || raw.length === 0) {
    return { mode: "simple", optionName: "Size", optionRows: [], hadMultipleAxes: false };
  }

  const axes: ListingVariant[] = (raw as { name?: string; options?: unknown[] }[]).map((v) => {
    const name = typeof v?.name === "string" ? v.name : "";
    const opts = Array.isArray(v?.options) ? v.options : [];
    const options: OptionRow[] = opts.map((o: unknown) => {
      if (typeof o === "object" && o != null && "value" in o && "quantity" in o) {
        return {
          value: String((o as OptionRow).value),
          quantity: Math.max(0, Number((o as OptionRow).quantity) || 0),
        };
      }
      return { value: String(o ?? ""), quantity: 1 };
    });
    return { name, options };
  });

  const withData = axes.filter((a) => a.name.trim() && a.options.some((o) => o.value.trim()));
  if (withData.length === 0) {
    return { mode: "simple", optionName: "Size", optionRows: [], hadMultipleAxes: false };
  }

  const primary = withData[0];
  return {
    mode: "options",
    optionName: primary.name.trim() || "Size",
    optionRows: primary.options.filter((o) => o.value.trim()),
    hadMultipleAxes: withData.length > 1,
  };
}

export function buildVariantsPayload(
  mode: InventoryMode,
  optionName: string,
  optionRows: OptionRow[]
): ListingVariant[] | null {
  if (mode !== "options") return null;
  const name = optionName.trim();
  const options = optionRows
    .filter((o) => o.value.trim())
    .map((o) => ({ value: o.value.trim(), quantity: Math.max(0, o.quantity || 0) }));
  if (!name || options.length === 0) return null;
  return [{ name, options }];
}

export function sumOptionRows(rows: OptionRow[]): number {
  return rows.reduce((sum, o) => sum + Math.max(0, o.quantity || 0), 0);
}

type ListingOptionsEditorProps = {
  mode: InventoryMode;
  onModeChange: (mode: InventoryMode) => void;
  optionName: string;
  onOptionNameChange: (name: string) => void;
  optionRows: OptionRow[];
  onOptionRowsChange: (rows: OptionRow[]) => void;
  simpleQuantity: string;
  onSimpleQuantityChange: (value: string) => void;
  optionNamePresets?: string[];
  placeholderColor?: string;
  legacyMultiAxisNotice?: boolean;
};

export function ListingOptionsEditor({
  mode,
  onModeChange,
  optionName,
  onOptionNameChange,
  optionRows,
  onOptionRowsChange,
  simpleQuantity,
  onSimpleQuantityChange,
  optionNamePresets = DEFAULT_OPTION_PRESETS,
  placeholderColor = PLACEHOLDER_COLOR,
  legacyMultiAxisNotice = false,
}: ListingOptionsEditorProps) {
  const [newValue, setNewValue] = useState("");
  const [customName, setCustomName] = useState(false);
  const presets = optionNamePresets.length > 0 ? optionNamePresets : DEFAULT_OPTION_PRESETS;
  const totalStock = sumOptionRows(optionRows);

  const addRow = () => {
    const val = newValue.trim();
    if (!val) return;
    const dup = optionRows.some((o) => o.value.trim().toLowerCase() === val.toLowerCase());
    if (dup) return;
    onOptionRowsChange([...optionRows, { value: val, quantity: 1 }]);
    setNewValue("");
  };

  const updateRowQty = (index: number, qty: number) => {
    const next = [...optionRows];
    next[index] = { ...next[index], quantity: Math.max(0, qty) };
    onOptionRowsChange(next);
  };

  const removeRow = (index: number, value: string) => {
    Alert.alert(
      "Remove option?",
      `Remove "${value}"? The quantity for this option will be lost.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => onOptionRowsChange(optionRows.filter((_, i) => i !== index)),
        },
      ]
    );
  };

  const moveRow = useCallback(
    (from: number, to: number) => {
      onOptionRowsChange(reorderOptionRows(optionRows, from, to));
    },
    [optionRows, onOptionRowsChange]
  );

  const showCustomName =
    customName || (optionName.trim() !== "" && !presets.includes(optionName.trim()));

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Inventory</Text>
      {legacyMultiAxisNotice ? (
        <Text style={styles.notice}>
          This listing had multiple option groups. Only the first group is shown — linked stores sync
          one option type (e.g. Size).
        </Text>
      ) : null}

      <View style={styles.modeRow}>
        <Pressable
          style={[styles.modeBtn, mode === "simple" && styles.modeBtnActive]}
          onPress={() => onModeChange("simple")}
        >
          <Text style={[styles.modeBtnText, mode === "simple" && styles.modeBtnTextActive]}>
            Simple quantity
          </Text>
        </Pressable>
        <Pressable
          style={[styles.modeBtn, mode === "options" && styles.modeBtnActive]}
          onPress={() => onModeChange("options")}
        >
          <Text style={[styles.modeBtnText, mode === "options" && styles.modeBtnTextActive]}>
            Options (one type)
          </Text>
        </Pressable>
      </View>

      {mode === "simple" ? (
        <>
          <Text style={styles.label}>Quantity *</Text>
          <TextInput
            style={styles.input}
            placeholder="1"
            placeholderTextColor={placeholderColor}
            value={simpleQuantity}
            onChangeText={onSimpleQuantityChange}
            keyboardType="number-pad"
          />
        </>
      ) : (
        <>
          <Text style={styles.hint}>
            One option type with quantity per value (e.g. Size: Small 2, Medium 5). Syncs to Etsy,
            eBay, Shopify, and Wix.
          </Text>

          <Text style={styles.label}>Option type</Text>
          <View style={styles.presetRow}>
            {presets.map((preset) => (
              <Pressable
                key={preset}
                style={[
                  styles.presetChip,
                  !showCustomName && optionName === preset && styles.presetChipActive,
                ]}
                onPress={() => {
                  setCustomName(false);
                  onOptionNameChange(preset);
                }}
              >
                <Text
                  style={[
                    styles.presetChipText,
                    !showCustomName && optionName === preset && styles.presetChipTextActive,
                  ]}
                >
                  {preset}
                </Text>
              </Pressable>
            ))}
            <Pressable
              style={[styles.presetChip, showCustomName && styles.presetChipActive]}
              onPress={() => setCustomName(true)}
            >
              <Text style={[styles.presetChipText, showCustomName && styles.presetChipTextActive]}>
                Custom
              </Text>
            </Pressable>
          </View>
          {showCustomName ? (
            <TextInput
              style={styles.input}
              placeholder="Option name (e.g. Width)"
              placeholderTextColor={placeholderColor}
              value={optionName}
              onChangeText={onOptionNameChange}
            />
          ) : null}

          <View style={styles.tableHeader}>
            <View style={styles.dragCol} />
            <Text style={[styles.tableHeaderCell, styles.valueCol]}>Value</Text>
            <Text style={[styles.tableHeaderCell, styles.qtyCol]}>Qty</Text>
            <View style={styles.actionCol} />
          </View>
          {optionRows.map((row, index) => (
            <SortableOptionRow
              key={`${row.value}-${index}`}
              row={row}
              index={index}
              rowCount={optionRows.length}
              placeholderColor={placeholderColor}
              onQtyChange={updateRowQty}
              onRemove={removeRow}
              onReorder={moveRow}
            />
          ))}

          <View style={styles.addRow}>
            <TextInput
              style={[styles.input, styles.addValueInput]}
              placeholder="Add value (e.g. Large)"
              placeholderTextColor={placeholderColor}
              value={newValue}
              onChangeText={setNewValue}
              onSubmitEditing={addRow}
              returnKeyType="done"
            />
            <Pressable style={styles.addBtn} onPress={addRow}>
              <Text style={styles.addBtnText}>+ Add</Text>
            </Pressable>
          </View>

          <Text style={styles.totalStock}>Total stock: {totalStock} units</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 16 },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: defaultTheme.colors.text,
    marginBottom: 8,
  },
  notice: {
    fontSize: 13,
    color: "#b45309",
    backgroundColor: "#fffbeb",
    padding: 10,
    borderRadius: 8,
    marginBottom: 10,
  },
  hint: { fontSize: 13, color: defaultTheme.colors.labelMuted, marginBottom: 10 },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: defaultTheme.colors.text,
    marginBottom: 6,
    marginTop: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: defaultTheme.colors.text,
    marginBottom: 8,
  },
  modeRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  modeBtn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    alignItems: "center",
  },
  modeBtnActive: {
    borderColor: defaultTheme.colors.primary,
    backgroundColor: "#f0f7ff",
  },
  modeBtnText: { fontSize: 13, fontWeight: "600", color: defaultTheme.colors.labelMuted },
  modeBtnTextActive: { color: defaultTheme.colors.primary },
  presetRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  presetChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 20,
  },
  presetChipActive: {
    borderColor: defaultTheme.colors.primary,
    backgroundColor: "#f0f7ff",
  },
  presetChipText: { fontSize: 14, color: defaultTheme.colors.labelMuted },
  presetChipTextActive: { color: defaultTheme.colors.primary, fontWeight: "600" },
  tableHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e5",
    marginTop: 8,
  },
  tableHeaderCell: { fontSize: 12, fontWeight: "700", color: defaultTheme.colors.labelMuted },
  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: OPTION_ROW_HEIGHT,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#eee",
    backgroundColor: "#fff",
  },
  tableCell: { fontSize: 15, color: defaultTheme.colors.text },
  dragCol: { width: 28, alignItems: "center", justifyContent: "center" },
  dragHandle: { fontSize: 18, color: "#bbb", lineHeight: 22 },
  valueCol: { flex: 1 },
  qtyCol: { width: 56 },
  actionCol: { width: 72, alignItems: "flex-end" },
  qtyInput: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 6,
    fontSize: 15,
    textAlign: "center",
    color: defaultTheme.colors.text,
  },
  removeText: { color: "#c62828", fontSize: 13 },
  addRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  addValueInput: { flex: 1, marginBottom: 0 },
  addBtn: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: defaultTheme.colors.primary,
    borderRadius: 8,
  },
  addBtnText: { color: defaultTheme.colors.primary, fontWeight: "600" },
  totalStock: {
    marginTop: 12,
    fontSize: 14,
    fontWeight: "600",
    color: defaultTheme.colors.text,
  },
});
