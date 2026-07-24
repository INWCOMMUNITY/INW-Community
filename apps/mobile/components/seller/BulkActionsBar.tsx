import React, { useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Modal,
  ActivityIndicator,
  TextInput,
  Alert,
  ScrollView,
} from "react-native";
import { theme } from "@/lib/theme";
import { apiPatch, apiPost, apiDelete } from "@/lib/api";

interface BulkActionsBarProps {
  selectedIds: string[];
  onClearSelection: () => void;
  onActionComplete: () => void;
  connectedProviders?: string[];
}

type BulkAction = "edit" | "publish" | "unpublish" | "delete";

export function BulkActionsBar({
  selectedIds,
  onClearSelection,
  onActionComplete,
  connectedProviders = [],
}: BulkActionsBarProps) {
  const [loading, setLoading] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);

  // Edit form state
  const [priceChangePercent, setPriceChangePercent] = useState("");
  const [quantityAdjust, setQuantityAdjust] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [syncAfterEdit, setSyncAfterEdit] = useState(true);

  // Publish state
  const [selectedProviders, setSelectedProviders] = useState<string[]>([]);

  if (selectedIds.length === 0) return null;

  const handleBulkEdit = async () => {
    if (!priceChangePercent && !quantityAdjust && category === null) {
      Alert.alert("No Changes", "Select at least one field to update.");
      return;
    }

    setLoading(true);
    try {
      const updates: Record<string, unknown> = {};
      if (priceChangePercent) {
        updates.priceChangePercent = parseFloat(priceChangePercent);
      }
      if (quantityAdjust) {
        updates.quantityAdjust = parseInt(quantityAdjust, 10);
      }
      if (category !== null) {
        updates.category = category || null;
      }

      const result = await apiPatch<{
        updated: number;
        failed: number;
        errors: { itemId: string; error: string }[];
      }>("/api/store-items/bulk", {
        storeItemIds: selectedIds,
        updates,
        syncToChannels: syncAfterEdit,
      });

      setShowEditModal(false);
      resetEditForm();

      if (result.failed > 0) {
        Alert.alert(
          "Partial Success",
          `Updated ${result.updated} items. ${result.failed} failed.`
        );
      } else {
        Alert.alert("Success", `Updated ${result.updated} items.`);
      }

      onActionComplete();
      onClearSelection();
    } catch (e) {
      Alert.alert("Error", (e as { error?: string })?.error || "Bulk edit failed");
    } finally {
      setLoading(false);
    }
  };

  const handleBulkPublish = async () => {
    if (selectedProviders.length === 0) {
      Alert.alert("Select Channels", "Select at least one channel to publish to.");
      return;
    }

    setLoading(true);
    try {
      const result = await apiPost<{
        published: number;
        failed: number;
        skipped: number;
      }>("/api/store-items/bulk-publish", {
        storeItemIds: selectedIds,
        providers: selectedProviders,
        validateFirst: true,
        skipInvalid: true,
      });

      setShowPublishModal(false);
      setSelectedProviders([]);

      const message = [
        `Published: ${result.published}`,
        result.failed > 0 ? `Failed: ${result.failed}` : null,
        result.skipped > 0 ? `Skipped: ${result.skipped}` : null,
      ]
        .filter(Boolean)
        .join("\n");

      Alert.alert("Bulk Publish Complete", message);
      onActionComplete();
      onClearSelection();
    } catch (e) {
      Alert.alert("Error", (e as { error?: string })?.error || "Bulk publish failed");
    } finally {
      setLoading(false);
    }
  };

  const handleBulkUnpublish = async () => {
    Alert.alert(
      "Unpublish Items",
      `Unlink ${selectedIds.length} items from all connected channels?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unpublish",
          style: "destructive",
          onPress: async () => {
            setLoading(true);
            try {
              const result = await apiPost<{
                unpublished: number;
                failed: number;
              }>("/api/store-items/bulk-unpublish", {
                storeItemIds: selectedIds,
              });

              Alert.alert("Success", `Unpublished ${result.unpublished} items.`);
              onActionComplete();
              onClearSelection();
            } catch (e) {
              Alert.alert("Error", (e as { error?: string })?.error || "Bulk unpublish failed");
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleBulkDelete = async () => {
    Alert.alert(
      "Delete Items",
      `Permanently delete ${selectedIds.length} items? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setLoading(true);
            try {
              const result = await apiDelete<{ deleted: number }>("/api/store-items/bulk", {
                storeItemIds: selectedIds,
              });

              Alert.alert("Success", `Deleted ${result.deleted} items.`);
              onActionComplete();
              onClearSelection();
            } catch (e) {
              Alert.alert("Error", (e as { error?: string })?.error || "Bulk delete failed");
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  const resetEditForm = () => {
    setPriceChangePercent("");
    setQuantityAdjust("");
    setCategory(null);
    setSyncAfterEdit(true);
  };

  const toggleProvider = (provider: string) => {
    setSelectedProviders((prev) =>
      prev.includes(provider) ? prev.filter((p) => p !== provider) : [...prev, provider]
    );
  };

  return (
    <>
      <View style={styles.bar}>
        <View style={styles.selectionInfo}>
          <Text style={styles.selectionCount}>{selectedIds.length} selected</Text>
          <Pressable onPress={onClearSelection}>
            <Text style={styles.clearText}>Clear</Text>
          </Pressable>
        </View>

        <View style={styles.actions}>
          <Pressable
            style={[styles.actionBtn, loading && styles.actionBtnDisabled]}
            onPress={() => setShowEditModal(true)}
            disabled={loading}
          >
            <Text style={styles.actionBtnText}>Edit</Text>
          </Pressable>

          {connectedProviders.length > 0 && (
            <Pressable
              style={[styles.actionBtn, loading && styles.actionBtnDisabled]}
              onPress={() => setShowPublishModal(true)}
              disabled={loading}
            >
              <Text style={styles.actionBtnText}>Publish</Text>
            </Pressable>
          )}

          <Pressable
            style={[styles.actionBtn, loading && styles.actionBtnDisabled]}
            onPress={handleBulkUnpublish}
            disabled={loading}
          >
            <Text style={styles.actionBtnText}>Unpublish</Text>
          </Pressable>

          <Pressable
            style={[styles.actionBtn, styles.deleteBtn, loading && styles.actionBtnDisabled]}
            onPress={handleBulkDelete}
            disabled={loading}
          >
            <Text style={[styles.actionBtnText, styles.deleteBtnText]}>Delete</Text>
          </Pressable>
        </View>

        {loading && <ActivityIndicator style={styles.loader} color={theme.colors.primary} />}
      </View>

      {/* Edit Modal */}
      <Modal visible={showEditModal} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Bulk Edit {selectedIds.length} Items</Text>
            <Pressable
              onPress={() => {
                setShowEditModal(false);
                resetEditForm();
              }}
            >
              <Text style={styles.modalClose}>Cancel</Text>
            </Pressable>
          </View>

          <ScrollView style={styles.modalContent}>
            <Text style={styles.fieldLabel}>Price Change (%)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. -10 for 10% discount, 20 for 20% increase"
              placeholderTextColor="#999"
              value={priceChangePercent}
              onChangeText={setPriceChangePercent}
              keyboardType="numeric"
            />

            <Text style={styles.fieldLabel}>Quantity Adjustment</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 5 to add 5, -3 to remove 3"
              placeholderTextColor="#999"
              value={quantityAdjust}
              onChangeText={setQuantityAdjust}
              keyboardType="numeric"
            />

            <Text style={styles.fieldLabel}>Category (leave empty to skip)</Text>
            <TextInput
              style={styles.input}
              placeholder="New category for all items"
              placeholderTextColor="#999"
              value={category ?? ""}
              onChangeText={(t) => setCategory(t || null)}
            />

            <Pressable
              style={styles.checkboxRow}
              onPress={() => setSyncAfterEdit(!syncAfterEdit)}
            >
              <View style={[styles.checkbox, syncAfterEdit && styles.checkboxChecked]}>
                {syncAfterEdit && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <Text style={styles.checkboxLabel}>Sync changes to connected channels</Text>
            </Pressable>

            <Pressable
              style={[styles.submitBtn, loading && { opacity: 0.5 }]}
              onPress={handleBulkEdit}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitBtnText}>Apply Changes</Text>
              )}
            </Pressable>
          </ScrollView>
        </View>
      </Modal>

      {/* Publish Modal */}
      <Modal visible={showPublishModal} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Publish {selectedIds.length} Items</Text>
            <Pressable
              onPress={() => {
                setShowPublishModal(false);
                setSelectedProviders([]);
              }}
            >
              <Text style={styles.modalClose}>Cancel</Text>
            </Pressable>
          </View>

          <ScrollView style={styles.modalContent}>
            <Text style={styles.fieldLabel}>Select channels to publish to:</Text>

            {connectedProviders.map((provider) => (
              <Pressable
                key={provider}
                style={styles.providerRow}
                onPress={() => toggleProvider(provider)}
              >
                <View
                  style={[
                    styles.checkbox,
                    selectedProviders.includes(provider) && styles.checkboxChecked,
                  ]}
                >
                  {selectedProviders.includes(provider) && (
                    <Text style={styles.checkmark}>✓</Text>
                  )}
                </View>
                <Text style={styles.providerLabel}>
                  {provider.charAt(0).toUpperCase() + provider.slice(1)}
                </Text>
              </Pressable>
            ))}

            <Text style={styles.hint}>
              Items that don't pass validation for a channel will be skipped.
            </Text>

            <Pressable
              style={[styles.submitBtn, loading && { opacity: 0.5 }]}
              onPress={handleBulkPublish}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitBtnText}>Publish to Selected Channels</Text>
              )}
            </Pressable>
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#e0e0e0",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 32,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 5,
  },
  selectionInfo: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  selectionCount: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
  },
  clearText: {
    fontSize: 14,
    color: theme.colors.primary,
  },
  actions: {
    flexDirection: "row",
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: "#f0f0f0",
    alignItems: "center",
  },
  actionBtnDisabled: {
    opacity: 0.5,
  },
  actionBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#333",
  },
  deleteBtn: {
    backgroundColor: "#fee2e2",
  },
  deleteBtnText: {
    color: "#dc2626",
  },
  loader: {
    position: "absolute",
    right: 16,
    top: 12,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: "#fff",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#000",
  },
  modalClose: {
    fontSize: 16,
    color: theme.colors.primary,
  },
  modalContent: {
    flex: 1,
    padding: 16,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
    marginBottom: 8,
    marginTop: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: "#000",
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 20,
    marginBottom: 8,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 2,
    borderColor: "#ccc",
    borderRadius: 4,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
  },
  checkboxChecked: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  checkmark: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  checkboxLabel: {
    fontSize: 14,
    color: "#333",
  },
  providerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  providerLabel: {
    fontSize: 16,
    color: "#333",
  },
  hint: {
    fontSize: 13,
    color: "#666",
    marginTop: 16,
    lineHeight: 18,
  },
  submitBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 24,
  },
  submitBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
