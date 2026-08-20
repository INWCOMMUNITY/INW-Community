import React from "react";
import { View, Text, StyleSheet, Switch, TextInput, Pressable } from "react-native";
import { CollapsibleSection } from "@/components/listing/CollapsibleSection";
import { RadioOptionList } from "@/components/listing/RadioOptionList";
import { SelectField } from "@/components/listing/SelectField";
import { theme, switchIosBackgroundColor, switchThumbColor, switchTrackColor } from "@/lib/theme";
import {
  ETSY_WHO_MADE_OPTIONS,
  ETSY_WHEN_MADE_OPTIONS,
  type EtsyWhenMade,
  type EtsyWhoMade,
  isEtsyWhoMade,
  normalizeEtsyWhenMade,
} from "@/lib/etsy-listing-options";

export type EtsyCategorySuggestion = {
  taxonomyId: number;
  categoryName: string;
  categoryPath?: string;
};

type EtsyListingRequirementsSectionProps = {
  etsyWhoMade: EtsyWhoMade;
  etsyWhenMade: EtsyWhenMade;
  etsyIsSupply: boolean;
  onWhoMadeChange: (value: EtsyWhoMade) => void;
  onWhenMadeChange: (value: EtsyWhenMade) => void;
  onIsSupplyChange: (value: boolean) => void;
  etsyTaxonomyId: string;
  etsyCategoryLabel: string;
  etsyCategorySearch: string;
  onEtsyCategorySearchChange: (value: string) => void;
  etsyCategoryResults: EtsyCategorySuggestion[];
  etsySearching: boolean;
  etsyCategorySearchError?: string | null;
  onSelectCategory: (taxonomyId: string, label: string) => void;
  onClearCategory: () => void;
  placeholderColor?: string;
  defaultExpanded?: boolean;
};

export function EtsyListingRequirementsSection({
  etsyWhoMade,
  etsyWhenMade,
  etsyIsSupply,
  onWhoMadeChange,
  onWhenMadeChange,
  onIsSupplyChange,
  etsyTaxonomyId,
  etsyCategoryLabel,
  etsyCategorySearch,
  onEtsyCategorySearchChange,
  etsyCategoryResults,
  etsySearching,
  etsyCategorySearchError,
  onSelectCategory,
  onClearCategory,
  placeholderColor = "#888",
  defaultExpanded = false,
}: EtsyListingRequirementsSectionProps) {
  const valid =
    isEtsyWhoMade(etsyWhoMade) &&
    normalizeEtsyWhenMade(etsyWhenMade) != null &&
    Boolean(etsyTaxonomyId);
  const badge = valid ? "Ready" : "Required";
  const badgeColor = valid ? "#16a34a" : "#dc2626";

  return (
    <CollapsibleSection
      title="Etsy Listing Requirements"
      subtitle="Category and details required to publish on Etsy"
      icon="storefront-outline"
      defaultExpanded={defaultExpanded || !valid}
      badge={badge}
      badgeColor={badgeColor}
    >
      <Text style={styles.hint}>
        Etsy requires a category and these details to publish. Items go live only when your shop has
        a shipping profile set in Sync Stores.
      </Text>

      <Text style={styles.label}>Etsy category</Text>
      {etsyTaxonomyId ? (
        <View style={styles.categoryChip}>
          <View style={{ flex: 1 }}>
            <Text style={styles.categoryChipLabel} numberOfLines={2}>
              {etsyCategoryLabel || `Etsy category #${etsyTaxonomyId}`}
            </Text>
            <Text style={styles.hintInline}>Etsy category #{etsyTaxonomyId}</Text>
          </View>
          <Pressable onPress={onClearCategory}>
            <Text style={styles.changeLink}>Change</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <TextInput
            style={styles.input}
            value={etsyCategorySearch}
            onChangeText={onEtsyCategorySearchChange}
            placeholder="Search Etsy categories (e.g. wall clocks)"
            placeholderTextColor={placeholderColor}
          />
          {etsySearching ? <Text style={styles.hintInline}>Searching Etsy…</Text> : null}
          {etsyCategorySearchError ? (
            <Text style={styles.error}>{etsyCategorySearchError}</Text>
          ) : null}
          {etsyCategoryResults.map((c) => (
            <Pressable
              key={c.taxonomyId}
              style={styles.categoryResult}
              onPress={() =>
                onSelectCategory(String(c.taxonomyId), c.categoryPath || c.categoryName)
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

      <Text style={styles.label}>Who made it?</Text>
      <RadioOptionList
        options={ETSY_WHO_MADE_OPTIONS}
        value={etsyWhoMade}
        onChange={(v) => onWhoMadeChange(v as EtsyWhoMade)}
      />

      <SelectField
        label="When was it made?"
        value={etsyWhenMade}
        options={ETSY_WHEN_MADE_OPTIONS}
        onChange={(v) => onWhenMadeChange(v as EtsyWhenMade)}
        placeholder="Select when it was made"
      />

      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>This is a craft supply or tool</Text>
        <Switch
          value={etsyIsSupply}
          onValueChange={onIsSupplyChange}
          trackColor={switchTrackColor()}
          thumbColor={switchThumbColor(etsyIsSupply)}
          ios_backgroundColor={switchIosBackgroundColor}
        />
      </View>
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
  error: {
    fontSize: 12,
    color: "#dc2626",
    marginBottom: 8,
  },
  label: {
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
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
  },
  switchLabel: {
    flex: 1,
    fontSize: 14,
    color: "#000",
    marginRight: 12,
  },
});
