import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  Switch,
  TextInput,
  ActivityIndicator,
  ScrollView,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPatch } from "@/lib/api";

type ChannelConfig = {
  syncDirection: string;
  autoImportInbound: boolean;
  priceAdjustmentPercent: number;
  inventoryOffset: number;
};

type Props = {
  visible: boolean;
  connectionId: string;
  provider: string;
  providerName: string;
  onClose: () => void;
  onSaved?: () => void;
};

const SYNC_DIRECTION_OPTIONS = [
  { value: "two_way", label: "Two-way Sync", desc: "Changes sync in both directions" },
  { value: "push_only", label: "Push Only", desc: "INW changes push to channel, never pull" },
  { value: "pull_only", label: "Pull Only", desc: "Channel changes pull to INW, never push" },
  { value: "paused", label: "Paused", desc: "No syncing until re-enabled" },
];

export function ChannelSettingsModal({
  visible,
  connectionId,
  provider,
  providerName,
  onClose,
  onSaved,
}: Props) {
  const [config, setConfig] = useState<ChannelConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [priceInput, setPriceInput] = useState("");
  const [inventoryInput, setInventoryInput] = useState("");

  useEffect(() => {
    if (visible && connectionId) {
      loadConfig();
    }
  }, [visible, connectionId]);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const res = await apiGet<ChannelConfig>(`/api/channels/${connectionId}/config`);
      setConfig(res);
      setPriceInput(String(res.priceAdjustmentPercent || 0));
      setInventoryInput(String(res.inventoryOffset || 0));
    } catch (e) {
      Alert.alert("Error", "Failed to load channel settings");
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const updateConfig = async (updates: Partial<ChannelConfig>) => {
    if (!config) return;
    setSaving(true);
    try {
      const res = await apiPatch<ChannelConfig>(`/api/channels/${connectionId}/config`, updates);
      setConfig(res);
      onSaved?.();
    } catch (e) {
      Alert.alert("Error", "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const handlePriceBlur = () => {
    const num = parseFloat(priceInput);
    if (!isNaN(num) && num >= -100 && num <= 100) {
      updateConfig({ priceAdjustmentPercent: num });
    } else {
      setPriceInput(String(config?.priceAdjustmentPercent ?? 0));
    }
  };

  const handleInventoryBlur = () => {
    const num = parseInt(inventoryInput, 10);
    if (!isNaN(num) && num >= 0) {
      updateConfig({ inventoryOffset: num });
    } else {
      setInventoryInput(String(config?.inventoryOffset ?? 0));
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Ionicons
              name={
                provider === "etsy"
                  ? "storefront-outline"
                  : provider === "ebay"
                  ? "pricetags-outline"
                  : provider === "shopify"
                  ? "bag-handle-outline"
                  : "globe-outline"
              }
              size={24}
              color={theme.colors.primary}
            />
            <Text style={styles.headerTitle}>{providerName} Settings</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={24} color="#6b7280" />
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator color={theme.colors.primary} size="large" />
          </View>
        ) : config ? (
          <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
            {/* Sync Direction */}
            <Text style={styles.sectionTitle}>Sync Direction</Text>
            <Text style={styles.sectionHint}>
              Control how data flows between INW and {providerName}
            </Text>
            <View style={styles.directionOptions}>
              {SYNC_DIRECTION_OPTIONS.map((opt) => (
                <Pressable
                  key={opt.value}
                  style={[
                    styles.directionOption,
                    config.syncDirection === opt.value && styles.directionOptionActive,
                  ]}
                  onPress={() => updateConfig({ syncDirection: opt.value })}
                  disabled={saving}
                >
                  <View style={styles.directionOptionHeader}>
                    <Ionicons
                      name={
                        config.syncDirection === opt.value
                          ? "radio-button-on"
                          : "radio-button-off"
                      }
                      size={20}
                      color={
                        config.syncDirection === opt.value
                          ? theme.colors.primary
                          : "#9ca3af"
                      }
                    />
                    <Text
                      style={[
                        styles.directionLabel,
                        config.syncDirection === opt.value && styles.directionLabelActive,
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </View>
                  <Text style={styles.directionDesc}>{opt.desc}</Text>
                </Pressable>
              ))}
            </View>

            {/* Auto Import */}
            <View style={styles.separator} />
            <View style={styles.toggleSection}>
              <View style={styles.toggleInfo}>
                <Text style={styles.sectionTitle}>Auto-Import New Listings</Text>
                <Text style={styles.sectionHint}>
                  Automatically create INW items when new listings appear on {providerName}
                </Text>
              </View>
              <Switch
                value={config.autoImportInbound}
                onValueChange={(val) => updateConfig({ autoImportInbound: val })}
                trackColor={{ false: "#d1d5db", true: theme.colors.primary }}
                thumbColor="#fff"
                disabled={saving}
              />
            </View>

            {/* Price Adjustment */}
            <View style={styles.separator} />
            <Text style={styles.sectionTitle}>Price Adjustment</Text>
            <Text style={styles.sectionHint}>
              Markup or markdown prices for this channel (e.g., +10% for eBay fees, -5% for sale)
            </Text>
            <View style={styles.priceInputContainer}>
              <TextInput
                style={styles.priceInput}
                value={priceInput}
                onChangeText={setPriceInput}
                onBlur={handlePriceBlur}
                keyboardType="numeric"
                placeholder="0"
                selectTextOnFocus
              />
              <Text style={styles.priceUnit}>%</Text>
            </View>
            <Text style={styles.priceExample}>
              {parseFloat(priceInput) > 0
                ? `$10.00 item → $${(10 * (1 + parseFloat(priceInput) / 100)).toFixed(2)} on ${providerName}`
                : parseFloat(priceInput) < 0
                ? `$10.00 item → $${(10 * (1 + parseFloat(priceInput) / 100)).toFixed(2)} on ${providerName}`
                : "No adjustment - same price on both platforms"}
            </Text>

            {/* Inventory Offset */}
            <View style={styles.separator} />
            <Text style={styles.sectionTitle}>Inventory Offset</Text>
            <Text style={styles.sectionHint}>
              Additional units to hold back for this channel (on top of global safety buffer)
            </Text>
            <View style={styles.inventoryInputContainer}>
              <Pressable
                style={styles.inventoryBtn}
                onPress={() => {
                  const num = parseInt(inventoryInput, 10) || 0;
                  if (num > 0) {
                    const newVal = num - 1;
                    setInventoryInput(String(newVal));
                    updateConfig({ inventoryOffset: newVal });
                  }
                }}
                disabled={saving || (parseInt(inventoryInput, 10) || 0) <= 0}
              >
                <Ionicons name="remove" size={20} color={theme.colors.primary} />
              </Pressable>
              <TextInput
                style={styles.inventoryInput}
                value={inventoryInput}
                onChangeText={setInventoryInput}
                onBlur={handleInventoryBlur}
                keyboardType="number-pad"
                selectTextOnFocus
              />
              <Pressable
                style={styles.inventoryBtn}
                onPress={() => {
                  const num = parseInt(inventoryInput, 10) || 0;
                  const newVal = num + 1;
                  setInventoryInput(String(newVal));
                  updateConfig({ inventoryOffset: newVal });
                }}
                disabled={saving}
              >
                <Ionicons name="add" size={20} color={theme.colors.primary} />
              </Pressable>
            </View>

            <View style={{ height: 40 }} />
          </ScrollView>
        ) : null}

        {saving && (
          <View style={styles.savingOverlay}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text style={styles.savingText}>Saving...</Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    backgroundColor: "#f9fafb",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: theme.colors.heading,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.heading,
  },
  sectionHint: {
    fontSize: 13,
    color: "#6b7280",
    marginTop: 4,
    marginBottom: 12,
  },
  separator: {
    height: 1,
    backgroundColor: "#e5e7eb",
    marginVertical: 20,
  },
  directionOptions: {
    gap: 10,
  },
  directionOption: {
    padding: 14,
    borderRadius: 10,
    backgroundColor: "#f9fafb",
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  directionOptionActive: {
    backgroundColor: "#f0f9ff",
    borderColor: theme.colors.primary,
  },
  directionOptionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  directionLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: theme.colors.heading,
  },
  directionLabelActive: {
    color: theme.colors.primary,
  },
  directionDesc: {
    fontSize: 13,
    color: "#6b7280",
    marginTop: 4,
    marginLeft: 30,
  },
  toggleSection: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  toggleInfo: {
    flex: 1,
    marginRight: 12,
  },
  priceInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  priceInput: {
    width: 80,
    height: 44,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 18,
    fontWeight: "600",
    textAlign: "center",
    color: theme.colors.heading,
    backgroundColor: "#fff",
  },
  priceUnit: {
    fontSize: 18,
    fontWeight: "500",
    color: "#6b7280",
  },
  priceExample: {
    fontSize: 13,
    color: "#6b7280",
    fontStyle: "italic",
    marginTop: 8,
  },
  inventoryInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  inventoryBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  inventoryInput: {
    width: 70,
    height: 44,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    textAlign: "center",
    fontSize: 18,
    fontWeight: "600",
    color: theme.colors.heading,
    backgroundColor: "#fff",
  },
  savingOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    backgroundColor: "rgba(255,255,255,0.95)",
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
  },
  savingText: {
    fontSize: 14,
    color: "#6b7280",
  },
});
