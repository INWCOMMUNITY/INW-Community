import React from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import {
  buyerFieldsToPayload,
  emptyBuyerField,
  type BuyerFieldDraft,
} from "@/lib/listing-buyer-fields";

export { buyerFieldsToPayload };

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
        Custom options for buyers (text, choices, or one file upload). These do not change inventory.
      </Text>
      {fields.map((field, index) => (
        <View key={`${field.kind}-${index}`} style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.title}>
              {field.kind === "TEXT" ? "Text box" : field.kind === "DROPDOWN" ? "List of options" : "File upload"}
            </Text>
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
            <TextInput
              style={[styles.input, { minHeight: 72 }]}
              placeholder={field.kind === "DROPDOWN" ? "One option per line" : "One file label per line"}
              multiline
              value={field.optionsText}
              onChangeText={(optionsText) => {
                const next = [...fields];
                next[index] = { ...field, optionsText };
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
                onChangeText={(maxFiles) => {
                  const next = [...fields];
                  next[index] = { ...field, maxFiles: maxFiles.replace(/[^\d]/g, "") };
                  onChange(next);
                }}
              />
              <Pressable
                onPress={() => {
                  const next = [...fields];
                  next[index] = { ...field, labelEachFile: !field.labelEachFile };
                  onChange(next);
                }}
              >
                <Text style={styles.hint}>
                  {field.labelEachFile ? "Labels on" : "Labels off"} — tap to toggle
                </Text>
              </Pressable>
            </>
          ) : null}
        </View>
      ))}
      {fields.length < 5 ? (
        <View style={styles.row}>
          <Pressable style={styles.add} onPress={() => onChange([...fields, emptyBuyerField("TEXT")])}>
            <Text>Text</Text>
          </Pressable>
          <Pressable style={styles.add} onPress={() => onChange([...fields, emptyBuyerField("DROPDOWN")])}>
            <Text>Options</Text>
          </Pressable>
          <Pressable
            style={[styles.add, fileTaken && { opacity: 0.4 }]}
            disabled={fileTaken}
            onPress={() => onChange([...fields, emptyBuyerField("FILE")])}
          >
            <Text>File</Text>
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
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  title: { fontWeight: "600" },
  remove: { color: "#b00020" },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 6, padding: 8 },
  add: { borderWidth: 1, borderColor: "#ccc", borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6 },
});
