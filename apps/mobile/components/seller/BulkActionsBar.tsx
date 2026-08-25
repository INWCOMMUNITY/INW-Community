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
import {
  CHANNEL_PROVIDER_LABEL,
  publishReadyConnections,
  type ChannelConnectionSummary,
} from "@/lib/channel-connections";
import { ListOnChannelCategoryModal } from "@/components/channels/ListOnChannelCategoryModal";
import {
  buildListOnCategoryQueue,
  type ListOnCategoryAssignment,
} from "@/lib/list-on-channel-category";

type ItemsTab = "active" | "ended" | "sold";

type BulkItem = {
  id: string;
  title: string;
  photos: string[];
  etsyTaxonomyId?: number | null;
  ebayCategoryId?: number | null;
  etsyWhoMade?: string | null;
  etsyWhenMade?: string | null;
  channelLinks?: { provider: string }[];
};

interface BulkActionsBarProps {
  selectedIds: string[];
  selectedItems: BulkItem[];
  tab: ItemsTab;
  connections: ChannelConnectionSummary[];
  onClearSelection: () => void;
  onActionComplete: () => void;
}

function itemsMissingProvider(items: BulkItem[], provider: string): BulkItem[] {
  return items.filter((item) => !(item.channelLinks ?? []).some((l) => l.provider === provider));
}

export function BulkActionsBar({
  selectedIds,
  selectedItems,
  tab,
  connections,
  onClearSelection,
  onActionComplete,
}: BulkActionsBarProps) {
  const [loading, setLoading] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [priceChangePercent, setPriceChangePercent] = useState("");
  const [quantityAdjust, setQuantityAdjust] = useState("");
  const [syncAfterEdit, setSyncAfterEdit] = useState(true);
  const [selectedProviders, setSelectedProviders] = useState<string[]>([]);
  const [pendingProviders, setPendingProviders] = useState<string[]>([]);
  const [categorySteps, setCategorySteps] = useState<ReturnType<typeof buildListOnCategoryQueue>>([]);

  const readyProviders = publishReadyConnections(connections);
  const listOnChannels = readyProviders
    .map((c) => ({ ...c, missing: itemsMissingProvider(selectedItems, c.provider) }))
    .filter((c) => c.missing.length > 0);

  if (selectedIds.length === 0) return null;

  const resetEditForm = () => {
    setPriceChangePercent("");
    setQuantityAdjust("");
    setSyncAfterEdit(true);
  };

  const handleBulkEdit = async () => {
    if (!priceChangePercent && !quantityAdjust) {
      Alert.alert("No Changes", "Enter a price change percent and/or quantity adjustment.");
      return;
    }

    setLoading(true);
    try {
      const updates: Record<string, unknown> = {};
      if (priceChangePercent) updates.priceChangePercent = parseFloat(priceChangePercent);
      if (quantityAdjust) updates.quantityAdjust = parseInt(quantityAdjust, 10);

      const result = await apiPatch<{
        updated: number;
        failed: number;
      }>("/api/store-items/bulk", {
        storeItemIds: selectedIds,
        updates,
        syncToChannels: syncAfterEdit,
      });

      setShowEditModal(false);
      resetEditForm();

      if (result.failed > 0) {
        Alert.alert("Partial Success", `Updated ${result.updated} items. ${result.failed} failed.`);
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

  const applyPublish = async (providers: string[], assignments?: ListOnCategoryAssignment[]) => {
    if (providers.length === 0) {
      Alert.alert("Select Channels", "Select at least one channel to list on.");
      return;
    }
    const queue = buildListOnCategoryQueue(selectedItems, providers);
    if (!assignments && queue.length > 0) {
      setPendingProviders(providers);
      setShowPublishModal(false);
      setCategorySteps(queue);
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
        providers,
        validateFirst: true,
        skipInvalid: true,
        ...(assignments?.length ? { assignments } : {}),
      });

      setShowPublishModal(false);
      setSelectedProviders([]);
      setPendingProviders([]);
      setCategorySteps([]);

      const message = [
        `Listed: ${result.published}`,
        result.failed > 0 ? `Failed: ${result.failed}` : null,
        result.skipped > 0 ? `Skipped: ${result.skipped}` : null,
      ]
        .filter(Boolean)
        .join("\n");

      Alert.alert("List on channel", message);
      onActionComplete();
      onClearSelection();
    } catch (e) {
      const msg = (e as { error?: string })?.error || "Bulk publish failed";
      Alert.alert("Error", msg);
      if (assignments) throw new Error(msg);
    } finally {
      setLoading(false);
    }
  };

  const listOnProvider = (provider: string, missingCount: number) => {
    const label = CHANNEL_PROVIDER_LABEL[provider as keyof typeof CHANNEL_PROVIDER_LABEL] ?? provider;
    Alert.alert(
      `List on ${label}?`,
      `List ${missingCount} item${missingCount === 1 ? "" : "s"} on ${label}? Items already on ${label} will be skipped.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "List", onPress: () => void applyPublish([provider]) },
      ]
    );
  };

  const handleBulkEnd = () => {
    Alert.alert(
      "End listings",
      `End ${selectedIds.length} listing${selectedIds.length === 1 ? "" : "s"}? They will move to Ended.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "End",
          onPress: async () => {
            setLoading(true);
            try {
              const result = await apiPatch<{ updated: number; failed: number }>("/api/store-items/bulk", {
                storeItemIds: selectedIds,
                updates: { status: "inactive" },
                syncToChannels: true,
              });
              if (result.failed > 0) {
                Alert.alert("Partial Success", `Ended ${result.updated}. ${result.failed} failed.`);
              }
              onActionComplete();
              onClearSelection();
            } catch (e) {
              Alert.alert("Error", (e as { error?: string })?.error || "Bulk end failed");
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleBulkRelist = () => {
    Alert.alert(
      "Relist items",
      `Relist ${selectedIds.length} item${selectedIds.length === 1 ? "" : "s"} with quantity 1 each?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Relist",
          onPress: async () => {
            setLoading(true);
            try {
              const result = await apiPost<{ relisted?: number }>("/api/store-items/bulk-relist", {
                storeItemIds: selectedIds,
                quantity: 1,
                republishChannels: false,
              });
              Alert.alert("Relisted", `Relisted ${result.relisted ?? selectedIds.length} item(s).`);
              onActionComplete();
              onClearSelection();
            } catch (e) {
              Alert.alert("Error", (e as { error?: string })?.error || "Bulk relist failed");
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleBulkUnpublish = () => {
    Alert.alert(
      "Unlink stores",
      `Unlink ${selectedIds.length} items from all connected channels?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unlink",
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

  const handleBulkDelete = () => {
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
          {tab !== "sold" &&
            listOnChannels.map((c) => (
              <Pressable
                key={c.provider}
                style={[styles.actionBtn, styles.primaryBtn, loading && styles.actionBtnDisabled]}
                onPress={() => listOnProvider(c.provider, c.missing.length)}
                disabled={loading}
              >
                <Text style={styles.primaryBtnText}>
                  List on {CHANNEL_PROVIDER_LABEL[c.provider]}
                  {c.missing.length !== selectedIds.length ? ` (${c.missing.length})` : ""}
                </Text>
              </Pressable>
            ))}
          {tab !== "sold" && listOnChannels.length > 1 && (
            <Pressable
              style={[styles.actionBtn, loading && styles.actionBtnDisabled]}
              onPress={() => {
                setSelectedProviders(listOnChannels.map((c) => c.provider));
                setShowPublishModal(true);
              }}
              disabled={loading}
            >
              <Text style={styles.actionBtnText}>List on multiple</Text>
            </Pressable>
          )}
          {tab === "active" && (
            <>
              <Pressable
                style={[styles.actionBtn, loading && styles.actionBtnDisabled]}
                onPress={handleBulkEnd}
                disabled={loading}
              >
                <Text style={styles.actionBtnText}>End</Text>
              </Pressable>
              <Pressable
                style={[styles.actionBtn, loading && styles.actionBtnDisabled]}
                onPress={() => setShowEditModal(true)}
                disabled={loading}
              >
                <Text style={styles.actionBtnText}>Price / qty</Text>
              </Pressable>
              <Pressable
                style={[styles.actionBtn, loading && styles.actionBtnDisabled]}
                onPress={handleBulkUnpublish}
                disabled={loading}
              >
                <Text style={styles.actionBtnText}>Unlink</Text>
              </Pressable>
            </>
          )}
          {(tab === "ended" || tab === "sold") && (
            <Pressable
              style={[styles.actionBtn, loading && styles.actionBtnDisabled]}
              onPress={handleBulkRelist}
              disabled={loading}
            >
              <Text style={styles.actionBtnText}>Relist</Text>
            </Pressable>
          )}
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

      <Modal visible={showEditModal} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Edit {selectedIds.length} Items</Text>
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

            <Pressable style={styles.checkboxRow} onPress={() => setSyncAfterEdit(!syncAfterEdit)}>
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
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Apply Changes</Text>}
            </Pressable>
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={showPublishModal} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>List {selectedIds.length} Items</Text>
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
            <Text style={styles.fieldLabel}>Select channels. Items already listed there are skipped.</Text>

            {listOnChannels.map((c) => (
              <Pressable key={c.provider} style={styles.providerRow} onPress={() => toggleProvider(c.provider)}>
                <View
                  style={[styles.checkbox, selectedProviders.includes(c.provider) && styles.checkboxChecked]}
                >
                  {selectedProviders.includes(c.provider) && <Text style={styles.checkmark}>✓</Text>}
                </View>
                <Text style={styles.providerLabel}>
                  {CHANNEL_PROVIDER_LABEL[c.provider]} · {c.missing.length} to list
                </Text>
              </Pressable>
            ))}

            <Pressable
              style={[styles.submitBtn, loading && { opacity: 0.5 }]}
              onPress={() => void applyPublish(selectedProviders)}
              disabled={loading}
            >
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>List</Text>}
            </Pressable>
          </ScrollView>
        </View>
      </Modal>

      <ListOnChannelCategoryModal
        visible={categorySteps.length > 0}
        steps={categorySteps}
        onClose={() => {
          setCategorySteps([]);
          setPendingProviders([]);
        }}
        onComplete={(assignments) => applyPublish(pendingProviders, assignments)}
      />
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
    fontWeight: "700",
    color: "#333",
  },
  clearText: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.primary,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  actionBtn: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: "#f0f0f0",
    alignItems: "center",
  },
  primaryBtn: {
    backgroundColor: theme.colors.primary,
  },
  actionBtnDisabled: {
    opacity: 0.5,
  },
  actionBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#333",
  },
  primaryBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#fff",
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
