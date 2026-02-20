import { useEffect, useRef } from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  Animated,
  Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { getBadgeIcon } from "@/lib/badge-icons";

interface BadgeEarnedPopupProps {
  visible: boolean;
  onClose: () => void;
  badgeName: string;
  badgeSlug: string;
  badgeDescription?: string;
}

export function BadgeEarnedPopup({
  visible,
  onClose,
  badgeName,
  badgeSlug,
  badgeDescription,
}: BadgeEarnedPopupProps) {
  const scaleAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      scaleAnim.setValue(0);
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 5,
        tension: 60,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, scaleAnim]);

  if (!visible) return null;

  const iconName = getBadgeIcon(badgeSlug);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Animated.View
          style={[styles.card, { transform: [{ scale: scaleAnim }] }]}
        >
          <Pressable style={styles.closeBtn} onPress={onClose}>
            <Ionicons name="close" size={24} color="#666" />
          </Pressable>

          <View style={styles.iconWrap}>
            <Ionicons name={iconName} size={48} color={theme.colors.primary} />
          </View>

          <Text style={styles.congrats}>Congrats!</Text>
          <Text style={styles.badgeName}>You earned "{badgeName}"!</Text>

          {badgeDescription ? (
            <Text style={styles.description}>{badgeDescription}</Text>
          ) : null}

          <Pressable
            style={({ pressed }) => [styles.doneBtn, pressed && { opacity: 0.8 }]}
            onPress={onClose}
          >
            <Text style={styles.doneBtnText}>Awesome!</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  card: {
    width: Math.min(Dimensions.get("window").width - 48, 340),
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 3,
    borderColor: theme.colors.primary,
    padding: 28,
    alignItems: "center",
  },
  closeBtn: {
    position: "absolute",
    top: 12,
    right: 12,
    padding: 4,
    zIndex: 10,
  },
  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: `${theme.colors.primary}20`,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  congrats: {
    fontSize: 22,
    fontWeight: "700",
    color: theme.colors.heading,
    marginBottom: 4,
  },
  badgeName: {
    fontSize: 18,
    fontWeight: "600",
    color: theme.colors.primary,
    textAlign: "center",
    marginBottom: 12,
  },
  description: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 20,
  },
  doneBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 8,
    width: "100%",
    alignItems: "center",
    marginTop: 8,
  },
  doneBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
