import { Modal, View, Text, Pressable, StyleSheet, Dimensions, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";

export interface EventInvitePopupInvite {
  id: string;
  event: { title: string; slug: string };
  inviter: { id: string; firstName: string; lastName: string };
}

interface EventInvitePopupProps {
  visible: boolean;
  invite: EventInvitePopupInvite | null;
  onClose: () => void;
  onRespond: (status: "accepted" | "maybe" | "declined") => Promise<void>;
  responding?: boolean;
}

export function EventInvitePopup({
  visible,
  invite,
  onClose,
  onRespond,
  responding = false,
}: EventInvitePopupProps) {
  const router = useRouter();

  if (!visible || !invite) return null;

  const inviterName = [invite.inviter.firstName, invite.inviter.lastName].filter(Boolean).join(" ").trim();

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={24} color="#666" />
          </Pressable>

          <View style={styles.iconWrap}>
            <Ionicons name="calendar" size={48} color={theme.colors.primary} />
          </View>

          <Text style={styles.body}>
            You have been invited to{" "}
            <Text
              style={styles.link}
              onPress={() => {
                onClose();
                router.push(`/event/${invite.event.slug}` as never);
              }}
            >
              {invite.event.title}
            </Text>{" "}
            by{" "}
            <Text
              style={styles.link}
              onPress={() => {
                onClose();
                router.push(`/members/${invite.inviter.id}` as never);
              }}
            >
              {inviterName}
            </Text>
            !
          </Text>

          <View style={styles.actions}>
            <Pressable
              style={({ pressed }) => [styles.btn, styles.btnAccept, pressed && styles.pressed]}
              onPress={() => onRespond("accepted")}
              disabled={responding}
            >
              {responding ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.btnAcceptText}>Accept</Text>
              )}
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.btn, styles.btnMaybe, pressed && styles.pressed]}
              onPress={() => onRespond("maybe")}
              disabled={responding}
            >
              <Text style={styles.btnMaybeText}>Maybe</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.btn, styles.btnDecline, pressed && styles.pressed]}
              onPress={() => onRespond("declined")}
              disabled={responding}
            >
              <Text style={styles.btnDeclineText}>Decline</Text>
            </Pressable>
          </View>
        </View>
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
  body: {
    fontSize: 16,
    color: "#333",
    textAlign: "center",
    lineHeight: 24,
    marginBottom: 20,
  },
  link: {
    color: theme.colors.primary,
    fontWeight: "600",
    textDecorationLine: "underline",
  },
  actions: {
    flexDirection: "row",
    gap: 8,
    width: "100%",
    justifyContent: "space-between",
  },
  btn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 40,
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },
  btnAccept: {
    backgroundColor: theme.colors.primary,
  },
  btnAcceptText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 13,
  },
  btnMaybe: {
    backgroundColor: theme.colors.cream,
  },
  btnMaybeText: {
    color: theme.colors.primary,
    fontWeight: "700",
    fontSize: 13,
  },
  btnDecline: {
    backgroundColor: "transparent",
    borderColor: "#999",
  },
  btnDeclineText: {
    color: "#666",
    fontWeight: "600",
    fontSize: 13,
  },
  pressed: { opacity: 0.85 },
});
