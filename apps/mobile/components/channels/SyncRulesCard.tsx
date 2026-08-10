import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Switch,
  TextInput,
  Alert,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPatch } from "@/lib/api";

type SyncPreferences = {
  syncEnabled: boolean;
  sourceOfTruth: string;
  conflictResolution: string;
  safetyBuffer: number;
  lowStockAlertThreshold: number;
  syncZeroQuantity: boolean;
  syncTitles: boolean;
  syncDescriptions: boolean;
  syncPhotos: boolean;
  syncPrices: boolean;
  syncShipping: boolean;
};

const SOURCE_OF_TRUTH_OPTIONS = [
  { value: "inw", label: "INW Community" },
  { value: "wix", label: "Wix" },
  { value: "ebay", label: "eBay" },
  { value: "etsy", label: "Etsy" },
  { value: "shopify", label: "Shopify" },
];

const CONFLICT_RESOLUTION_OPTIONS = [
  { value: "most_recent", label: "Most Recent Wins" },
  { value: "inw_wins", label: "INW Always Wins" },
  { value: "manual_review", label: "Ask Me (Review Conflicts)" },
];

export function SyncRulesCard() {
  const [prefs, setPrefs] = useState<SyncPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [inventoryExpanded, setInventoryExpanded] = useState(false);
  const [contentExpanded, setContentExpanded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await apiGet<SyncPreferences>("/api/seller/sync-preferences");
      setPrefs(res);
    } catch {
      setPrefs(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  const updatePref = async (updates: Partial<SyncPreferences>) => {
    if (!prefs) return;
    setSaving(true);
    try {
      const res = await apiPatch<SyncPreferences>("/api/seller/sync-preferences", updates);
      setPrefs(res);
    } catch (e) {
      Alert.alert("Error", "Failed to save sync preferences");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator color={theme.colors.primary} size="small" />
      </View>
    );
  }

  if (!prefs) {
    return null;
  }

  return (
    <View style={styles.container}>
      {/* Master Toggle */}
      <View style={styles.masterRow}>
        <View style={styles.masterInfo}>
          <Ionicons 
            name={prefs.syncEnabled ? "sync" : "pause-circle"} 
            size={22} 
            color={prefs.syncEnabled ? theme.colors.primary : "#9ca3af"} 
          />
          <View>
            <Text style={styles.masterTitle}>Sync Rules</Text>
            <Text style={styles.masterSubtitle}>
              {prefs.syncEnabled ? "Sync is active" : "Sync is paused"}
            </Text>
          </View>
        </View>
        <Switch
          value={prefs.syncEnabled}
          onValueChange={(val) => updatePref({ syncEnabled: val })}
          trackColor={{ false: "#d1d5db", true: theme.colors.primary }}
          thumbColor="#fff"
          disabled={saving}
        />
      </View>

      {/* Expandable Settings */}
      <Pressable
        style={styles.sectionHeader}
        onPress={() => setExpanded(!expanded)}
      >
        <Text style={styles.sectionTitle}>Global Settings</Text>
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={18}
          color="#9ca3af"
        />
      </Pressable>

      {expanded && (
        <View style={styles.sectionContent}>
          {/* Source of Truth */}
          <Text style={styles.fieldLabel}>Source of Truth</Text>
          <Text style={styles.fieldHint}>
            When conflicts occur, which platform should win?
          </Text>
          <View style={styles.optionsRow}>
            {SOURCE_OF_TRUTH_OPTIONS.map((opt) => (
              <Pressable
                key={opt.value}
                style={[
                  styles.optionChip,
                  prefs.sourceOfTruth === opt.value && styles.optionChipActive,
                ]}
                onPress={() => updatePref({ sourceOfTruth: opt.value })}
                disabled={saving}
              >
                <Text
                  style={[
                    styles.optionChipText,
                    prefs.sourceOfTruth === opt.value && styles.optionChipTextActive,
                  ]}
                >
                  {opt.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Conflict Resolution */}
          <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Conflict Resolution</Text>
          <Text style={styles.fieldHint}>
            How to handle when both INW and a channel have changed
          </Text>
          <View style={styles.optionsColumn}>
            {CONFLICT_RESOLUTION_OPTIONS.map((opt) => (
              <Pressable
                key={opt.value}
                style={[
                  styles.radioRow,
                  prefs.conflictResolution === opt.value && styles.radioRowActive,
                ]}
                onPress={() => updatePref({ conflictResolution: opt.value })}
                disabled={saving}
              >
                <Ionicons
                  name={prefs.conflictResolution === opt.value ? "radio-button-on" : "radio-button-off"}
                  size={20}
                  color={prefs.conflictResolution === opt.value ? theme.colors.primary : "#9ca3af"}
                />
                <Text style={styles.radioLabel}>{opt.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {/* Inventory Rules */}
      <Pressable
        style={styles.sectionHeader}
        onPress={() => setInventoryExpanded(!inventoryExpanded)}
      >
        <Text style={styles.sectionTitle}>Inventory Rules</Text>
        <Ionicons
          name={inventoryExpanded ? "chevron-up" : "chevron-down"}
          size={18}
          color="#9ca3af"
        />
      </Pressable>

      {inventoryExpanded && (
        <View style={styles.sectionContent}>
          {/* Safety Buffer */}
          <Text style={styles.fieldLabel}>Safety Buffer</Text>
          <Text style={styles.fieldHint}>
            Hold back this many units from external channels (INW shows true quantity)
          </Text>
          <View style={styles.numberInputRow}>
            <Pressable
              style={styles.numberBtn}
              onPress={() => updatePref({ safetyBuffer: Math.max(0, prefs.safetyBuffer - 1) })}
              disabled={saving || prefs.safetyBuffer <= 0}
            >
              <Ionicons name="remove" size={20} color={theme.colors.primary} />
            </Pressable>
            <TextInput
              style={styles.numberInput}
              value={String(prefs.safetyBuffer)}
              onChangeText={(text) => {
                const num = parseInt(text, 10);
                if (!isNaN(num) && num >= 0) {
                  updatePref({ safetyBuffer: num });
                }
              }}
              keyboardType="number-pad"
              selectTextOnFocus
            />
            <Pressable
              style={styles.numberBtn}
              onPress={() => updatePref({ safetyBuffer: prefs.safetyBuffer + 1 })}
              disabled={saving}
            >
              <Ionicons name="add" size={20} color={theme.colors.primary} />
            </Pressable>
          </View>

          {/* Low Stock Alert */}
          <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Low Stock Alert</Text>
          <Text style={styles.fieldHint}>
            Notify when any item drops below this quantity (0 = disabled)
          </Text>
          <View style={styles.numberInputRow}>
            <Pressable
              style={styles.numberBtn}
              onPress={() => updatePref({ lowStockAlertThreshold: Math.max(0, prefs.lowStockAlertThreshold - 1) })}
              disabled={saving || prefs.lowStockAlertThreshold <= 0}
            >
              <Ionicons name="remove" size={20} color={theme.colors.primary} />
            </Pressable>
            <TextInput
              style={styles.numberInput}
              value={String(prefs.lowStockAlertThreshold)}
              onChangeText={(text) => {
                const num = parseInt(text, 10);
                if (!isNaN(num) && num >= 0) {
                  updatePref({ lowStockAlertThreshold: num });
                }
              }}
              keyboardType="number-pad"
              selectTextOnFocus
            />
            <Pressable
              style={styles.numberBtn}
              onPress={() => updatePref({ lowStockAlertThreshold: prefs.lowStockAlertThreshold + 1 })}
              disabled={saving}
            >
              <Ionicons name="add" size={20} color={theme.colors.primary} />
            </Pressable>
          </View>

          {/* Sync Zero Quantity */}
          <View style={[styles.toggleRow, { marginTop: 16 }]}>
            <View style={styles.toggleInfo}>
              <Text style={styles.fieldLabel}>Sync Zero Quantity</Text>
              <Text style={styles.fieldHint}>
                Show "out of stock" on channels vs hiding the listing
              </Text>
            </View>
            <Switch
              value={prefs.syncZeroQuantity}
              onValueChange={(val) => updatePref({ syncZeroQuantity: val })}
              trackColor={{ false: "#d1d5db", true: theme.colors.primary }}
              thumbColor="#fff"
              disabled={saving}
            />
          </View>
        </View>
      )}

      {/* Content Sync Rules */}
      <Pressable
        style={styles.sectionHeader}
        onPress={() => setContentExpanded(!contentExpanded)}
      >
        <Text style={styles.sectionTitle}>Content Sync</Text>
        <Ionicons
          name={contentExpanded ? "chevron-up" : "chevron-down"}
          size={18}
          color="#9ca3af"
        />
      </Pressable>

      {contentExpanded && (
        <View style={styles.sectionContent}>
          <Text style={styles.fieldHint}>
            Choose which fields to sync between INW and your connected channels
          </Text>

          {[
            { key: "syncTitles", label: "Titles" },
            { key: "syncDescriptions", label: "Descriptions" },
            { key: "syncPhotos", label: "Photos" },
            { key: "syncPrices", label: "Prices" },
            { key: "syncShipping", label: "Shipping Costs" },
          ].map((field) => (
            <View key={field.key} style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>{field.label}</Text>
              <Switch
                value={prefs[field.key as keyof SyncPreferences] as boolean}
                onValueChange={(val) => updatePref({ [field.key]: val })}
                trackColor={{ false: "#d1d5db", true: theme.colors.primary }}
                thumbColor="#fff"
                disabled={saving}
              />
            </View>
          ))}
        </View>
      )}

      {saving && (
        <View style={styles.savingOverlay}>
          <ActivityIndicator color={theme.colors.primary} size="small" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderColor: "#e0e0e0",
    borderRadius: 12,
    marginBottom: 16,
    backgroundColor: "#fafafa",
    overflow: "hidden",
  },
  masterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  masterInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  masterTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.heading,
  },
  masterSubtitle: {
    fontSize: 13,
    color: "#6b7280",
    marginTop: 2,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.heading,
  },
  sectionContent: {
    padding: 14,
    paddingTop: 10,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: "500",
    color: theme.colors.heading,
  },
  fieldHint: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 2,
    marginBottom: 8,
  },
  optionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  optionChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: "#f3f4f6",
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  optionChipActive: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  optionChipText: {
    fontSize: 13,
    fontWeight: "500",
    color: "#374151",
  },
  optionChipTextActive: {
    color: "#fff",
  },
  optionsColumn: {
    gap: 8,
  },
  radioRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: "#f9fafb",
  },
  radioRowActive: {
    backgroundColor: "#f0f9ff",
  },
  radioLabel: {
    fontSize: 14,
    color: theme.colors.heading,
  },
  numberInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  numberBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  numberInput: {
    width: 60,
    height: 40,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    textAlign: "center",
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.heading,
    backgroundColor: "#fff",
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
  },
  toggleInfo: {
    flex: 1,
    marginRight: 12,
  },
  toggleLabel: {
    fontSize: 14,
    fontWeight: "500",
    color: theme.colors.heading,
  },
  savingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(255,255,255,0.7)",
    alignItems: "center",
    justifyContent: "center",
  },
});
