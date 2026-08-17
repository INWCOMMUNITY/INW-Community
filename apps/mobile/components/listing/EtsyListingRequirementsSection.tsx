import React from "react";
import { View, Text, StyleSheet, Switch } from "react-native";
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

type EtsyListingRequirementsSectionProps = {
  etsyWhoMade: EtsyWhoMade;
  etsyWhenMade: EtsyWhenMade;
  etsyIsSupply: boolean;
  onWhoMadeChange: (value: EtsyWhoMade) => void;
  onWhenMadeChange: (value: EtsyWhenMade) => void;
  onIsSupplyChange: (value: boolean) => void;
  defaultExpanded?: boolean;
};

export function EtsyListingRequirementsSection({
  etsyWhoMade,
  etsyWhenMade,
  etsyIsSupply,
  onWhoMadeChange,
  onWhenMadeChange,
  onIsSupplyChange,
  defaultExpanded = false,
}: EtsyListingRequirementsSectionProps) {
  const valid =
    isEtsyWhoMade(etsyWhoMade) && normalizeEtsyWhenMade(etsyWhenMade) != null;
  const badge = valid ? "Ready" : "Required";
  const badgeColor = valid ? "#16a34a" : "#dc2626";

  return (
    <CollapsibleSection
      title="Etsy Listing Requirements"
      subtitle="Details required to publish on Etsy"
      icon="storefront-outline"
      defaultExpanded={defaultExpanded || !valid}
      badge={badge}
      badgeColor={badgeColor}
    >
      <Text style={styles.hint}>
        Etsy requires these to publish. Items go live only when your shop has a shipping profile
        set in Sync Stores.
      </Text>

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
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#000",
    marginBottom: 8,
    marginTop: 4,
  },
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
