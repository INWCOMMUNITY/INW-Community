import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
} from "react-native";
import { theme } from "@/lib/theme";
import { CollapsibleSection } from "@/components/listing/CollapsibleSection";

export type ListingAspect = { name: string; value: string };

type EbayCategorySuggestion = { categoryId: string; categoryName: string; categoryPath?: string };

type EbayCategoryAspect = {
  name: string;
  required: boolean;
  mode: "FREE_TEXT" | "SELECTION_ONLY";
  cardinality: "SINGLE" | "MULTI";
  suggestedValues: string[];
};

type EbayItemDetailsSectionProps = {
  ebayCategoryId: string;
  ebayCategoryLabel: string;
  ebayCategorySearch: string;
  onEbayCategorySearchChange: (value: string) => void;
  ebayCategoryResults: EbayCategorySuggestion[];
  ebaySearching: boolean;
  onSelectCategory: (categoryId: string, label: string) => void;
  onClearCategory: () => void;
  aspects: ListingAspect[];
  onAspectNameChange: (index: number, name: string) => void;
  onAspectValueChange: (index: number, value: string) => void;
  onRemoveAspect: (index: number) => void;
  onAddAspect: () => void;
  isRequiredAspect: (name: string) => boolean;
  categoryAspects?: EbayCategoryAspect[];
  suggestionsForAspect?: (name: string) => string[];
  maxAspects: number;
  aspectNameMax: number;
  aspectValueMax: number;
  placeholderColor?: string;
  defaultExpanded?: boolean;
  missingRequiredCount?: number;
  /** Imported eBay listings — specifics are display-only. */
  readOnlyAspects?: boolean;
};

export function EbayItemDetailsSection({
  ebayCategoryId,
  ebayCategoryLabel,
  ebayCategorySearch,
  onEbayCategorySearchChange,
  ebayCategoryResults,
  ebaySearching,
  onSelectCategory,
  onClearCategory,
  aspects,
  onAspectNameChange,
  onAspectValueChange,
  onRemoveAspect,
  onAddAspect,
  isRequiredAspect,
  categoryAspects = [],
  suggestionsForAspect,
  maxAspects,
  aspectNameMax,
  aspectValueMax,
  placeholderColor = "#888",
  defaultExpanded = true,
  missingRequiredCount = 0,
  readOnlyAspects = false,
}: EbayItemDetailsSectionProps) {
  const badge =
    readOnlyAspects && ebayCategoryId
      ? "From eBay"
      : missingRequiredCount > 0
        ? `${missingRequiredCount} required`
        : ebayCategoryId
          ? "Ready"
          : undefined;
  const badgeColor =
    readOnlyAspects && ebayCategoryId
      ? "#2563eb"
      : missingRequiredCount > 0
        ? "#dc2626"
        : "#16a34a";

  return (
    <CollapsibleSection
      title="eBay Listing Requirements"
      subtitle="Category and item specifics for eBay"
      icon="pricetags-outline"
      defaultExpanded={defaultExpanded || missingRequiredCount > 0}
      badge={badge}
      badgeColor={badgeColor}
    >
      <Text style={styles.hint}>
        {readOnlyAspects
          ? "Item specifics are managed on eBay. Use Refresh from eBay to pull the latest values."
          : "Pick an eBay category, then fill in item specifics (Brand, Type, etc.). Required fields are marked with *."}
      </Text>

      <Text style={styles.fieldLabel}>eBay category</Text>
      {ebayCategoryId ? (
        <View style={styles.categoryChip}>
          <View style={{ flex: 1 }}>
            <Text style={styles.categoryChipLabel} numberOfLines={2}>
              {ebayCategoryLabel || `eBay category #${ebayCategoryId}`}
            </Text>
            <Text style={styles.hintInline}>eBay category #{ebayCategoryId}</Text>
          </View>
          <Pressable onPress={onClearCategory} disabled={readOnlyAspects}>
            <Text style={[styles.changeLink, readOnlyAspects && { opacity: 0.4 }]}>Change</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <TextInput
            style={styles.input}
            value={ebayCategorySearch}
            onChangeText={onEbayCategorySearchChange}
            placeholder="Search eBay categories (e.g. US coins)"
            placeholderTextColor={placeholderColor}
          />
          {ebaySearching ? <Text style={styles.hintInline}>Searching eBay…</Text> : null}
          {ebayCategoryResults.map((c) => (
            <Pressable
              key={c.categoryId}
              style={styles.categoryResult}
              onPress={() =>
                onSelectCategory(c.categoryId, c.categoryPath || c.categoryName)
              }
            >
              <Text style={styles.categoryResultName}>{c.categoryName}</Text>
              {c.categoryPath && c.categoryPath !== c.categoryName ? (
                <Text style={styles.hintInline} numberOfLines={1}>
                  {c.categoryPath}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </>
      )}

      {ebayCategoryId ? (
        <>
          <View style={styles.detailsHeader}>
            <Text style={styles.fieldLabel}>Specifics</Text>
            <Text style={styles.count}>{aspects.length}/{maxAspects}</Text>
          </View>
          {aspects.map((a, i) => {
            const required = isRequiredAspect(a.name);
            const schema = categoryAspects.find(
              (ca) => ca.name.trim().toLowerCase() === a.name.trim().toLowerCase()
            );
            const suggestions =
              suggestionsForAspect?.(a.name) ?? schema?.suggestedValues ?? [];
            const isSelectionOnly = schema?.mode === "SELECTION_ONLY" && suggestions.length > 0;
            const isMulti = schema?.cardinality === "MULTI";
            return (
              <View key={i} style={styles.aspectRow}>
                <TextInput
                  style={[styles.input, styles.aspectInput, readOnlyAspects && styles.readOnlyInput]}
                  value={a.name}
                  onChangeText={(t) => onAspectNameChange(i, t)}
                  placeholder="Descriptor"
                  maxLength={aspectNameMax}
                  placeholderTextColor={placeholderColor}
                  editable={!readOnlyAspects && !(required && !!ebayCategoryId)}
                />
                <View style={{ flex: 1 }}>
                  <TextInput
                    style={[
                      styles.input,
                      styles.aspectInput,
                      { marginBottom: 0 },
                      readOnlyAspects && styles.readOnlyInput,
                      required && !readOnlyAspects && !a.value.trim() ? styles.aspectInputRequired : null,
                    ]}
                    value={a.value}
                    onChangeText={(t) => onAspectValueChange(i, t)}
                    placeholder={readOnlyAspects ? "Value from eBay" : required ? "Value (required)" : "Value"}
                    maxLength={aspectValueMax}
                    placeholderTextColor={placeholderColor}
                    editable={!readOnlyAspects}
                  />
                  {isSelectionOnly ? (
                    <Text style={styles.hintInline} numberOfLines={2}>
                      Allowed: {suggestions.join(", ")}
                    </Text>
                  ) : null}
                </View>
                {!readOnlyAspects ? (
                  <Pressable onPress={() => onRemoveAspect(i)} style={styles.aspectRemove}>
                    <Text style={styles.aspectRemoveText}>×</Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })}
          {!readOnlyAspects && aspects.length < maxAspects ? (
            <Pressable style={styles.addDetailBtn} onPress={onAddAspect}>
              <Text style={styles.addDetailBtnText}>+ Add a detail</Text>
            </Pressable>
          ) : null}
        </>
      ) : (
        <Text style={styles.hintInline}>Select a category to see required item specifics.</Text>
      )}
    </CollapsibleSection>
  );
}

const styles = StyleSheet.create({
  hint: {
    fontSize: 12,
    color: theme.colors.labelMuted,
    marginBottom: 12,
    lineHeight: 18,
  },
  hintInline: {
    fontSize: 12,
    color: theme.colors.labelMuted,
    marginBottom: 8,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#000",
    marginBottom: 8,
    marginTop: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 8,
    color: theme.colors.text,
    backgroundColor: "#fff",
  },
  categoryChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    backgroundColor: "#f7f7f7",
    padding: 12,
    marginBottom: 8,
  },
  categoryChipLabel: { fontSize: 14, fontWeight: "600", color: "#000" },
  changeLink: { color: "#dc2626", fontSize: 14, fontWeight: "600" },
  categoryResult: {
    borderWidth: 1,
    borderColor: "#eee",
    borderRadius: 8,
    padding: 10,
    marginBottom: 6,
    backgroundColor: "#fff",
  },
  categoryResultName: { fontSize: 14, fontWeight: "600", color: "#000" },
  detailsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
    marginBottom: 4,
  },
  count: { fontSize: 12, color: theme.colors.labelMuted },
  aspectRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  aspectInput: { flex: 1, marginBottom: 0 },
  readOnlyInput: { backgroundColor: "#f3f4f6", color: "#374151" },
  aspectInputRequired: { borderColor: "#f87171" },
  aspectRemove: { paddingHorizontal: 6, paddingVertical: 4 },
  aspectRemoveText: { color: "#dc2626", fontSize: 22, fontWeight: "700", lineHeight: 24 },
  addDetailBtn: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    marginTop: 4,
  },
  addDetailBtnText: { color: "#333", fontSize: 14, fontWeight: "600" },
});
