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
import { apiPatch, apiPost } from "@/lib/api";
import {
  CHANNEL_PROVIDER_LABEL,
  listOnConnections,
  type ChannelConnectionSummary,
} from "@/lib/channel-connections";
import { ListOnChannelCategoryModal } from "@/components/channels/ListOnChannelCategoryModal";
import { BulkDestinationGridModal } from "@/components/seller/BulkDestinationGridModal";
import {
  buildListOnCategoryQueueFromDesired,
  buildListOnCategoryQueueFromFailedSpecifics,
  isMissingEbayItemSpecificsError,
  type ListOnCategoryAssignment,
} from "@/lib/list-on-channel-category";
import {
  desiredProvidersByItemId,
  bulkDestinationFailTitle,
  summarizeBulkDestinations,
  uniqueLinkedShopNames,
  hasLinkedChannelListings,
  endOnInwConfirm,
  endOnInwResult,
  type BulkDestinationAction,
  type BulkDestinationsResultCounts,
  type DestinationAssignment,
} from "@/lib/store-item-bulk-destinations";

type ItemsTab = "active" | "attention" | "ended" | "sold";

type BulkItem = {
  id: string;
  title: string;
  photos: string[];
  etsyTaxonomyId?: number | null;
  ebayCategoryId?: number | null;
  etsyWhoMade?: string | null;
  etsyWhenMade?: string | null;
  aspects?: { name: string; value: string }[] | unknown;
  channelLinks?: { provider: string; remoteDeletedProvider?: string | null }[];
};

interface BulkActionsBarProps {
  selectedIds: string[];
  selectedItems: BulkItem[];
  tab: ItemsTab;
  connections: ChannelConnectionSummary[];
  onClearSelection: () => void;
  onActionComplete: () => void;
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
  const [gridAction, setGridAction] = useState<BulkDestinationAction | null>(null);
  const [priceChangePercent, setPriceChangePercent] = useState("");
  const [quantityAdjust, setQuantityAdjust] = useState("");
  const [syncAfterEdit, setSyncAfterEdit] = useState(true);
  const [pendingAssignments, setPendingAssignments] = useState<DestinationAssignment[] | null>(null);
  const [categorySteps, setCategorySteps] = useState<ReturnType<typeof buildListOnCategoryQueueFromDesired>>([]);

  const connected = listOnConnections(connections);
  const connectedProviders = connected.map((c) => c.provider);
  const missingHints = connected
    .map((c) => {
      const missing = selectedItems.filter(
        (item) =>
          !(item.channelLinks ?? []).some((l) => l.provider === c.provider && !l.remoteDeletedProvider)
      ).length;
      return missing > 0 ? `${missing} not on ${CHANNEL_PROVIDER_LABEL[c.provider]}` : null;
    })
    .filter(Boolean)
    .join(" · ");

  if (selectedIds.length === 0) return null;

  const resetEditForm = () => {
    setPriceChangePercent("");
    setQuantityAdjust("");
    setSyncAfterEdit(true);
  };

  const handleBulkEdit = async () => {
    if (!priceChangePercent && !quantityAdjust) {
      Alert.alert("Nothing To Apply", "Add a price change percent and/or a quantity adjustment first.");
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
        Alert.alert("Updated Some, Missed Some", `Updated ${result.updated}. ${result.failed} didn't go through.`);
      } else {
        Alert.alert("Numbers Updated", `Updated ${result.updated} item${result.updated === 1 ? "" : "s"}.`);
      }

      onActionComplete();
      onClearSelection();
    } catch (e) {
      Alert.alert("Couldn't Apply That Edit", (e as { error?: string })?.error || "Bulk edit didn't go through.");
    } finally {
      setLoading(false);
    }
  };

  const applyDestinations = async (
    action: BulkDestinationAction,
    assignments: DestinationAssignment[],
    categoryAssignments?: ListOnCategoryAssignment[]
  ) => {
    if (action === "sync" && !categoryAssignments) {
      const queue = buildListOnCategoryQueueFromDesired(selectedItems, desiredProvidersByItemId(assignments));
      if (queue.length > 0) {
        setPendingAssignments(assignments);
        setGridAction(null);
        setCategorySteps(queue);
        return;
      }
    }
    setLoading(true);
    try {
      const result = await apiPost<BulkDestinationsResultCounts>("/api/store-items/bulk-destinations", {
        action,
        items: assignments,
        ...(categoryAssignments?.length ? { assignments: categoryAssignments } : {}),
      });
      const failedSpecificIds = (result.results ?? [])
        .filter((row) => row.status === "failed" && isMissingEbayItemSpecificsError(row.detail))
        .map((row) => row.itemId);
      if (action === "sync" && failedSpecificIds.length > 0 && !categoryAssignments) {
        const queue = buildListOnCategoryQueueFromFailedSpecifics(selectedItems, failedSpecificIds);
        if (queue.length > 0) {
          setPendingAssignments(assignments);
          setGridAction(null);
          setCategorySteps(queue);
          return;
        }
      }
      const summary = summarizeBulkDestinations(action, result);
      Alert.alert(summary.title, summary.message);
      setGridAction(null);
      setCategorySteps([]);
      setPendingAssignments(null);
      onActionComplete();
      onClearSelection();
    } catch (e) {
      const msg = (e as { error?: string })?.error || "Update failed";
      Alert.alert(bulkDestinationFailTitle(action), msg);
      if (categoryAssignments) throw new Error(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleEndListings = () => {
    if (hasLinkedChannelListings(selectedItems)) {
      setGridAction("end");
      return;
    }
    const shopNames = uniqueLinkedShopNames(selectedItems, CHANNEL_PROVIDER_LABEL);
    Alert.alert("End Listings", endOnInwConfirm(selectedIds.length, shopNames), [
      { text: "Cancel", style: "cancel" },
      {
        text: "End on INW",
        style: "destructive",
        onPress: async () => {
          setLoading(true);
          try {
            const result = await apiPatch<{ updated: number; failed: number }>("/api/store-items/bulk", {
              storeItemIds: selectedIds,
              updates: { status: "inactive" },
              syncToChannels: false,
            });
            const summary = endOnInwResult(result.updated, result.failed, shopNames);
            Alert.alert(summary.title, summary.message);
            onActionComplete();
            onClearSelection();
          } catch (e) {
            Alert.alert("Couldn't End Those Listings", (e as { error?: string })?.error || "End didn't go through.");
          } finally {
            setLoading(false);
          }
        },
      },
    ]);
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
              const n = result.relisted ?? selectedIds.length;
              Alert.alert("Back On The Floor", `Relisted ${n} item${n === 1 ? "" : "s"} with quantity 1.`);
              onActionComplete();
              onClearSelection();
            } catch (e) {
              Alert.alert("Couldn't Relist", (e as { error?: string })?.error || "Relist didn't go through.");
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  return (
    <>
      <View style={styles.trayWrap} pointerEvents="box-none">
        <View style={styles.bar}>
          <View style={styles.selectionInfo}>
            <View style={styles.selectionCopy}>
              <Text style={styles.selectionCount}>{selectedIds.length} selected</Text>
              {missingHints ? <Text style={styles.hintText}>{missingHints}</Text> : null}
            </View>
            <Pressable onPress={onClearSelection} hitSlop={8}>
              <Text style={styles.clearText}>Clear</Text>
            </Pressable>
          </View>

          <View style={styles.actions}>
            {tab !== "sold" && (
              <Pressable
                style={[styles.actionBtn, styles.primaryBtn, styles.actionBtnWide, loading && styles.actionBtnDisabled]}
                onPress={() => setGridAction("sync")}
                disabled={loading}
              >
                <Text style={styles.primaryBtnText}>Manage Listings</Text>
              </Pressable>
            )}
            {tab === "active" && (
              <>
                <Pressable
                  style={[styles.actionBtn, loading && styles.actionBtnDisabled]}
                  onPress={handleEndListings}
                  disabled={loading}
                >
                  <Text style={styles.actionBtnText}>End Listings</Text>
                </Pressable>
                <Pressable
                  style={[styles.actionBtn, loading && styles.actionBtnDisabled]}
                  onPress={() => setShowEditModal(true)}
                  disabled={loading}
                >
                  <Text style={styles.actionBtnText}>Price / Quantity</Text>
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
          </View>

          {loading && <ActivityIndicator style={styles.loader} color={theme.colors.primary} />}
        </View>
      </View>

      <BulkDestinationGridModal
        visible={gridAction != null}
        action={gridAction ?? "sync"}
        items={selectedItems}
        connectedProviders={connectedProviders}
        loading={loading}
        onClose={() => setGridAction(null)}
        onApply={(assignments) => {
          if (!gridAction) return;
          return applyDestinations(gridAction, assignments);
        }}
      />

      <Modal visible={showEditModal} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Price / Quantity</Text>
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

      <ListOnChannelCategoryModal
        visible={categorySteps.length > 0}
        steps={categorySteps}
        onClose={() => {
          setCategorySteps([]);
          setPendingAssignments(null);
        }}
        onComplete={(assignments) => {
          if (!pendingAssignments) return Promise.resolve();
          return applyDestinations("sync", pendingAssignments, assignments);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  trayWrap: {
    position: "absolute",
    bottom: 12,
    left: 12,
    right: 12,
  },
  bar: {
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
    shadowColor: "#3E432F",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 16,
    elevation: 8,
  },
  selectionInfo: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
    gap: 12,
  },
  selectionCopy: {
    flex: 1,
  },
  selectionCount: {
    fontSize: 16,
    fontWeight: "700",
    color: theme.colors.heading,
  },
  hintText: {
    fontSize: 12,
    color: "#666",
    marginTop: 4,
  },
  clearText: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.primary,
    paddingTop: 2,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  actionBtn: {
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: "#ddd",
    alignItems: "center",
    justifyContent: "center",
    flexGrow: 1,
    flexBasis: "47%",
  },
  actionBtnWide: {
    flexBasis: "100%",
  },
  primaryBtn: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
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
