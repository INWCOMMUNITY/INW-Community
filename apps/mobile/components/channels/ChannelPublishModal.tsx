import React, { useEffect, useState } from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { theme } from "@/lib/theme";
import {
  CHANNEL_PROVIDER_LABEL,
  channelNotReadyHint,
  connectionsForPublishModal,
  defaultSelectedProviders,
  fetchChannelConnections,
  publishReadyConnections,
  type ChannelConnectionSummary,
  type ChannelProviderId,
} from "@/lib/channel-connections";

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Called with selected providers (may be empty for INW-only). */
  onConfirm: (providers: ChannelProviderId[]) => void;
};

export function ChannelPublishModal({ visible, onClose, onConfirm }: Props) {
  const [loading, setLoading] = useState(false);
  const [connections, setConnections] = useState<ChannelConnectionSummary[]>([]);
  const [selected, setSelected] = useState<Set<ChannelProviderId>>(new Set());

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    fetchChannelConnections()
      .then((list) => {
        const modalConnections = connectionsForPublishModal(list);
        setConnections(modalConnections);
        setSelected(new Set(defaultSelectedProviders(modalConnections)));
      })
      .catch(() => {
        setConnections([]);
        setSelected(new Set());
      })
      .finally(() => setLoading(false));
  }, [visible]);

  const toggle = (provider: ChannelProviderId, disabled: boolean) => {
    if (disabled) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(provider)) next.delete(provider);
      else next.add(provider);
      return next;
    });
  };

  const hasPublishReady = publishReadyConnections(connections).length > 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={styles.panel} onStartShouldSetResponder={() => true}>
          <Text style={styles.title}>Also list on connected stores?</Text>
          <Text style={styles.subtitle}>
            Would you like this listing on your connected stores? Only stores you connect in Sync
            Stores appear here.
          </Text>

          {loading ? (
            <ActivityIndicator style={styles.spinner} color={theme.colors.primary} />
          ) : connections.length === 0 ? (
            <Text style={styles.empty}>No connected stores. This listing will only appear on INW.</Text>
          ) : (
            connections.map((c) => {
              const disabled =
                c.status !== "active" || c.readyToPublish === false;
              const checked = selected.has(c.provider);
              const label = CHANNEL_PROVIDER_LABEL[c.provider] ?? c.provider;
              return (
                <Pressable
                  key={c.provider}
                  style={[styles.row, disabled && styles.rowDisabled]}
                  onPress={() => toggle(c.provider, disabled)}
                  disabled={disabled}
                >
                  <View style={[styles.checkbox, checked && styles.checkboxOn]}>
                    {checked && <Text style={styles.checkmark}>✓</Text>}
                  </View>
                  <View style={styles.rowBody}>
                    <Text style={[styles.rowLabel, disabled && styles.rowLabelDisabled]}>
                      {label}
                    </Text>
                    {disabled && (
                      <Text style={styles.rowHint}>
                        {c.status !== "active"
                          ? "Reconnect in Sync Stores."
                          : channelNotReadyHint(c.provider)}
                      </Text>
                    )}
                  </View>
                </Pressable>
              );
            })
          )}

          <View style={styles.actions}>
            <Pressable
              style={({ pressed }) => [styles.btnSecondary, pressed && { opacity: 0.85 }]}
              onPress={() => onConfirm([])}
            >
              <Text style={styles.btnSecondaryText}>INW only</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.btnPrimary,
                pressed && { opacity: 0.85 },
                !hasPublishReady && styles.btnDisabled,
              ]}
              onPress={() => onConfirm([...selected])}
              disabled={!hasPublishReady && selected.size === 0}
            >
              <Text style={styles.btnPrimaryText}>
                {selected.size > 0 ? "Continue" : "Continue"}
              </Text>
            </Pressable>
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    padding: 24,
  },
  panel: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
    maxWidth: 400,
    alignSelf: "center",
    width: "100%",
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: theme.colors.heading,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: "#555",
    marginBottom: 16,
    lineHeight: 20,
  },
  spinner: { marginVertical: 16 },
  empty: { fontSize: 14, color: "#666", marginBottom: 16 },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 10,
    gap: 12,
  },
  rowDisabled: { opacity: 0.65 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  checkboxOn: {
    backgroundColor: theme.colors.primary,
  },
  checkmark: { color: "#fff", fontSize: 14, fontWeight: "700" },
  rowBody: { flex: 1 },
  rowLabel: { fontSize: 16, fontWeight: "600", color: theme.colors.heading },
  rowLabelDisabled: { color: "#888" },
  rowHint: { fontSize: 12, color: "#888", marginTop: 4 },
  actions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 20,
    justifyContent: "flex-end",
  },
  btnSecondary: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ccc",
  },
  btnSecondaryText: { fontSize: 15, fontWeight: "600", color: theme.colors.heading },
  btnPrimary: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
  },
  btnPrimaryText: { fontSize: 15, fontWeight: "600", color: "#fff" },
  btnDisabled: { opacity: 0.5 },
});
