import React, { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import {
  buyerFieldsToPayload,
  emptyBuyerField,
  type BuyerFieldDraft,
} from "@/lib/listing-buyer-fields";

export { buyerFieldsToPayload };

const OPTION_LABEL_MAX = 20;
const DROPDOWN_OPTIONS_MAX = 30;

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
            <TextInput
              style={styles.input}
              placeholder="Character limit"
              keyboardType="number-pad"
              value={field.maxCharacters}
              onChangeText={(maxCharacters) => {
                const next = [...fields];
                next[index] = { ...field, maxCharacters: maxCharacters.replace(/[^\d]/g, "") };
                onChange(next);
              }}
            />
          ) : null}
          {field.kind === "DROPDOWN" || (field.kind === "FILE" && field.labelEachFile) ? (
            <OptionChipsEditor
              labels={field.options}
              maxCount={field.kind === "DROPDOWN" ? DROPDOWN_OPTIONS_MAX : 10}
              onChange={(options) => {
                const next = [...fields];
                const maxFiles =
                  field.kind === "FILE" && field.labelEachFile
                    ? String(Math.min(10, Math.max(1, options.length || Number(field.maxFiles) || 1)))
                    : field.maxFiles;
                next[index] = {
                  ...field,
                  options,
                  ...(field.kind === "FILE" ? { maxFiles } : {}),
                };
                onChange(next);
              }}
            />
          ) : null}
          {field.kind === "FILE" ? (
            <>
              <TextInput
                style={styles.input}
                placeholder="Number of files"
                keyboardType="number-pad"
                value={field.maxFiles}
                editable={!field.labelEachFile}
                onChangeText={(maxFiles) => {
                  if (field.labelEachFile) return;
                  const next = [...fields];
                  next[index] = { ...field, maxFiles: maxFiles.replace(/[^\d]/g, "") };
                  onChange(next);
                }}
              />
              <Pressable
                onPress={() => {
                  const labelEachFile = !field.labelEachFile;
                  const next = [...fields];
                  next[index] = {
                    ...field,
                    labelEachFile,
                    maxFiles: labelEachFile
                      ? String(Math.min(10, Math.max(1, field.options.length || Number(field.maxFiles) || 1)))
                      : field.maxFiles,
                  };
                  onChange(next);
                }}
              >
                <Text style={styles.hint}>
                  {field.labelEachFile ? "Labels on (file count follows labels)" : "Labels off"} — tap to toggle
                </Text>
              </Pressable>
            </>
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
