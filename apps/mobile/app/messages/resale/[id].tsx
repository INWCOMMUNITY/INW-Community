import { useCallback, useEffect, useState, useRef, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  Pressable,
  Image,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Modal,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPatch, apiPost, apiPostWithRetry } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useMobileChatRealtime } from "@/lib/use-mobile-chat-realtime";
import {
  type LiveSocketMessagePayload,
  OPTIMISTIC_MSG_ID_PREFIX,
  newOptimisticMessageId,
} from "@/lib/chat-live-types";
import { normalizeRouteParam } from "@/lib/normalize-route-param";
import { useChatBottomPullRefresh } from "@/lib/use-chat-bottom-pull-refresh";
import { ChatTypingRow, type ChatTypingPeer } from "@/components/ChatTypingRow";
import { ChatSeenPresenceFooter } from "@/components/ChatSeenPresenceFooter";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

function resolvePhotoUrl(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
}

interface ResaleConversation {
  id: string;
  buyerLastReadAt?: string | null;
  sellerLastReadAt?: string | null;
  storeItem: { id: string; title: string; slug: string };
  buyer: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null };
  seller: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null };
  messages: Array<{
    id: string;
    content: string;
    createdAt: string;
    senderId: string;
    sender?: { id: string; firstName: string; lastName: string; profilePhotoUrl?: string | null };
  }>;
}

export default function ResaleConversationScreen() {
  const { id: rawConvId } = useLocalSearchParams<{ id: string }>();
  const convId = normalizeRouteParam(rawConvId as string | string[] | undefined);
  const router = useRouter();
  const { member, loading: authLoading } = useAuth();
  const [conv, setConv] = useState<ResaleConversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [listRefreshing, setListRefreshing] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  const load = useCallback(async () => {
    if (!convId) return;
    try {
      const data = await apiGet<ResaleConversation>(`/api/resale-conversations/${convId}`);
      setConv(data);
      if (data?.id) {
        apiPatch(`/api/resale-conversations/${convId}/read`).catch(() => {});
      }
    } catch {
      setConv(null);
    } finally {
      setLoading(false);
    }
  }, [convId]);

  const onListRefresh = useCallback(async () => {
    setListRefreshing(true);
    try {
      await load();
    } finally {
      setListRefreshing(false);
    }
  }, [load]);

  const { onScroll: onBottomPullScroll, scrollEventThrottle } = useChatBottomPullRefresh(
    onListRefresh,
    listRefreshing
  );

  useEffect(() => {
    if (!convId) {
      setLoading(false);
      setConv(null);
      return;
    }
    load();
  }, [load, convId]);

  const resaleTypingNames = useMemo(() => {
    if (!conv?.buyer?.id || !conv?.seller?.id) return undefined;
    return {
      [conv.buyer.id]: conv.buyer.firstName ?? "Member",
      [conv.seller.id]: conv.seller.firstName ?? "Member",
    };
  }, [conv]);

  const onLiveResaleMessage = useCallback((p: LiveSocketMessagePayload) => {
    if (p.conversationId !== convId) return;
    setConv((prev) => {
      if (!prev) return prev;
      if (prev.messages.some((m) => m.id === p.messageId)) return prev;
      const messages = prev.messages.filter(
        (m) =>
          !(
            m.id.startsWith(OPTIMISTIC_MSG_ID_PREFIX) &&
            m.senderId === p.senderId &&
            m.content === p.content
          )
      );
      return {
        ...prev,
        messages: [
          ...messages,
          {
            id: p.messageId,
            content: p.content,
            createdAt: p.createdAt,
            senderId: p.senderId,
            sender: p.sender
              ? {
                  id: p.sender.id,
                  firstName: p.sender.firstName,
                  lastName: p.sender.lastName,
                  profilePhotoUrl: p.sender.profilePhotoUrl ?? null,
                }
              : { id: p.senderId, firstName: "", lastName: "", profilePhotoUrl: null },
          },
        ],
      };
    });
  }, [convId]);

  const { typingPeerIds, peerPresenceIds, onComposerChange, stopComposerTyping } = useMobileChatRealtime(
    "resale",
    convId,
    member?.id,
    load,
    { flatListRef, memberNamesById: resaleTypingNames, authLoading, onLiveMessage: onLiveResaleMessage }
  );

  const typingPeersResolved = useMemo((): ChatTypingPeer[] => {
    if (!conv || !member?.id || typingPeerIds.length === 0) return [];
    const other = conv.buyer.id === member.id ? conv.seller : conv.buyer;
    const peerTyping = typingPeerIds.filter((tid) => tid && tid !== member.id);
    if (peerTyping.length === 0) return [];
    return peerTyping.map((tid) => {
      const m = tid === conv.buyer.id ? conv.buyer : tid === conv.seller.id ? conv.seller : other;
      return {
        id: tid,
        name: `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() || "Member",
        photoUrl: resolvePhotoUrl(m.profilePhotoUrl ?? undefined) ?? null,
      };
    });
  }, [conv, member?.id, typingPeerIds]);

  const chatPresencePeers = useMemo((): ChatTypingPeer[] => {
    if (!conv || peerPresenceIds.length === 0) return [];
    return peerPresenceIds.map((id) => {
      const m = id === conv.buyer.id ? conv.buyer : id === conv.seller.id ? conv.seller : null;
      return {
        id,
        name: m ? `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() || "Member" : "Member",
        photoUrl: m ? resolvePhotoUrl(m.profilePhotoUrl ?? undefined) ?? null : null,
      };
    });
  }, [conv, peerPresenceIds]);

  const showResaleSeen = useMemo(() => {
    if (!conv || !member?.id) return false;
    const uid = member.id;
    const peerRead =
      conv.buyer.id === uid ? conv.sellerLastReadAt : conv.buyerLastReadAt;
    if (!peerRead) return false;
    const myOutbound = conv.messages.filter((m) => m.senderId === uid);
    const lastMine = myOutbound[myOutbound.length - 1];
    if (!lastMine) return false;
    return new Date(peerRead).getTime() >= new Date(lastMine.createdAt).getTime();
  }, [conv, member?.id]);

  useFocusEffect(
    useCallback(() => {
      if (convId) {
        apiPatch(`/api/resale-conversations/${convId}/read`).catch(() => {});
      }
    }, [convId])
  );

  const otherParty = conv && member?.id
    ? (conv.seller.id === member.id ? conv.buyer : conv.seller)
    : conv?.seller;
  const otherName = otherParty ? `${otherParty.firstName} ${otherParty.lastName}`.trim() : "Unknown";
  const otherPhoto = otherParty ? resolvePhotoUrl(otherParty.profilePhotoUrl ?? undefined) : undefined;
  const itemTitle = conv?.storeItem?.title ?? "Item";

  const handleReportConversation = () => {
    setMenuOpen(false);
    if (!convId) return;
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
    if (!convId) return;
    try {
      await apiPost("/api/reports", {
        contentType: "resale_message",
        contentId: convId,
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
                contentId: convId ?? "",
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
    if (!conv || !message.trim() || sending || !member?.id) return;
    const memberId = member.id;
    const text = message.trim();
    const tempId = newOptimisticMessageId();
    stopComposerTyping();
    setMessage("");
    const selfFirst = member.firstName ?? "You";
    setConv((prev) =>
      prev
        ? {
            ...prev,
            messages: [
              ...prev.messages,
              {
                id: tempId,
                content: text,
                createdAt: new Date().toISOString(),
                senderId: memberId,
                sender: {
                  id: memberId,
                  firstName: selfFirst,
                  lastName: member.lastName ?? "",
                  profilePhotoUrl: member.profilePhotoUrl ?? null,
                },
              },
            ],
          }
        : null
    );
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
    setSending(true);
    try {
      const msg = await apiPostWithRetry<{
        id: string;
        content: string;
        createdAt: string;
        senderId: string;
        sender: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null };
      }>(`/api/resale-conversations/${convId}`, { content: text });
      setConv((prev) => {
        if (!prev) return null;
        const rest = prev.messages.filter((m) => m.id !== tempId);
        return {
          ...prev,
          messages: [
            ...rest,
            {
              id: msg.id,
              content: msg.content,
              createdAt: msg.createdAt,
              senderId: msg.senderId,
              sender: msg.sender ? { ...msg.sender, id: msg.senderId } : undefined,
            },
          ],
        };
      });
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    } catch {
      setConv((prev) =>
        prev ? { ...prev, messages: prev.messages.filter((m) => m.id !== tempId) } : null
      );
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
          {otherPhoto ? (
            <Image source={{ uri: otherPhoto }} style={styles.headerAvatar} />
          ) : (
            <View style={[styles.headerAvatar, styles.headerAvatarPlaceholder]}>
              <Text style={styles.headerAvatarLetter}>{(otherParty?.firstName?.trim()?.[0] || "?").toUpperCase()}</Text>
            </View>
          )}
          <View style={styles.headerTextCol}>
            <Text style={styles.headerTitle} numberOfLines={1}>{itemTitle}</Text>
            <Text style={styles.headerSub} numberOfLines={1}>with {otherName}</Text>
          </View>
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

      {typingPeersResolved.length > 0 && <ChatTypingRow peers={typingPeersResolved} />}

      <FlatList
        ref={flatListRef}
        data={conv.messages ?? []}
        extraData={conv.messages?.length ?? 0}
        keyExtractor={(item, index) => item.id ?? `msg-${index}`}
        onScroll={onBottomPullScroll}
        scrollEventThrottle={scrollEventThrottle}
        bounces
        overScrollMode="always"
        contentContainerStyle={styles.messageList}
        ListFooterComponent={
          showResaleSeen || chatPresencePeers.length > 0 ? (
            <ChatSeenPresenceFooter showSeen={showResaleSeen} peers={chatPresencePeers} />
          ) : null
        }
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

      {listRefreshing ? (
        <View style={styles.chatRefreshingStrip} accessibilityLiveRegion="polite">
          <ActivityIndicator size="small" color={theme.colors.primary} />
        </View>
      ) : null}

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder="Message..."
          placeholderTextColor={theme.colors.placeholder}
          value={message}
          onChangeText={(t) => onComposerChange(t, setMessage)}
          multiline
          maxLength={5000}
          onSubmitEditing={send}
          autoCorrect={true}
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
  headerCenter: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  headerAvatar: { width: 36, height: 36, borderRadius: 18 },
  headerAvatarPlaceholder: {
    backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerAvatarLetter: { fontSize: 15, fontWeight: "700", color: "#fff" },
  headerTextCol: { flex: 1, minWidth: 0 },
  headerTitle: { fontSize: 17, fontWeight: "600", color: "#fff" },
  headerSub: { fontSize: 13, color: "rgba(255,255,255,0.9)", marginTop: 2 },
  headerMenuBtn: { padding: 8 },
  menuOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end", paddingBottom: 40 },
  menuSheet: { backgroundColor: "#fff", borderTopLeftRadius: 12, borderTopRightRadius: 12, padding: 16 },
  menuItem: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14 },
  menuItemText: { fontSize: 16, color: theme.colors.heading },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  messageList: { padding: 16, paddingBottom: 8, flexGrow: 1, justifyContent: "flex-end" },
  bubbleWrap: { marginBottom: 12, alignItems: "flex-start" },
  bubbleWrapMe: { alignItems: "flex-end" },
  chatRefreshingStrip: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(0,0,0,0.1)",
    paddingVertical: 8,
    alignItems: "center",
    backgroundColor: "#fafafa",
  },
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
