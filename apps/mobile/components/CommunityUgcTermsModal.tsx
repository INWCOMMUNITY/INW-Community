import { useState } from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  Linking,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

type Props = {
  visible: boolean;
  onAccept: () => void;
  onOpenTerms: () => void;
};

export function CommunityUgcTermsModal({ visible, onAccept, onOpenTerms }: Props) {
  const [busy, setBusy] = useState(false);

  const openPrivacy = () => {
    Linking.openURL(`${siteBase}/privacy`).catch(() => {});
  };

  return (
    <Modal visible={visible} animationType="fade" transparent={false}>
      <View style={styles.wrap}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Ionicons name="people-circle-outline" size={48} color={theme.colors.primary} style={styles.icon} />
          <Text style={styles.title}>Before you join the community</Text>
          <Text style={styles.body}>
            The Community feed includes photos, text, and listings shared by members. This content is
            user-generated. We moderate reports and expect everyone to follow our Terms of Service.
          </Text>
          <Text style={styles.body}>
            You can report posts that break the rules. Signed-in members can also block someone—blocked
            members disappear from your feed right away and we are notified to review.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.linkBtn, pressed && styles.pressed]}
            onPress={onOpenTerms}
            accessibilityRole="link"
          >
            <Text style={styles.linkText}>Read Terms of Service</Text>
            <Ionicons name="open-outline" size={18} color={theme.colors.primary} />
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.linkBtn, pressed && styles.pressed]}
            onPress={openPrivacy}
            accessibilityRole="link"
          >
            <Text style={styles.linkText}>Privacy Policy</Text>
            <Ionicons name="open-outline" size={18} color={theme.colors.primary} />
          </Pressable>
        </ScrollView>
        <View style={styles.footer}>
          <Pressable
            style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed, busy && styles.disabled]}
            disabled={busy}
            onPress={() => {
              setBusy(true);
              try {
                onAccept();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>I agree — continue to Community</Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: "#fff",
    paddingTop: 56,
  },
  scroll: {
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  icon: {
    alignSelf: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: theme.colors.heading,
    fontFamily: theme.fonts.heading,
    textAlign: "center",
    marginBottom: 16,
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    color: theme.colors.text,
    marginBottom: 14,
  },
  linkBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#ddd",
  },
  linkText: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.primary,
  },
  pressed: { opacity: 0.85 },
  footer: {
    padding: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#e0e0e0",
    backgroundColor: "#fafafa",
  },
  primaryBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: "center",
  },
  primaryBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  disabled: { opacity: 0.7 },
});
