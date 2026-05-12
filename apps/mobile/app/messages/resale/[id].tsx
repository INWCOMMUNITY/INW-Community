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
import { useFocusEffect } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
import { setOpenChatConversationId } from "@/lib/chat-notification-suppression";
import { useChatBottomPullRefresh } from "@/lib/use-chat-bottom-pull-refresh";
import { useChatScrollToLatest } from "@/lib/use-chat-scroll-to-latest";
import {
  ChatIncomingActivityFooter,
  ChatSeenLine,
  LocalComposerTypingPreview,
  type ChatTypingPeer,
} from "@/components/ChatTypingRow";

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
  storeItem: { id: string; title: string; slug: string; photos?: string[] };
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
  const insets = useSafeAreaInsets();
  const { member, loading: authLoading } = useAuth();
  const [conv, setConv] = useState<ResaleConversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [seeItemOpen, setSeeItemOpen] = useState(false);
  const [listRefreshing, setListRefreshing] = useState(false);
  const composerInputRef = useRef<TextInput | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const outboundLockRef = useRef(false);

  useChatScrollToLatest(flatListRef, {
    conversationId: convId,
    ready: Boolean(conv && !loading),
  });

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

  const {
    typingPeerIds,
    peerPresenceIds,
    localComposerTypingActive,
    onComposerChange,
    stopComposerTyping,
    onComposerFocusChange,
  } = useMobileChatRealtime("resale", convId, member?.id, load, {
    flatListRef,
    memberNamesById: resaleTypingNames,
    authLoading,
    onLiveMessage: onLiveResaleMessage,
    isComposerFocused: () => composerInputRef.current?.isFocused() ?? false,
  });

  const localTypingPeer = useMemo((): ChatTypingPeer | null => {
    if (!member?.id) return null;
    return {
      id: member.id,
      name: `${member.firstName ?? ""} ${member.lastName ?? ""}`.trim() || "You",
      photoUrl: resolvePhotoUrl(member.profilePhotoUrl ?? undefined) ?? null,
    };
  }, [member]);

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

  const presenceOnlyPeers = useMemo((): ChatTypingPeer[] => {
    const typingSet = new Set(typingPeerIds);
    return chatPresencePeers.filter((p) => !typingSet.has(p.id));
  }, [chatPresencePeers, typingPeerIds]);

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
        setOpenChatConversationId(convId);
        apiPatch(`/api/resale-conversations/${convId}/read`).catch(() => {});
      }
      return () => setOpenChatConversationId(null);
    }, [convId])
  );

  const otherParty = conv && member?.id
    ? (conv.seller.id === member.id ? conv.buyer : conv.seller)
    : conv?.seller;
  const otherName = otherParty ? `${otherParty.firstName} ${otherParty.lastName}`.trim() : "Unknown";
  const itemTitle = conv?.storeItem?.title ?? "Item";
  const itemPhotoUrl = conv?.storeItem?.photos?.[0]
    ? resolvePhotoUrl(conv.storeItem.photos[0])
    : undefined;

  const navigateToStoreItem = useCallback(() => {
    if (!conv?.storeItem?.slug) return;
    setSeeItemOpen(false);
    (router.push as (href: string) => void)(
      `/product/${conv.storeItem.slug}?listingType=resale`
    );
  }, [conv?.storeItem?.slug, router]);

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
    if (!conv || !message.trim() || !member?.id) return;
    if (outboundLockRef.current || sending) return;
    outboundLockRef.current = true;
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
      outboundLockRef.current = false;
      setSending(false);
      if (composerInputRef.current?.isFocused()) onComposerFocusChange(true);
    }
  };

  if (loading || !conv) {
    return (
      <View style={styles.container}>
        <View style={[styles.headerGreen, styles.headerGreenLoading, { paddingTop: insets.top + 28 }]}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </Pressable>
          <Text style={[styles.headerTitle, styles.headerTitleLoading]}>Resale</Text>
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
      <View style={styles.chatTopChrome}>
        <View style={[styles.headerGreen, { paddingTop: insets.top + 28 }]}>
          <View style={styles.headerRow}>
            <Pressable onPress={() => router.back()} style={styles.backBtn}>
              <Ionicons name="arrow-back" size={24} color="#fff" />
            </Pressable>
            <View style={styles.headerCenter}>
              {itemPhotoUrl ? (
                <Image source={{ uri: itemPhotoUrl }} style={styles.headerAvatar} />
              ) : (
                <View style={[styles.headerAvatar, styles.headerAvatarPlaceholder]}>
                  <Ionicons name="bag-outline" size={24} color="#fff" />
                </View>
              )}
              <View style={styles.headerTextCol}>
                <Text style={styles.headerTitle} numberOfLines={1}>
                  {itemTitle}
                </Text>
                <Text style={styles.headerSub} numberOfLines={1}>
                  with {otherName}
                </Text>
              </View>
            </View>
            <Pressable onPress={() => setMenuOpen(true)} style={styles.headerMenuBtn}>
              <Ionicons name="ellipsis-vertical" size={22} color="#fff" />
            </Pressable>
          </View>

          <Pressable
            style={styles.seeItemBar}
            onPress={() => setSeeItemOpen((o) => !o)}
            accessibilityRole="button"
            accessibilityLabel={seeItemOpen ? "Hide item details" : "See item, show details"}
          >
            <Ionicons name="bag-outline" size={20} color={theme.colors.cream} />
            <Text style={styles.seeItemBarText}>See item</Text>
            <View style={styles.seeItemBannerSpacer} />
            <Ionicons
              name={seeItemOpen ? "chevron-up" : "chevron-down"}
              size={22}
              color={theme.colors.cream}
            />
          </Pressable>
        </View>

        {seeItemOpen ? (
          <View style={styles.seeItemFlyout}>
            {itemPhotoUrl ? (
              <Image source={{ uri: itemPhotoUrl }} style={styles.seeItemPanelImage} />
            ) : (
              <View style={[styles.seeItemPanelImage, styles.seeItemPanelImagePlaceholder]}>
                <Ionicons name="image-outline" size={28} color={theme.colors.primary} />
              </View>
            )}
            <View style={styles.seeItemPanelBody}>
              <Text style={styles.seeItemPanelTitle} numberOfLines={3}>
                {itemTitle}
              </Text>
              <Pressable
                style={({ pressed }) => [styles.seeItemPanelBtn, pressed && { opacity: 0.9 }]}
                onPress={navigateToStoreItem}
              >
                <Text style={styles.seeItemPanelBtnText}>View listing</Text>
                <Ionicons name="open-outline" size={18} color="#fff" />
              </Pressable>
            </View>
          </View>
        ) : null}
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
        style={styles.messageListFlex}
        data={conv.messages ?? []}
        extraData={`${conv.messages?.length ?? 0}-${typingPeersResolved.length}-${chatPresencePeers.length}-${showResaleSeen}-${localComposerTypingActive}-${seeItemOpen}`}
        keyExtractor={(item, index) => item.id ?? `msg-${index}`}
        onScroll={onBottomPullScroll}
        scrollEventThrottle={scrollEventThrottle}
        bounces
        overScrollMode="always"
        contentContainerStyle={styles.messageList}
        ListFooterComponent={
          <Fragment>
            {typingPeersResolved.length > 0 || chatPresencePeers.length > 0 ? (
              <ChatIncomingActivityFooter
                typingPeers={typingPeersResolved}
                presenceOnlyPeers={presenceOnlyPeers}
              />
            ) : null}
            {localComposerTypingActive && localTypingPeer ? (
              <LocalComposerTypingPreview peer={localTypingPeer} />
            ) : null}
            <ChatSeenLine visible={showResaleSeen} />
          </Fragment>
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

      <View
        style={[
          styles.inputRow,
          {
            paddingBottom:
              12 + Math.max(insets.bottom, Platform.OS === "android" ? 12 : 0),
          },
        ]}
      >
        <TextInput
          ref={composerInputRef}
          style={styles.input}
          placeholder="Message..."
          placeholderTextColor={theme.colors.placeholder}
          value={message}
          onChangeText={(t) => onComposerChange(t, setMessage)}
          multiline
          maxLength={5000}
          blurOnSubmit={false}
          autoCorrect={true}
          onFocus={() => onComposerFocusChange(true)}
          onBlur={() => onComposerFocusChange(false)}
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
  chatTopChrome: {
    zIndex: 10,
    elevation: 12,
    backgroundColor: "#fff",
    borderBottomWidth: 2,
    borderBottomColor: "#000",
  },
  headerGreen: {
    backgroundColor: theme.colors.primary,
    paddingHorizontal: 10,
    paddingBottom: 8,
  },
  headerGreenLoading: {
    flexDirection: "row",
    alignItems: "center",
    paddingBottom: 18,
    borderBottomWidth: 2,
    borderBottomColor: "#000",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingBottom: 6,
  },
  seeItemBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 12,
    marginTop: 4,
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.35)",
  },
  seeItemBarText: {
    fontSize: 16,
    fontWeight: "700",
    color: theme.colors.cream,
  },
  seeItemBannerSpacer: { flex: 1 },
  seeItemFlyout: {
    flexDirection: "row",
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
    backgroundColor: "#fff",
  },
  backBtn: { padding: 8 },
  headerCenter: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  headerAvatar: { width: 52, height: 52, borderRadius: 26 },
  headerAvatarPlaceholder: {
    backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  seeItemPanelImage: {
    width: 76,
    height: 76,
    borderRadius: 8,
    backgroundColor: "#f0f0f0",
  },
  seeItemPanelImagePlaceholder: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.colors.primary,
  },
  seeItemPanelBody: { flex: 1, minWidth: 0, justifyContent: "center", gap: 10 },
  seeItemPanelTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: theme.colors.heading,
    lineHeight: 20,
  },
  seeItemPanelBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    alignSelf: "flex-start",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
    borderWidth: 2,
    borderColor: "#000",
  },
  seeItemPanelBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#fff",
  },
  headerTextCol: { flex: 1, minWidth: 0 },
  headerTitle: { fontSize: 19, fontWeight: "700", color: "#fff" },
  headerTitleLoading: { flex: 1, marginLeft: 4 },
  headerSub: { fontSize: 14, color: "rgba(255,255,255,0.92)", marginTop: 3 },
  headerMenuBtn: { padding: 8 },
  menuOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end", paddingBottom: 40 },
  menuSheet: { backgroundColor: "#fff", borderTopLeftRadius: 12, borderTopRightRadius: 12, padding: 16 },
  menuItem: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14 },
  menuItemText: { fontSize: 16, color: theme.colors.heading },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  messageListFlex: { flex: 1 },
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
    paddingHorizontal: 12,
    paddingTop: 12,
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
