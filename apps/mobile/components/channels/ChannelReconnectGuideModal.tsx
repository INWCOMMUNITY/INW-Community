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

const STEPS = [
  "Sync with that store is paused. Your INW listings and quantities were not deleted or reset.",
  "Tap Reconnect and sign in on that marketplace (eBay, Etsy, Wix, or Shopify).",
  "After it connects, tap Sync Now so title, price, and quantity catch up.",
  "INW will keep using a long-lived refresh token after that. You should not need to reconnect every few hours.",
];

type Props = {
  visible: boolean;
  providerName: string;
  reconnecting?: boolean;
  onReconnect: () => void;
  onDismiss: () => void;
};

export function ChannelReconnectGuideModal({
  visible,
  providerName,
  reconnecting = false,
  onReconnect,
  onDismiss,
}: Props) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onDismiss}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Ionicons name="warning-outline" size={28} color="#b45309" />
            <Text style={styles.title}>Reconnect {providerName}</Text>
          </View>
          <Text style={styles.subtitle}>
            {providerName} sync paused. Follow these steps to turn it back on.
          </Text>
          <ScrollView style={styles.steps} bounces={false}>
            {STEPS.map((step, i) => (
              <View key={step} style={styles.stepRow}>
                <View style={styles.stepNum}>
                  <Text style={styles.stepNumText}>{i + 1}</Text>
                </View>
                <Text style={styles.stepText}>{step}</Text>
              </View>
            ))}
          </ScrollView>
          <Pressable
            style={({ pressed }) => [
              styles.primaryBtn,
              pressed && { opacity: 0.9 },
              reconnecting && styles.primaryBtnDisabled,
            ]}
            onPress={onReconnect}
            disabled={reconnecting}
          >
            <Ionicons name="refresh" size={18} color="#fff" />
            <Text style={styles.primaryBtnText}>
              {reconnecting ? "Connecting…" : `Reconnect ${providerName}`}
            </Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.dismissBtn, pressed && { opacity: 0.6 }]}
            onPress={onDismiss}
          >
            <Text style={styles.dismissBtnText}>I'll do this later</Text>
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
    flex: 1,
  },
  subtitle: {
    fontSize: 14,
    color: "#666",
    lineHeight: 20,
    marginBottom: 16,
  },
  steps: {
    maxHeight: 260,
    marginBottom: 16,
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
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
  stepText: {
    flex: 1,
    fontSize: 14,
    color: "#374151",
    lineHeight: 20,
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
  dismissBtn: {
    alignItems: "center",
    paddingVertical: 10,
  },
  dismissBtnText: {
    color: "#6b7280",
    fontSize: 14,
  },
});
