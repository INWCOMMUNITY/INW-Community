import React, { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, Switch } from "react-native";
import { theme } from "@/lib/theme";
import {
  buyerFieldsToPayload,
  emptyBuyerField,
  type BuyerFieldDraft,
} from "@/lib/listing-buyer-fields";

export { buyerFieldsToPayload };

const OPTION_LABEL_MAX = 20;
const DROPDOWN_OPTIONS_MAX = 30;
/** Same placeholder tone as the rest of the listing form. */
const PLACEHOLDER_COLOR = "#555555";

function kindLabel(kind: BuyerFieldDraft["kind"]) {
  if (kind === "TEXT") return "Text Box";
  if (kind === "DROPDOWN") return "List of Options";
  return "File Upload";
}

function OptionChipsEditor({
  labels,
  onChange,
  maxCount,
}: {
  labels: string[];
  onChange: (next: string[]) => void;
  maxCount: number;
}) {
  const [draft, setDraft] = useState("");

  function addValue() {
    const val = draft.trim().slice(0, OPTION_LABEL_MAX);
    if (!val) return;
    if (labels.length >= maxCount) return;
    if (labels.some((label) => label.toLowerCase() === val.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...labels, val]);
    setDraft("");
  }

  return (
    <View style={styles.chipWrap}>
      <Text style={styles.hint}>Options (max {OPTION_LABEL_MAX} characters each)</Text>
      <View style={styles.chipRow}>
        {labels.map((value, vi) => (
          <View key={`${value}-${vi}`} style={styles.chip}>
            <Text style={styles.chipText}>{value}</Text>
            <Pressable onPress={() => onChange(labels.filter((_, j) => j !== vi))} hitSlop={8}>
              <Text style={styles.chipRemove}>×</Text>
            </Pressable>
          </View>
        ))}
      </View>
      {labels.length < maxCount ? (
        <View style={styles.addRow}>
          <TextInput
            style={[styles.input, styles.addInput]}
            placeholder="+ Add option"
            placeholderTextColor={PLACEHOLDER_COLOR}
            value={draft}
            maxLength={OPTION_LABEL_MAX}
            onChangeText={(v) => setDraft(v.slice(0, OPTION_LABEL_MAX))}
            onSubmitEditing={addValue}
            returnKeyType="done"
          />
          <Pressable onPress={addValue}>
            <Text style={styles.addBtn}>Add</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function fileCount(raw: string): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 0;
  return Math.min(10, n);
}

function FileUploadEditor({
  field,
  onChange,
}: {
  field: BuyerFieldDraft;
  onChange: (next: BuyerFieldDraft) => void;
}) {
  const count = fileCount(field.maxFiles);
  const labels = Array.from({ length: count }, (_, i) => field.options[i] ?? "");

  return (
    <View style={styles.fileBlock}>
      <Text style={styles.fieldLabel}>Number of files</Text>
      <TextInput
        style={styles.input}
        placeholder="1–10"
        placeholderTextColor={PLACEHOLDER_COLOR}
        keyboardType="number-pad"
        value={field.maxFiles}
        onChangeText={(raw) => {
          const digits = raw.replace(/[^\d]/g, "").slice(0, 2);
          const nextCount = fileCount(digits);
          const shown = digits === "" ? "" : String(nextCount);
          onChange({
            ...field,
            maxFiles: shown,
            options: field.labelEachFile
              ? Array.from({ length: nextCount }, (_, i) => field.options[i] ?? "")
              : field.options,
            optionRequired: field.labelEachFile
              ? Array.from({ length: nextCount }, (_, i) => field.optionRequired?.[i] !== false)
              : field.optionRequired,
          });
        }}
      />
      <View style={styles.labelRow}>
        <Text style={[styles.fieldLabel, styles.labelRowText]}>Label each file</Text>
        <Switch
          value={field.labelEachFile}
          onValueChange={(labelEachFile) => {
            onChange({
              ...field,
              labelEachFile,
              options: labelEachFile
                ? Array.from({ length: count }, (_, i) => field.options[i] ?? "")
                : field.options,
              optionRequired: labelEachFile
                ? Array.from({ length: count }, (_, i) => field.optionRequired?.[i] !== false)
                : field.optionRequired,
            });
          }}
          trackColor={{ false: "#ccc", true: theme.colors.primary }}
          thumbColor="#fff"
        />
      </View>
      {field.labelEachFile ? (
        count < 1 ? (
          <Text style={styles.hint}>Enter how many files to name each one.</Text>
        ) : (
          labels.map((label, i) => {
            const slotRequired = field.optionRequired?.[i] !== false;
            return (
              <View key={`file-label-${i}`} style={styles.labelRow}>
                <TextInput
                  style={[styles.input, styles.labelName]}
                  placeholder={`File ${i + 1} name`}
                  placeholderTextColor={PLACEHOLDER_COLOR}
                  value={label}
                  maxLength={OPTION_LABEL_MAX}
                  onChangeText={(text) => {
                    const options = [...labels];
                    options[i] = text.slice(0, OPTION_LABEL_MAX);
                    onChange({ ...field, options });
                  }}
                />
                <Pressable
                  onPress={() => {
                    const optionRequired = labels.map((_, index) => field.optionRequired?.[index] !== false);
                    optionRequired[i] = !slotRequired;
                    onChange({ ...field, optionRequired });
                  }}
                  style={styles.requiredToggle}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: slotRequired }}
                >
                  <View style={[styles.checkbox, slotRequired && styles.checkboxOn]}>
                    {slotRequired ? <Text style={styles.checkboxMark}>✓</Text> : null}
                  </View>
                  <Text style={styles.requiredLabel}>Required</Text>
                </Pressable>
              </View>
            );
          })
        )
      ) : null}
    </View>
  );
}

export function ListingBuyerFieldsEditor({
  fields,
  onChange,
}: {
  fields: BuyerFieldDraft[];
  onChange: (next: BuyerFieldDraft[]) => void;
}) {
  const fileTaken = fields.some((field) => field.kind === "FILE");
  return (
    <View style={styles.wrap}>
      <Text style={styles.hint}>
        Collect details from buyers — text, a choice, or files. These do not change your inventory.
        Up to 5. One file upload per listing. Synced to Etsy custom options.
      </Text>
      {fields.map((field, index) => (
        <View key={`${field.kind}-${index}`} style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.title}>{kindLabel(field.kind)}</Text>
            <Pressable onPress={() => onChange(fields.filter((_, i) => i !== index))}>
              <Text style={styles.remove}>Remove</Text>
            </Pressable>
          </View>
          <TextInput
            style={styles.input}
            placeholder="Field title"
            placeholderTextColor={PLACEHOLDER_COLOR}
            value={field.title}
            maxLength={45}
            onChangeText={(title) => {
              const next = [...fields];
              next[index] = { ...field, title };
              onChange(next);
            }}
          />
          <Pressable
            onPress={() => {
              const next = [...fields];
              next[index] = { ...field, required: !field.required };
              onChange(next);
            }}
          >
            <Text style={styles.hint}>{field.required ? "Required" : "Optional"} — tap to toggle</Text>
          </Pressable>
          {field.kind !== "DROPDOWN" ? (
            <TextInput
              style={styles.input}
              placeholder="Instructions (optional)"
              placeholderTextColor={PLACEHOLDER_COLOR}
              value={field.instructions}
              maxLength={120}
              onChangeText={(instructions) => {
                const next = [...fields];
                next[index] = { ...field, instructions };
                onChange(next);
              }}
            />
          ) : null}
          {field.kind === "TEXT" ? (
            <View>
              <Text style={styles.fieldLabel}>Character limit</Text>
              <TextInput
                style={styles.input}
                keyboardType="number-pad"
                value={field.maxCharacters}
                onChangeText={(maxCharacters) => {
                  const next = [...fields];
                  next[index] = { ...field, maxCharacters: maxCharacters.replace(/[^\d]/g, "") };
                  onChange(next);
                }}
              />
            </View>
          ) : null}
          {field.kind === "DROPDOWN" ? (
            <OptionChipsEditor
              labels={field.options}
              maxCount={DROPDOWN_OPTIONS_MAX}
              onChange={(options) => {
                const next = [...fields];
                next[index] = { ...field, options };
                onChange(next);
              }}
            />
          ) : null}
          {field.kind === "FILE" ? (
            <FileUploadEditor
              field={field}
              onChange={(nextField) => {
                const next = [...fields];
                next[index] = nextField;
                onChange(next);
              }}
            />
          ) : null}
        </View>
      ))}
      {fields.length < 5 ? (
        <View style={styles.row}>
          <Pressable style={styles.add} onPress={() => onChange([...fields, emptyBuyerField("TEXT")])}>
            <Text>Text Box</Text>
          </Pressable>
          <Pressable style={styles.add} onPress={() => onChange([...fields, emptyBuyerField("DROPDOWN")])}>
            <Text>List of Options</Text>
          </Pressable>
          <Pressable
            style={[styles.add, fileTaken && { opacity: 0.4 }]}
            disabled={fileTaken}
            onPress={() => onChange([...fields, emptyBuyerField("FILE")])}
          >
            <Text>File Upload</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, marginBottom: 12 },
  hint: { color: "#555", fontSize: 13 },
  fieldLabel: { color: "#333", fontSize: 13, fontWeight: "600", marginBottom: 4 },
  fileBlock: { gap: 6 },
  labelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  labelRowText: { marginBottom: 0, flex: 1 },
  labelName: { flex: 1, marginBottom: 0 },
  requiredToggle: { flexDirection: "row", alignItems: "center", gap: 6 },
  checkbox: {
    width: 18,
    height: 18,
    borderWidth: 1,
    borderColor: "#333",
    borderRadius: 3,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  checkboxOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  checkboxMark: { color: "#fff", fontSize: 12, fontWeight: "700", lineHeight: 14 },
  requiredLabel: { color: "#333", fontSize: 13 },
  card: { borderWidth: 1, borderColor: "#ddd", borderRadius: 8, padding: 8, gap: 6 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" },
  title: { fontWeight: "500" },
  remove: { color: "#b00020" },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 6, padding: 8 },
  add: { borderWidth: 1, borderColor: "#ccc", borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6 },
  chipWrap: { gap: 6 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: "#fff",
  },
  chipText: { fontSize: 13 },
  chipRemove: { color: "#b00020", fontWeight: "700", fontSize: 16, lineHeight: 16 },
  addRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  addInput: { flex: 1, minWidth: 120 },
  addBtn: { color: "#3E432F", fontWeight: "700", fontSize: 14 },
});
