import {
  Modal,
  StyleSheet,
  View,
  Text,
  Pressable,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { useEventInvitePopupSuppression } from "@/contexts/EventInvitePopupSuppressionContext";
import { useEffect } from "react";

export interface OwnedBusinessOption {
  id: string;
  name: string;
}

interface PostEventAsPickerModalProps {
  visible: boolean;
  onClose: () => void;
  /** Member display name for the personal option, e.g. "Jane Doe" */
  profileDisplayName: string;
  businesses: OwnedBusinessOption[];
  onSelectPersonal: () => void;
  onSelectBusiness: (business: OwnedBusinessOption) => void;
}

export function PostEventAsPickerModal({
  visible,
  onClose,
  profileDisplayName,
  businesses,
  onSelectPersonal,
  onSelectBusiness,
}: PostEventAsPickerModalProps) {
  const { incrementSuppression, decrementSuppression } = useEventInvitePopupSuppression();
  useEffect(() => {
    if (!visible) return;
    incrementSuppression();
    return () => decrementSuppression();
  }, [visible, incrementSuppression, decrementSuppression]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
      transparent
    >
      <View style={styles.backdrop}>
        <View style={styles.panel}>
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={2}>
              Post Event
            </Text>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.7 }]}
              hitSlop={12}
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={24} color={theme.colors.heading} />
            </Pressable>
          </View>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.subtitle}>
              Choose who is hosting this event so it appears under the right name on the calendar.
            </Text>
            <Pressable
              style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
              onPress={onSelectPersonal}
            >
              <Ionicons name="person-outline" size={22} color={theme.colors.primary} />
              <Text style={styles.optionText}>Post as &quot;{profileDisplayName}&quot;</Text>
              <Ionicons name="chevron-forward" size={20} color={theme.colors.primary} />
            </Pressable>
            {businesses.map((b) => (
              <Pressable
                key={b.id}
                style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
                onPress={() => onSelectBusiness(b)}
              >
                <Ionicons name="business-outline" size={22} color={theme.colors.primary} />
                <Text style={styles.optionText}>Post as &quot;{b.name}&quot;</Text>
                <Ionicons name="chevron-forward" size={20} color={theme.colors.primary} />
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  panel: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: "88%",
    minHeight: 220,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: theme.colors.primary,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    color: theme.colors.heading,
    flex: 1,
    paddingRight: 8,
  },
  closeBtn: { padding: 4 },
  scroll: { maxHeight: 480 },
  scrollContent: { padding: 16, paddingBottom: 32 },
  subtitle: {
    fontSize: 15,
    color: theme.colors.text,
    lineHeight: 22,
    marginBottom: 16,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 12,
    marginBottom: 10,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    backgroundColor: "#fff",
  },
  optionPressed: { opacity: 0.85 },
  optionText: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.heading,
  },
});
