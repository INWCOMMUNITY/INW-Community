import { useCallback, useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Modal,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

interface ResaleConversation {
  id: string;
  storeItem: { id: string; title: string; slug: string };
  buyer: { id: string; firstName: string; lastName: string };
  seller: { id: string; firstName: string; lastName: string };
  messages: Array<{
    id: string;
    content: string;
    createdAt: string;
    senderId: string;
    sender?: { id: string; firstName: string; lastName: string };
  }>;
}

export default function ResaleConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { member } = useAuth();
  const [conv, setConv] = useState<ResaleConversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const data = await apiGet<ResaleConversation>(`/api/resale-conversations/${id}`);
      setConv(data);
    } catch {
      setConv(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const otherParty = conv && member?.id
    ? (conv.seller.id === member.id ? conv.buyer : conv.seller)
    : conv?.seller;
  const otherName = otherParty ? `${otherParty.firstName} ${otherParty.lastName}`.trim() : "Unknown";
  const itemTitle = conv?.storeItem?.title ?? "Item";

  const handleReportConversation = () => {
    setMenuOpen(false);
    if (!id) return;
    Alert.alert(
      "Report conversation",
      "Why are you reporting this conversation?",
      [
        { text: "Political content", onPress: () => submitReport("political") },
        { text: "Nudity / explicit", onPress: () => submitReport("nudity") },
        { text: "Spam", onPress: () => submitReport("spam") },
        { text: "Other", onPress: () => submitReport("other") },
        { text: "Cancel", style: "cancel" },
      ]
    );
  };
  const submitReport = async (reason: "political" | "hate" | "nudity" | "spam" | "other") => {
    if (!id) return;
    try {
      await apiPost("/api/reports", {
        contentType: "resale_message",
        contentId: id,
        reason,
      });
      Alert.alert("Report submitted", "Thank you. We will review this.");
    } catch (e) {
      Alert.alert("Couldn't submit", (e as { error?: string }).error ?? "Try again.");
    }
  };

  const handleBlockUser = () => {
    setMenuOpen(false);
    if (!otherParty) return;
    Alert.alert(
      "Block user",
      `Block ${otherName}? They will not be able to message you.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Block",
          style: "destructive",
          onPress: async () => {
            try {
              await apiPost("/api/members/block", { memberId: otherParty.id });
              await apiPost("/api/reports", {
                contentType: "resale_message",
                contentId: id ?? "",
                reason: "other",
                details: "User blocked by viewer",
              }).catch(() => {});
              router.back();
              Alert.alert("User blocked", "They have been blocked.");
            } catch (e) {
              Alert.alert("Error", (e as { error?: string }).error ?? "Could not block user.");
            }
          },
        },
      ]
    );
  };

  const send = async () => {
    if (!conv || !message.trim() || sending) return;
    const text = message.trim();
    setMessage("");
    setSending(true);
    try {
      const msg = await apiPost<{ id: string; content: string; createdAt: string; senderId: string; sender: { firstName: string; lastName: string } }>(
        `/api/resale-conversations/${id}`,
        { content: text }
      );
      setConv((prev) =>
        prev
          ? {
              ...prev,
              messages: [
                ...prev.messages,
                {
                  id: msg.id,
                  content: msg.content,
                  createdAt: msg.createdAt,
                  senderId: msg.senderId,
                  sender: msg.sender ? { id: msg.senderId, ...msg.sender } : undefined,
                },
              ],
            }
          : null
      );
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    } catch {
      setMessage(text);
    } finally {
      setSending(false);
    }
  };

  if (loading || !conv) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Resale</Text>
        </View>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>{itemTitle}</Text>
          <Text style={styles.headerSub} numberOfLines={1}>with {otherName}</Text>
        </View>
        <Pressable onPress={() => setMenuOpen(true)} style={styles.headerMenuBtn}>
          <Ionicons name="ellipsis-vertical" size={22} color="#fff" />
        </Pressable>
      </View>

      {menuOpen && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
          <Pressable style={styles.menuOverlay} onPress={() => setMenuOpen(false)}>
            <View style={styles.menuSheet}>
              <Pressable style={styles.menuItem} onPress={handleReportConversation}>
                <Ionicons name="flag-outline" size={20} color="#c00" />
                <Text style={[styles.menuItemText, { color: "#c00" }]}>Report conversation</Text>
              </Pressable>
              {otherParty && (
                <Pressable style={styles.menuItem} onPress={handleBlockUser}>
                  <Ionicons name="ban-outline" size={20} color="#c00" />
                  <Text style={[styles.menuItemText, { color: "#c00" }]}>Block user</Text>
                </Pressable>
              )}
              <Pressable style={styles.menuItem} onPress={() => setMenuOpen(false)}>
                <Ionicons name="close" size={20} color="#666" />
                <Text style={styles.menuItemText}>Cancel</Text>
              </Pressable>
            </View>
          </Pressable>
        </Modal>
      )}

      <FlatList
        ref={flatListRef}
        data={conv.messages ?? []}
        keyExtractor={(item, index) => item.id ?? `msg-${index}`}
        contentContainerStyle={styles.messageList}
        renderItem={({ item }) => {
          const isMe = item.senderId === member?.id;
          return (
            <View style={[styles.bubbleWrap, isMe && styles.bubbleWrapMe]}>
              <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem]}>
                <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>{item.content}</Text>
              </View>
            </View>
          );
        }}
      />

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder="Message..."
          placeholderTextColor={theme.colors.placeholder}
          value={message}
          onChangeText={setMessage}
          multiline
          maxLength={5000}
          onSubmitEditing={send}
        />
        <Pressable
          style={({ pressed }) => [styles.sendBtn, (!message.trim() || sending) && styles.sendBtnDisabled, pressed && { opacity: 0.8 }]}
          onPress={send}
          disabled={!message.trim() || sending}
        >
          <Ionicons name="send" size={22} color="#fff" />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 12,
    paddingTop: 48,
    backgroundColor: theme.colors.primary,
    borderBottomWidth: 2,
    borderBottomColor: "#000",
  },
  backBtn: { padding: 8 },
  headerCenter: { flex: 1 },
  headerTitle: { fontSize: 17, fontWeight: "600", color: "#fff" },
  headerSub: { fontSize: 13, color: "rgba(255,255,255,0.9)", marginTop: 2 },
  headerMenuBtn: { padding: 8 },
  menuOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end", paddingBottom: 40 },
  menuSheet: { backgroundColor: "#fff", borderTopLeftRadius: 12, borderTopRightRadius: 12, padding: 16 },
  menuItem: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14 },
  menuItemText: { fontSize: 16, color: theme.colors.heading },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  messageList: { padding: 16, paddingBottom: 8 },
  bubbleWrap: { marginBottom: 12, alignItems: "flex-start" },
  bubbleWrapMe: { alignItems: "flex-end" },
  bubble: {
    maxWidth: "80%",
    padding: 12,
    borderRadius: 16,
    borderBottomLeftRadius: 4,
    backgroundColor: theme.colors.cream,
    borderWidth: 2,
    borderColor: "#000",
  },
  bubbleMe: {
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 4,
    backgroundColor: theme.colors.primary,
  },
  bubbleThem: {},
  bubbleText: { fontSize: 16, color: theme.colors.heading },
  bubbleTextMe: { color: "#fff" },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: 12,
    paddingBottom: 24,
    borderTopWidth: 1,
    borderTopColor: "#eee",
    backgroundColor: "#fff",
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 16,
    color: "#000",
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  sendBtnDisabled: { opacity: 0.5 },
});
