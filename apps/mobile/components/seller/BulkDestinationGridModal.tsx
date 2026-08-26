import React, { useEffect, useMemo, useState } from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  Image,
  ActivityIndicator,
} from "react-native";
import { theme } from "@/lib/theme";
import { CHANNEL_PROVIDER_LABEL } from "@/lib/channel-connections";
import {
  BULK_DESTINATION_COPY,
  UNSYNC_INW_NOTE,
  assignmentsFromGrid,
  columnChecked,
  destinationColumns,
  gridHasCheckedCell,
  hasUnsyncInw,
  initialGridRows,
  isProviderCellEnabled,
  setGridColumn,
  type BulkDestinationAction,
  type BulkDestinationGridItem,
  type ChannelProvider,
  type DestinationAssignment,
  type GridRowState,
} from "@/lib/store-item-bulk-destinations";

function CheckBox({
  checked,
  disabled,
  onPress,
}: {
  checked: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      style={[styles.check, checked && styles.checkOn, disabled && styles.checkDisabled]}
    >
      {checked ? <Text style={styles.checkMark}>✓</Text> : null}
    </Pressable>
  );
}

export function BulkDestinationGridModal({
  visible,
  action,
  items,
  connectedProviders,
  loading,
  onClose,
  onApply,
}: {
  visible: boolean;
  action: BulkDestinationAction;
  items: BulkDestinationGridItem[];
  connectedProviders: string[];
  loading?: boolean;
  onClose: () => void;
  onApply: (assignments: DestinationAssignment[]) => void | Promise<void>;
}) {
  const connectedKey = connectedProviders.join("|");
  const columns = useMemo(() => destinationColumns(connectedProviders), [connectedKey]);
  const itemKey = items.map((item) => item.id).join("|");
  const [rows, setRows] = useState<GridRowState[]>(() => initialGridRows(action, items, columns));

  useEffect(() => {
    if (visible) setRows(initialGridRows(action, items, columns));
  }, [visible, action, itemKey, columns]);

  const copy = BULK_DESTINATION_COPY[action];
  const unsyncNote = hasUnsyncInw(action, rows);
  const canApply = action === "sync" || gridHasCheckedCell(rows);

  function toggleInw(index: number) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, inw: !row.inw } : row)));
  }

  function toggleProvider(index: number, provider: ChannelProvider) {
    const item = items[index];
    if (!item || !isProviderCellEnabled(action, item, provider)) return;
    setRows((prev) =>
      prev.map((row, i) =>
        i === index
          ? { ...row, providers: { ...row.providers, [provider]: !row.providers[provider] } }
          : row
      )
    );
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.wrap}>
        <View style={styles.header}>
          <Text style={styles.title}>{copy.title}</Text>
          <Pressable onPress={onClose} disabled={loading}>
            <Text style={styles.close}>Cancel</Text>
          </Pressable>
        </View>
        <Text style={styles.body}>{copy.body}</Text>
        <ScrollView horizontal style={styles.tableScroll} contentContainerStyle={{ minWidth: 520 }}>
          <View style={{ flex: 1 }}>
            <View style={styles.row}>
              <Text style={[styles.itemCell, styles.headText]}>Item</Text>
              {columns.map((provider) => (
                <View key={provider} style={styles.col}>
                  <Text style={styles.headText}>{CHANNEL_PROVIDER_LABEL[provider]}</Text>
                  <CheckBox
                    checked={columnChecked(rows, items, provider, action)}
                    onPress={() =>
                      setRows((prev) =>
                        setGridColumn(prev, items, provider, !columnChecked(prev, items, provider, action), action)
                      )
                    }
                  />
                </View>
              ))}
              <View style={styles.col}>
                <Text style={styles.headText}>INW</Text>
                <CheckBox
                  checked={columnChecked(rows, items, "inw", action)}
                  onPress={() =>
                    setRows((prev) => setGridColumn(prev, items, "inw", !columnChecked(prev, items, "inw", action), action))
                  }
                />
              </View>
            </View>
            <ScrollView>
              {items.map((item, index) => {
                const row = rows[index];
                if (!row) return null;
                return (
                  <View key={item.id} style={styles.row}>
                    <View style={[styles.itemCell, styles.itemInfo]}>
                      {item.photos[0] ? (
                        <Image source={{ uri: item.photos[0] }} style={styles.thumb} />
                      ) : (
                        <View style={[styles.thumb, styles.thumbEmpty]} />
                      )}
                      <Text style={styles.itemTitle} numberOfLines={2}>
                        {item.title}
                      </Text>
                    </View>
                    {columns.map((provider) => (
                      <View key={provider} style={styles.col}>
                        <CheckBox
                          checked={Boolean(row.providers[provider])}
                          disabled={!isProviderCellEnabled(action, item, provider)}
                          onPress={() => toggleProvider(index, provider)}
                        />
                      </View>
                    ))}
                    <View style={styles.col}>
                      <CheckBox checked={row.inw} onPress={() => toggleInw(index)} />
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </ScrollView>
        {unsyncNote ? <Text style={styles.warning}>{UNSYNC_INW_NOTE}</Text> : null}
        <Pressable
          style={[styles.apply, (!canApply || loading) && { opacity: 0.5 }]}
          disabled={!canApply || loading}
          onPress={() => void onApply(assignmentsFromGrid(rows))}
        >
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.applyText}>{copy.apply}</Text>}
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "#fff", paddingBottom: 24 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 12,
  },
  title: { flex: 1, fontSize: 16, fontWeight: "700", color: theme.colors.heading, textTransform: "uppercase" },
  close: { fontSize: 16, color: theme.colors.primary, fontWeight: "600" },
  body: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, fontSize: 13, color: "#444", lineHeight: 18 },
  tableScroll: { flex: 1 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  itemCell: { width: 180, paddingRight: 8 },
  itemInfo: { flexDirection: "row", alignItems: "center", gap: 8 },
  thumb: { width: 36, height: 36, borderRadius: 6, backgroundColor: "#ddd" },
  thumbEmpty: { backgroundColor: "#ddd" },
  itemTitle: { flex: 1, fontSize: 13, fontWeight: "600", color: theme.colors.heading },
  col: { width: 72, alignItems: "center", gap: 6 },
  headText: { fontSize: 12, fontWeight: "700", color: theme.colors.heading, textAlign: "center" },
  check: {
    width: 22,
    height: 22,
    borderWidth: 2,
    borderColor: "#ccc",
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  checkOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  checkDisabled: { opacity: 0.3 },
  checkMark: { color: "#fff", fontSize: 14, fontWeight: "700" },
  warning: {
    marginHorizontal: 16,
    marginTop: 8,
    padding: 12,
    backgroundColor: "#fffbeb",
    color: "#92400e",
    fontSize: 13,
    lineHeight: 18,
    borderRadius: 8,
  },
  apply: {
    marginHorizontal: 16,
    marginTop: 12,
    backgroundColor: theme.colors.primary,
    minHeight: 48,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  applyText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
