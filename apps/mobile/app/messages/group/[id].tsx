import { useCallback, useEffect, useState, useRef, useMemo, Fragment } from "react";
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
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPatch, apiPost, apiPostWithRetry, apiUploadFile } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useMobileChatRealtime } from "@/lib/use-mobile-chat-realtime";
import {
  type LiveSocketMessagePayload,
  OPTIMISTIC_MSG_ID_PREFIX,
  newOptimisticMessageId,
} from "@/lib/chat-live-types";
import { normalizeRouteParam } from "@/lib/normalize-route-param";
import { useChatBottomPullRefresh } from "@/lib/use-chat-bottom-pull-refresh";
import { setOpenChatConversationId } from "@/lib/chat-notification-suppression";
import { useChatScrollToLatest } from "@/lib/use-chat-scroll-to-latest";
import { ChatTypingRow, type ChatTypingPeer } from "@/components/ChatTypingRow";
import { ChatSeenPresenceFooter } from "@/components/ChatSeenPresenceFooter";

interface GroupConversation {
  id: string;
  name: string | null;
  createdBy: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null };
  members: { member: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null } }[];
  nextCursor?: string | null;
  messages: Array<{
    id: string;
    content: string;
    createdAt: string;
    senderId: string;
    sharedContentType?: string | null;
    sharedContentId?: string | null;
    sharedContentSlug?: string | null;
    sender?: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null };
  }>;
}

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

function resolvePhotoUrl(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
}

export default function GroupConversationScreen() {
  const { id: rawConvId } = useLocalSearchParams<{ id: string }>();
  const convId = normalizeRouteParam(rawConvId as string | string[] | undefined);
  const router = useRouter();
  const { member, loading: authLoading } = useAuth();
  const [conv, setConv] = useState<GroupConversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listRefreshing, setListRefreshing] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  useChatScrollToLatest(flatListRef, {
    conversationId: convId,
    ready: Boolean(conv && !loading),
  });

  const load = useCallback(async () => {
    if (!convId) return;
    try {
      const data = await apiGet<GroupConversation>(`/api/group-conversations/${convId}`);
      setConv(data);
      setNextCursor(data.nextCursor ?? null);
    } catch {
      setConv(null);
      setNextCursor(null);
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

  const loadMore = useCallback(async () => {
    if (!convId || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const q = new URLSearchParams({ cursor: nextCursor, limit: "50" });
      const data = await apiGet<GroupConversation>(`/api/group-conversations/${convId}?${q}`);
      setConv((prev) =>
        prev && data.messages?.length
          ? { ...prev, messages: [...prev.messages, ...data.messages] }
          : prev
      );
      setNextCursor(data.nextCursor ?? null);
    } catch {
      /* ignore */
    } finally {
      setLoadingMore(false);
    }
  }, [convId, nextCursor, loadingMore]);

  useEffect(() => {
    if (!convId) {
      setLoading(false);
      setConv(null);
      return;
    }
    load();
  }, [load, convId]);

  useFocusEffect(
    useCallback(() => {
      if (convId) {
        setOpenChatConversationId(convId);
        apiPatch(`/api/group-conversations/${convId}/read`).catch(() => {});
      }
      return () => setOpenChatConversationId(null);
    }, [convId])
  );

  const groupTypingNames = useMemo(() => {
    if (!conv?.members) return undefined;
    const r: Record<string, string> = {};
    for (const row of conv.members) {
      r[row.member.id] = row.member.firstName ?? "Member";
    }
    return r;
  }, [conv]);

  const onLiveGroupMessage = useCallback((p: LiveSocketMessagePayload) => {
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
            sharedContentType: p.sharedContentType ?? null,
            sharedContentId: p.sharedContentId ?? null,
            sharedContentSlug: p.sharedContentSlug ?? null,
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
    "group",
    convId,
    member?.id,
    load,
    { flatListRef, memberNamesById: groupTypingNames, authLoading, onLiveMessage: onLiveGroupMessage }
  );

  const typingPeersResolved = useMemo((): ChatTypingPeer[] => {
    if (!conv?.members || typingPeerIds.length === 0) return [];
    return typingPeerIds.map((tid) => {
      const row = conv.members!.find((m) => m.member.id === tid);
      const m = row?.member;
      return {
        id: tid,
        name: m ? `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() || "Someone" : "Someone",
        photoUrl: m ? resolvePhotoUrl(m.profilePhotoUrl ?? undefined) ?? null : null,
      };
    });
  }, [conv, typingPeerIds]);

  const chatPresencePeers = useMemo((): ChatTypingPeer[] => {
    if (!conv?.members || peerPresenceIds.length === 0) return [];
    return peerPresenceIds.map((id) => {
      const row = conv.members!.find((m) => m.member.id === id);
      const m = row?.member;
      return {
        id,
        name: m ? `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() || "Someone" : "Someone",
        photoUrl: m ? resolvePhotoUrl(m.profilePhotoUrl ?? undefined) ?? null : null,
      };
    });
  }, [conv, peerPresenceIds]);

  const groupName = conv?.name ?? conv?.members?.map((m) => m.member.firstName).filter(Boolean).join(", ") ?? "Group";
  const otherMembers = conv?.members?.filter((m) => m.member.id !== member?.id).map((m) => m.member) ?? [];

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
        contentType: "group_message",
        contentId: convId,
        reason,
      });
      Alert.alert("Report submitted", "Thank you. We will review this.");
    } catch (e) {
      Alert.alert("Couldn't submit", (e as { error?: string }).error ?? "Try again.");
    }
  };

  const handleBlockUser = (targetMember: { id: string; firstName: string | null; lastName: string | null }) => {
    setMenuOpen(false);
    const name = `${targetMember.firstName ?? ""} ${targetMember.lastName ?? ""}`.trim() || "User";
    Alert.alert(
      "Block user",
      `Block ${name}? They will not be able to message you in this group.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Block",
          style: "destructive",
          onPress: async () => {
            try {
              await apiPost("/api/members/block", { memberId: targetMember.id });
              await apiPost("/api/reports", {
                contentType: "group_message",
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

  const pickAndSendPhoto = async () => {
    if (!conv || sending || uploadingPhoto) return;
    stopComposerTyping();
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow access to photos to share images.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;
    setUploadingPhoto(true);
    try {
      const formData = new FormData();
      formData.append("file", {
        uri: result.assets[0].uri,
        type: result.assets[0].mimeType ?? "image/jpeg",
        name: "photo.jpg",
      } as unknown as Blob);
      formData.append("type", "image");
      const { url } = await apiUploadFile("/api/upload/post", formData);
      const fullUrl = url.startsWith("http") ? url : `${siteBase}${url.startsWith("/") ? "" : "/"}${url}`;
      const msg = await apiPostWithRetry<{
        id: string;
        content: string;
        createdAt: string;
        senderId: string;
        sharedContentType?: string;
        sharedContentId?: string;
        sender: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null };
      }>(`/api/group-conversations/${convId}`, {
        sharedContentType: "photo",
        sharedContentId: fullUrl,
        content: "",
      });
      setConv((prev) =>
        (prev
          ? {
              ...prev,
              messages: [
                ...prev.messages,
                {
                  id: msg.id,
                  content: msg.content,
                  createdAt: msg.createdAt,
                  senderId: msg.senderId,
                  sharedContentType: "photo",
                  sharedContentId: fullUrl,
                  sender: msg.sender,
                },
              ],
            }
          : null) as GroupConversation | null
      );
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (e) {
      Alert.alert("Error", (e as { error?: string }).error ?? "Photo upload failed.");
    } finally {
      setUploadingPhoto(false);
    }
  };

  const send = async () => {
    if (!conv || !message.trim() || sending || !member?.id) return;
    const text = message.trim();
    const tempId = newOptimisticMessageId();
    stopComposerTyping();
    setMessage("");
    const selfFirst = member.firstName ?? "You";
    setConv((prev) =>
      (prev
        ? {
            ...prev,
            messages: [
              ...prev.messages,
              {
                id: tempId,
                content: text,
                createdAt: new Date().toISOString(),
                senderId: member.id,
                sender: {
                  id: member.id,
                  firstName: selfFirst,
                  lastName: member.lastName ?? "",
                  profilePhotoUrl: member.profilePhotoUrl ?? null,
                },
              },
            ],
          }
        : null) as GroupConversation | null
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
      }>(`/api/group-conversations/${convId}`, { content: text });
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
              sender: msg.sender,
            },
          ],
        };
      });
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    } catch {
      setConv((prev) =>
        (prev ? { ...prev, messages: prev.messages.filter((m) => m.id !== tempId) } : null) as GroupConversation | null
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
          <Text style={styles.headerTitle}>Group</Text>
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
        <Text style={styles.headerTitle} numberOfLines={1}>{groupName}</Text>
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
              {otherMembers.map((m) => (
                <Pressable key={m.id} style={styles.menuItem} onPress={() => handleBlockUser(m)}>
                  <Ionicons name="ban-outline" size={20} color="#c00" />
                  <Text style={[styles.menuItemText, { color: "#c00" }]}>Block {m.firstName ?? "user"}</Text>
                </Pressable>
              ))}
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
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.3}
        ListFooterComponent={
          <Fragment>
            {chatPresencePeers.length > 0 ? (
              <ChatSeenPresenceFooter showSeen={false} peers={chatPresencePeers} />
            ) : null}
            {loadingMore ? (
              <View style={styles.loadMorePad}>
                <ActivityIndicator size="small" color={theme.colors.primary} />
              </View>
            ) : null}
          </Fragment>
        }
        contentContainerStyle={styles.messageList}
        renderItem={({ item }) => {
          const isMe = item.senderId === member?.id;
          const senderName = item.sender ? `${item.sender.firstName} ${item.sender.lastName}`.trim() : "";
          return (
            <View style={[styles.bubbleWrap, isMe && styles.bubbleWrapMe]}>
              {!isMe && senderName ? (
                <Text style={styles.senderLabel}>{senderName}</Text>
              ) : null}
              <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem]}>
                {item.sharedContentType === "photo" && item.sharedContentId && (
                  <Image
                    source={{ uri: resolvePhotoUrl(item.sharedContentId) ?? item.sharedContentId }}
                    style={styles.sharedPhoto}
                    resizeMode="cover"
                  />
                )}
                {item.content ? (
                  <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>{item.content}</Text>
                ) : null}
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
        <Pressable
          style={({ pressed }) => [styles.photoBtn, (sending || uploadingPhoto) && styles.sendBtnDisabled, pressed && { opacity: 0.8 }]}
          onPress={pickAndSendPhoto}
          disabled={sending || uploadingPhoto}
        >
          {uploadingPhoto ? (
            <ActivityIndicator size="small" color={theme.colors.primary} />
          ) : (
            <Ionicons name="image-outline" size={24} color={theme.colors.primary} />
          )}
        </Pressable>
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
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    color: "#fff",
  },
  headerMenuBtn: { padding: 8 },
  menuOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end", paddingBottom: 40 },
  menuSheet: { backgroundColor: "#fff", borderTopLeftRadius: 12, borderTopRightRadius: 12, padding: 16 },
  menuItem: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14 },
  menuItemText: { fontSize: 16, color: theme.colors.heading },
  loadMorePad: { paddingVertical: 16, alignItems: "center" },
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
  senderLabel: {
    fontSize: 12,
    color: theme.colors.placeholder,
    marginBottom: 2,
    marginLeft: 4,
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
  sharedPhoto: { width: 200, height: 200, borderRadius: 12, marginBottom: 8 },
  photoBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 4,
  },
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
