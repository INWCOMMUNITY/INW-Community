import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";

type Props = {
  visible: boolean;
  providerName: string;
  provider: string;
  linkedListings: number;
  onDismiss: () => void;
  onSyncNow: () => void;
  onViewSyncHealth: () => void;
  syncing?: boolean;
};

const STEPS = [
  {
    icon: "shield-checkmark-outline" as const,
    text: "Your INW listing quantities were not reset — reconnect only fixes the API connection.",
  },
  {
    icon: "sync-outline" as const,
    text: "Run Sync Now to pull recent marketplace sales and push your current INW stock to linked stores.",
  },
  {
    icon: "eye-outline" as const,
    text: "Spot-check one or two items in My Items against your marketplace admin to confirm quantities match.",
  },
];

export function ReconnectChecklistModal({
  visible,
  providerName,
  provider,
  linkedListings,
  onDismiss,
  onSyncNow,
  onViewSyncHealth,
  syncing = false,
}: Props) {
  const wixExtra =
    provider === "wix"
      ? "If Wix still shows wrong stock, use Test Write on this screen after syncing."
      : null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onDismiss}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Ionicons name="checkmark-circle" size={28} color="#16a34a" />
            <Text style={styles.title}>{providerName} connected</Text>
          </View>
          <Text style={styles.subtitle}>
            {linkedListings > 0
              ? `${linkedListings} linked listing${linkedListings === 1 ? "" : "s"} — follow these steps so inventory stays aligned.`
              : "Follow these steps to keep inventory aligned across stores."}
          </Text>

          <ScrollView style={styles.steps} bounces={false}>
            {STEPS.map((step, i) => (
              <View key={i} style={styles.stepRow}>
                <View style={styles.stepNum}>
                  <Text style={styles.stepNumText}>{i + 1}</Text>
                </View>
                <Ionicons name={step.icon} size={20} color={theme.colors.primary} style={styles.stepIcon} />
                <Text style={styles.stepText}>{step.text}</Text>
              </View>
            ))}
            {wixExtra ? (
              <View style={styles.wixNote}>
                <Ionicons name="information-circle-outline" size={18} color="#0369a1" />
                <Text style={styles.wixNoteText}>{wixExtra}</Text>
              </View>
            ) : null}
          </ScrollView>

          <Pressable
            style={({ pressed }) => [
              styles.primaryBtn,
              pressed && { opacity: 0.9 },
              syncing && styles.primaryBtnDisabled,
            ]}
            onPress={onSyncNow}
            disabled={syncing}
          >
            <Ionicons name="sync" size={18} color="#fff" />
            <Text style={styles.primaryBtnText}>{syncing ? "Syncing…" : "Sync Now"}</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.85 }]}
            onPress={onViewSyncHealth}
          >
            <Text style={styles.secondaryBtnText}>View Sync Health</Text>
          </Pressable>

          <Pressable style={({ pressed }) => [styles.dismissBtn, pressed && { opacity: 0.6 }]} onPress={onDismiss}>
            <Text style={styles.dismissBtnText}>Done for now</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    paddingBottom: 32,
    maxHeight: "85%",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: theme.colors.heading,
  },
  subtitle: {
    fontSize: 14,
    color: "#666",
    lineHeight: 20,
    marginBottom: 16,
  },
  steps: {
    maxHeight: 220,
    marginBottom: 16,
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginBottom: 14,
  },
  stepNum: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  stepNumText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  stepIcon: {
    marginTop: 1,
  },
  stepText: {
    flex: 1,
    fontSize: 14,
    color: "#374151",
    lineHeight: 20,
  },
  wixNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: "#f0f9ff",
    padding: 10,
    borderRadius: 8,
    marginTop: 4,
  },
  wixNoteText: {
    flex: 1,
    fontSize: 13,
    color: "#0369a1",
    lineHeight: 18,
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: theme.colors.primary,
    paddingVertical: 14,
    borderRadius: 10,
    marginBottom: 10,
  },
  primaryBtnDisabled: {
    opacity: 0.6,
  },
  primaryBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  secondaryBtn: {
    alignItems: "center",
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: theme.colors.primary,
    borderRadius: 10,
    marginBottom: 8,
  },
  secondaryBtnText: {
    color: theme.colors.primary,
    fontSize: 15,
    fontWeight: "600",
  },
  dismissBtn: {
    alignItems: "center",
    paddingVertical: 10,
  },
  dismissBtnText: {
    color: "#6b7280",
    fontSize: 14,
  },
});
