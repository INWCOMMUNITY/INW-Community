import { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Alert,
  ActivityIndicator,
  Share,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import { isAvailableAsync, shareAsync } from "expo-sharing";
import { useAuth } from "@/contexts/AuthContext";
import { apiGet, apiPost, getToken } from "@/lib/api";
import { theme } from "@/lib/theme";

type ExportType = "listings" | "orders" | "activity" | "sync-log";

interface BulkSnapshot {
  id: string;
  operation: string;
  itemCount: number;
  canUndo: boolean;
  undoneAt: string | null;
  expiresAt: string;
  createdAt: string;
  isExpired: boolean;
  itemTitles?: string[];
}

const EXPORT_TYPES: { type: ExportType; label: string; icon: keyof typeof Ionicons.glyphMap; description: string }[] = [
  { type: "listings", label: "Listings", icon: "pricetag-outline", description: "All your store items" },
  { type: "orders", label: "Orders", icon: "receipt-outline", description: "Your order history" },
  { type: "activity", label: "Activity", icon: "time-outline", description: "Seller activity log" },
  { type: "sync-log", label: "Sync Log", icon: "sync-outline", description: "Channel sync events" },
];

export default function DataToolsScreen() {
  const { member } = useAuth();
  const [exporting, setExporting] = useState<ExportType | null>(null);
  const [snapshots, setSnapshots] = useState<BulkSnapshot[]>([]);
  const [loadingSnapshots, setLoadingSnapshots] = useState(true);
  const [undoing, setUndoing] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadSnapshots = useCallback(async () => {
    if (!member) return;
    try {
      const res = await apiGet<{ snapshots: BulkSnapshot[] }>("/api/seller-hub/bulk-snapshots");
      setSnapshots(res.snapshots);
    } catch (e) {
      console.error("Failed to load snapshots:", e);
    } finally {
      setLoadingSnapshots(false);
    }
  }, [member]);

  useEffect(() => {
    loadSnapshots();
  }, [loadSnapshots]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadSnapshots();
    setRefreshing(false);
  }, [loadSnapshots]);

  const handleExport = async (type: ExportType) => {
    if (!member) return;

    setExporting(type);
    try {
      const token = await getToken();
      const response = await fetch(
        `${process.env.EXPO_PUBLIC_API_URL || ""}/api/seller-hub/export?type=${type}&format=csv`,
        {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        }
      );

      if (!response.ok) {
        throw new Error("Export failed");
      }

      const csvContent = await response.text();
      const filename = `${type}-${new Date().toISOString().split("T")[0]}.csv`;

      if (FileSystem.documentDirectory) {
        const fileUri = `${FileSystem.documentDirectory}${filename}`;
        await FileSystem.writeAsStringAsync(fileUri, csvContent, {
          encoding: FileSystem.EncodingType.UTF8,
        });

        const canShare = await isAvailableAsync();
        if (canShare) {
          await shareAsync(fileUri, {
            mimeType: "text/csv",
            dialogTitle: `Export ${type}`,
          });
        } else {
          await Share.share({
            message: csvContent,
            title: filename,
          });
        }
      } else {
        await Share.share({
          message: csvContent,
          title: filename,
        });
      }
    } catch (e) {
      console.error("Export failed:", e);
      Alert.alert("Export Failed", "Unable to export data. Please try again.");
    } finally {
      setExporting(null);
    }
  };

  const handleUndo = async (snapshot: BulkSnapshot) => {
    if (!member || !snapshot.canUndo) return;

    Alert.alert(
      "Undo Bulk Operation",
      `This will restore ${snapshot.itemCount} items to their previous state. Continue?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Undo",
          style: "destructive",
          onPress: async () => {
            setUndoing(snapshot.id);
            try {
              await apiPost(`/api/seller-hub/bulk-undo/${snapshot.id}`, {});
              Alert.alert("Success", "Bulk operation has been undone.");
              await loadSnapshots();
            } catch (e) {
              const msg = e instanceof Error ? e.message : "Undo failed";
              Alert.alert("Undo Failed", msg);
            } finally {
              setUndoing(null);
            }
          },
        },
      ]
    );
  };

  const formatOperation = (op: string): string => {
    const map: Record<string, string> = {
      bulk_edit: "Bulk Edit",
      bulk_publish: "Bulk Publish",
      bulk_unpublish: "Bulk Unpublish",
      bulk_delete: "Bulk Delete",
    };
    return map[op] || op;
  };

  const formatTime = (isoString: string): string => {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  };

  const getOperationIcon = (op: string): keyof typeof Ionicons.glyphMap => {
    const map: Record<string, keyof typeof Ionicons.glyphMap> = {
      bulk_edit: "pencil-outline",
      bulk_publish: "cloud-upload-outline",
      bulk_unpublish: "cloud-offline-outline",
      bulk_delete: "trash-outline",
    };
    return map[op] || "ellipse-outline";
  };

  const undoableSnapshots = snapshots.filter((s) => s.canUndo);
  const recentSnapshots = snapshots.filter((s) => !s.canUndo || s.undoneAt);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Export Section */}
      <Text style={styles.sectionTitle}>Export Data</Text>
      <Text style={styles.sectionSubtitle}>Download your seller data as CSV files</Text>

      <View style={styles.exportGrid}>
        {EXPORT_TYPES.map(({ type, label, icon, description }) => (
          <TouchableOpacity
            key={type}
            style={styles.exportCard}
            onPress={() => handleExport(type)}
            disabled={exporting !== null}
          >
            {exporting === type ? (
              <ActivityIndicator size="small" color={theme.colors.primary} />
            ) : (
              <Ionicons name={icon} size={28} color={theme.colors.primary} />
            )}
            <Text style={styles.exportLabel}>{label}</Text>
            <Text style={styles.exportDescription}>{description}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Undo Section */}
      <View style={styles.undoSection}>
        <Text style={styles.sectionTitle}>Recent Bulk Operations</Text>
        <Text style={styles.sectionSubtitle}>Undo bulk edits within 24 hours</Text>

        {loadingSnapshots ? (
          <ActivityIndicator style={{ marginTop: 20 }} />
        ) : undoableSnapshots.length === 0 && recentSnapshots.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="archive-outline" size={48} color="#ccc" />
            <Text style={styles.emptyText}>No recent bulk operations</Text>
          </View>
        ) : (
          <>
            {undoableSnapshots.length > 0 && (
              <>
                <Text style={styles.listLabel}>Can Undo</Text>
                {undoableSnapshots.map((snapshot) => (
                  <View key={snapshot.id} style={styles.snapshotCard}>
                    <View style={styles.snapshotIcon}>
                      <Ionicons
                        name={getOperationIcon(snapshot.operation)}
                        size={24}
                        color={theme.colors.primary}
                      />
                    </View>
                    <View style={styles.snapshotInfo}>
                      <Text style={styles.snapshotTitle}>{formatOperation(snapshot.operation)}</Text>
                      <Text style={styles.snapshotMeta}>
                        {snapshot.itemCount} items • {formatTime(snapshot.createdAt)}
                      </Text>
                      {snapshot.itemTitles && snapshot.itemTitles.length > 0 && (
                        <Text style={styles.snapshotItems} numberOfLines={1}>
                          {snapshot.itemTitles.join(", ")}
                        </Text>
                      )}
                    </View>
                    <TouchableOpacity
                      style={styles.undoButton}
                      onPress={() => handleUndo(snapshot)}
                      disabled={undoing === snapshot.id}
                    >
                      {undoing === snapshot.id ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.undoButtonText}>Undo</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                ))}
              </>
            )}

            {recentSnapshots.length > 0 && (
              <>
                <Text style={[styles.listLabel, { marginTop: 16 }]}>Past Operations</Text>
                {recentSnapshots.slice(0, 5).map((snapshot) => (
                  <View key={snapshot.id} style={[styles.snapshotCard, styles.snapshotCardDisabled]}>
                    <View style={styles.snapshotIcon}>
                      <Ionicons
                        name={getOperationIcon(snapshot.operation)}
                        size={24}
                        color="#999"
                      />
                    </View>
                    <View style={styles.snapshotInfo}>
                      <Text style={[styles.snapshotTitle, { color: "#666" }]}>
                        {formatOperation(snapshot.operation)}
                      </Text>
                      <Text style={styles.snapshotMeta}>
                        {snapshot.itemCount} items • {formatTime(snapshot.createdAt)}
                        {snapshot.undoneAt && " • Undone"}
                        {snapshot.isExpired && !snapshot.undoneAt && " • Expired"}
                      </Text>
                    </View>
                  </View>
                ))}
              </>
            )}
          </>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8f9fa",
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#222",
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: "#666",
    marginBottom: 16,
  },
  exportGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 24,
  },
  exportCard: {
    width: "48%",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  exportLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#222",
    marginTop: 8,
  },
  exportDescription: {
    fontSize: 12,
    color: "#666",
    marginTop: 4,
    textAlign: "center",
  },
  undoSection: {
    marginTop: 8,
  },
  listLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#666",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  snapshotCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  snapshotCardDisabled: {
    opacity: 0.7,
  },
  snapshotIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#f0f4ff",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  snapshotInfo: {
    flex: 1,
  },
  snapshotTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#222",
  },
  snapshotMeta: {
    fontSize: 13,
    color: "#666",
    marginTop: 2,
  },
  snapshotItems: {
    fontSize: 12,
    color: "#999",
    marginTop: 2,
  },
  undoButton: {
    backgroundColor: theme.colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    minWidth: 64,
    alignItems: "center",
  },
  undoButtonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 16,
    color: "#999",
    marginTop: 12,
  },
});
