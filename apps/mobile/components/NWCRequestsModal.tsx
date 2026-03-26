import { useState, useEffect } from "react";
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  Pressable,
  Modal,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme } from "@/lib/theme";
import { apiGet, apiPost, getToken } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { BadgeEarnedPopup } from "@/components/BadgeEarnedPopup";

type EarnedBadgeItem = { slug: string; name: string; description: string };

interface NWCRequestsModalProps {
  visible: boolean;
  onClose: () => void;
}

export function NWCRequestsModal({ visible, onClose }: NWCRequestsModalProps) {
  const insets = useSafeAreaInsets();
  const { member } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [earnedBadges, setEarnedBadges] = useState<EarnedBadgeItem[]>([]);
  const [badgePopupIndex, setBadgePopupIndex] = useState(-1);

  useEffect(() => {
    if (!visible) return;
    setError(null);
    setSent(false);
    setEarnedBadges([]);
    setBadgePopupIndex(-1);
    let cancelled = false;
    (async () => {
      const token = await getToken();
      if (cancelled || !token) {
        if (member?.firstName || member?.lastName) {
          setName([member.firstName, member.lastName].filter(Boolean).join(" "));
        }
        if (member?.email) setEmail(member.email);
        return;
      }
      try {
        const me = await apiGet<{ firstName?: string; lastName?: string; email?: string }>("/api/me");
        if (cancelled) return;
        if (me?.firstName || me?.lastName) {
          setName([me.firstName, me.lastName].filter(Boolean).join(" "));
        }
        if (me?.email?.trim()) {
          setEmail(me.email);
        } else if (member?.email) {
          setEmail(member.email);
        }
      } catch {
        if (!cancelled && member?.firstName) {
          setName([member.firstName, member.lastName].filter(Boolean).join(" "));
        }
        if (!cancelled && member?.email) setEmail(member.email);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, member?.email, member?.firstName, member?.lastName]);

  async function handleSubmit() {
    setError(null);
    const submitName = name.trim();
    const submitEmail = email.trim();
    const submitMessage = message.trim();
    if (!submitName || !submitEmail || !submitMessage) {
      setError("Please fill in name, email, and message.");
      return;
    }
    setLoading(true);
    try {
      const data = await apiPost<{ ok?: boolean; earnedBadges?: EarnedBadgeItem[] }>(
        "/api/nwc-requests",
        {
          name: submitName,
          email: submitEmail,
          message: submitMessage,
        }
      );
      const badges = (data?.earnedBadges ?? []).filter(Boolean);
      setMessage("");
      if (badges.length > 0) {
        setEarnedBadges(badges);
        setBadgePopupIndex(0);
      } else {
        setSent(true);
        setTimeout(() => {
          setSent(false);
          onClose();
        }, 1800);
      }
    } catch (e) {
      setError((e as { error?: string }).error ?? "Failed to send. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const finishAfterBadges = () => {
    setEarnedBadges([]);
    setBadgePopupIndex(-1);
    setSent(true);
    setTimeout(() => {
      setSent(false);
      onClose();
    }, 1800);
  };

  const handleCloseBadgePopup = () => {
    if (badgePopupIndex >= 0 && badgePopupIndex < earnedBadges.length - 1) {
      setBadgePopupIndex((i) => i + 1);
    } else {
      finishAfterBadges();
    }
  };

  if (!visible) return null;

  return (
    <>
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.modal}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? Math.max(insets.top, 20) : 0}
      >
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) }]}>
          <Text style={styles.title}>NWC Requests</Text>
          <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={12}>
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        </View>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.subtitle}>
            Send a request or message to the Northwest Community team.
          </Text>
          <View style={styles.note}>
            <Text style={styles.noteText}>
              Your email is included with your request so the NWC team can reach out to you if needed.
            </Text>
          </View>
          {sent ? (
            <Text style={styles.success}>Thank you! Your message has been sent.</Text>
          ) : (
            <>
              <Text style={styles.label}>Name</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="Your name"
                placeholderTextColor={theme.colors.placeholder}
                autoCapitalize="words"
                autoCorrect={true}
              />
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="your@email.com"
                placeholderTextColor={theme.colors.placeholder}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={true}
              />
              <Text style={styles.label}>Message</Text>
              <TextInput
                style={[styles.input, styles.textarea]}
                value={message}
                onChangeText={setMessage}
                placeholder="Your request or message..."
                placeholderTextColor={theme.colors.placeholder}
                multiline
                numberOfLines={4}
                autoCorrect={true}
              />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <View style={styles.actions}>
                <Pressable
                  style={[styles.btn, styles.btnSecondary]}
                  onPress={onClose}
                >
                  <Text style={styles.btnSecondaryText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[styles.btn, styles.btnPrimary, loading && styles.btnDisabled]}
                  onPress={handleSubmit}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator size="small" color={theme.colors.buttonText} />
                  ) : (
                    <Text style={styles.btnPrimaryText}>Send</Text>
                  )}
                </Pressable>
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>

      {visible && badgePopupIndex >= 0 && badgePopupIndex < earnedBadges.length ? (
        <BadgeEarnedPopup
          visible
          onClose={handleCloseBadgePopup}
          badgeName={earnedBadges[badgePopupIndex].name}
          badgeSlug={earnedBadges[badgePopupIndex].slug}
          badgeDescription={earnedBadges[badgePopupIndex].description}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  modal: { flex: 1, backgroundColor: "#fff" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e5",
    backgroundColor: theme.colors.primary,
  },
  title: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#fff",
    fontFamily: theme.fonts.heading,
  },
  closeBtn: { padding: 8 },
  closeText: { fontSize: 16, fontWeight: "600", color: "#fff" },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  subtitle: {
    fontSize: 14,
    color: "#666",
    marginBottom: 16,
  },
  note: {
    marginBottom: 16,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: `${theme.colors.primary}4D`,
    backgroundColor: `${theme.colors.primary}0D`,
  },
  noteText: { fontSize: 13, color: "#444" },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    marginBottom: 16,
  },
  textarea: {
    minHeight: 100,
    textAlignVertical: "top",
    paddingTop: 10,
  },
  error: {
    color: "#c00",
    fontSize: 14,
    marginBottom: 12,
  },
  success: {
    textAlign: "center",
    paddingVertical: 24,
    color: "#059669",
    fontWeight: "600",
    fontSize: 16,
  },
  actions: {
    flexDirection: "row",
    gap: 12,
    justifyContent: "flex-end",
    marginTop: 8,
  },
  btn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    minWidth: 80,
    alignItems: "center",
  },
  btnSecondary: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ccc",
  },
  btnSecondaryText: { color: "#333", fontWeight: "600" },
  btnPrimary: {
    backgroundColor: theme.colors.primary,
  },
  btnDisabled: { opacity: 0.7 },
  btnPrimaryText: {
    color: theme.colors.buttonText,
    fontWeight: "600",
    fontSize: 16,
  },
});
