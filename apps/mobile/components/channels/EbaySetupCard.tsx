import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Linking,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet } from "@/lib/api";

type SetupChecklistItem = {
  id: string;
  label: string;
  done: boolean;
  helpUrl: string;
  value: string | null;
  required: boolean;
};

type EbaySetupStatus = {
  connected: boolean;
  canPublish: boolean;
  checklist: SetupChecklistItem[];
  allDone: boolean;
  refreshedAt: string | null;
  externalShopId: string | null;
};

type Props = {
  onSetupComplete?: () => void;
};

export function EbaySetupCard({ onSetupComplete }: Props) {
  const [status, setStatus] = useState<EbaySetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async (refresh = false) => {
    try {
      const url = refresh
        ? "/api/channels/ebay/setup-status?refresh=1"
        : "/api/channels/ebay/setup-status";
      const data = await apiGet<EbaySetupStatus>(url);
      setStatus(data);
      setError(null);
      if (data.allDone && onSetupComplete) {
        onSetupComplete();
      }
    } catch (e) {
      setError("Could not check eBay setup status");
    }
  }, [onSetupComplete]);

  React.useEffect(() => {
    setLoading(true);
    fetchStatus().finally(() => setLoading(false));
  }, [fetchStatus]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchStatus(true);
    setRefreshing(false);
  };

  const openUrl = (url: string) => {
    Linking.openURL(url).catch(() => {
      setError("Could not open link");
    });
  };

  if (loading) {
    return (
      <View style={styles.card}>
        <ActivityIndicator color={theme.colors.primary} />
        <Text style={styles.loadingText}>Checking eBay setup...</Text>
      </View>
    );
  }

  if (!status || !status.connected) {
    return null;
  }

  if (status.allDone) {
    return null;
  }

  const doneCount = status.checklist.filter((item) => item.done).length;
  const totalRequired = status.checklist.filter((item) => item.required).length;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Ionicons name="alert-circle" size={24} color="#b45309" />
        <Text style={styles.title}>eBay Setup Required</Text>
      </View>

      <Text style={styles.subtitle}>
        Complete these steps in eBay Seller Hub to start syncing listings:
      </Text>

      <View style={styles.progress}>
        <View style={[styles.progressBar, { width: `${(doneCount / totalRequired) * 100}%` }]} />
      </View>
      <Text style={styles.progressText}>
        {doneCount} of {totalRequired} complete
      </Text>

      <View style={styles.checklist}>
        {status.checklist.map((item) => (
          <Pressable
            key={item.id}
            style={styles.checklistItem}
            onPress={() => !item.done && openUrl(item.helpUrl)}
            disabled={item.done}
          >
            <View style={[styles.checkIcon, item.done && styles.checkIconDone]}>
              {item.done ? (
                <Ionicons name="checkmark" size={14} color="#fff" />
              ) : (
                <View style={styles.checkIconEmpty} />
              )}
            </View>
            <View style={styles.checklistContent}>
              <Text style={[styles.checklistLabel, item.done && styles.checklistLabelDone]}>
                {item.label}
              </Text>
              {item.value ? (
                <Text style={styles.checklistValue}>{item.value}</Text>
              ) : (
                <Text style={styles.checklistMissing}>Not set up</Text>
              )}
            </View>
            {!item.done && (
              <Ionicons name="open-outline" size={18} color={theme.colors.primary} />
            )}
          </Pressable>
        ))}
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.actions}>
        <Pressable
          style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.8 }]}
          onPress={() => openUrl("https://www.ebay.com/sh/ovw")}
        >
          <Text style={styles.primaryBtnText}>Open eBay Seller Hub</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.secondaryBtn,
            pressed && { opacity: 0.8 },
            refreshing && styles.btnDisabled,
          ]}
          onPress={handleRefresh}
          disabled={refreshing}
        >
          {refreshing ? (
            <ActivityIndicator color={theme.colors.primary} size="small" />
          ) : (
            <>
              <Ionicons name="refresh" size={16} color={theme.colors.primary} />
              <Text style={styles.secondaryBtnText}>Check Again</Text>
            </>
          )}
        </Pressable>
      </View>

      <Text style={styles.hint}>
        After completing setup on eBay, tap &quot;Check Again&quot; to refresh.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fffbeb",
    borderWidth: 1,
    borderColor: "#fcd34d",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
    color: "#92400e",
  },
  subtitle: {
    fontSize: 14,
    color: "#78350f",
    marginBottom: 12,
  },
  progress: {
    height: 6,
    backgroundColor: "#fde68a",
    borderRadius: 3,
    overflow: "hidden",
    marginBottom: 4,
  },
  progressBar: {
    height: "100%",
    backgroundColor: "#16a34a",
    borderRadius: 3,
  },
  progressText: {
    fontSize: 12,
    color: "#92400e",
    marginBottom: 12,
  },
  checklist: {
    gap: 8,
    marginBottom: 16,
  },
  checklistItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  checkIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#e5e7eb",
    justifyContent: "center",
    alignItems: "center",
  },
  checkIconDone: {
    backgroundColor: "#16a34a",
  },
  checkIconEmpty: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#9ca3af",
  },
  checklistContent: {
    flex: 1,
  },
  checklistLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#374151",
  },
  checklistLabelDone: {
    color: "#6b7280",
  },
  checklistValue: {
    fontSize: 12,
    color: "#16a34a",
    marginTop: 2,
  },
  checklistMissing: {
    fontSize: 12,
    color: "#dc2626",
    marginTop: 2,
  },
  error: {
    fontSize: 13,
    color: "#dc2626",
    marginBottom: 12,
  },
  actions: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 8,
  },
  primaryBtn: {
    flex: 1,
    backgroundColor: theme.colors.primary,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  primaryBtnText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
  },
  secondaryBtn: {
    flex: 1,
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: theme.colors.primary,
    paddingVertical: 12,
    borderRadius: 8,
  },
  secondaryBtnText: {
    color: theme.colors.primary,
    fontWeight: "600",
    fontSize: 14,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  hint: {
    fontSize: 12,
    color: "#92400e",
    textAlign: "center",
  },
  loadingText: {
    fontSize: 14,
    color: "#666",
    marginTop: 8,
    textAlign: "center",
  },
});
