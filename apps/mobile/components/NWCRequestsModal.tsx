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
import { theme } from "@/lib/theme";
import { apiGet, apiPost, getToken } from "@/lib/api";

interface NWCRequestsModalProps {
  visible: boolean;
  onClose: () => void;
}

export function NWCRequestsModal({ visible, onClose }: NWCRequestsModalProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (visible) {
      setError(null);
      setSent(false);
      getToken().then((t) => {
        if (t) {
          apiGet<{ firstName?: string; lastName?: string; email?: string }>("/api/me")
            .then((me) => {
              if (me?.firstName || me?.lastName) {
                setName([me.firstName, me.lastName].filter(Boolean).join(" "));
              }
              if (me?.email) setEmail(me.email);
            })
            .catch(() => {});
        }
      });
    }
  }, [visible]);

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
      await apiPost("/api/nwc-requests", {
        name: submitName,
        email: submitEmail,
        message: submitMessage,
      });
      setSent(true);
      setMessage("");
      setTimeout(() => {
        setSent(false);
        onClose();
      }, 1800);
    } catch (e) {
      setError((e as { error?: string }).error ?? "Failed to send. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.modal}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
        <View style={styles.header}>
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
  );
}

const styles = StyleSheet.create({
  modal: { flex: 1, backgroundColor: "#fff" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
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
