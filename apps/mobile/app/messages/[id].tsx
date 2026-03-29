import { useCallback, useEffect, useState, useRef, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  TouchableOpacity,
  Image,
  Modal,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system";
import * as MediaLibrary from "expo-media-library";
import { useFocusEffect } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPost, apiPostWithRetry, apiPatch, apiUploadFile } from "@/lib/api";
import { useMobileChatRealtime } from "@/lib/use-mobile-chat-realtime";
import {
  type LiveSocketMessagePayload,
  OPTIMISTIC_MSG_ID_PREFIX,
  newOptimisticMessageId,
} from "@/lib/chat-live-types";
import { useAuth } from "@/contexts/AuthContext";
import { normalizeRouteParam } from "@/lib/normalize-route-param";
import { useChatBottomPullRefresh } from "@/lib/use-chat-bottom-pull-refresh";
import { ChatTypingRow, type ChatTypingPeer } from "@/components/ChatTypingRow";
import { ChatSeenPresenceFooter } from "@/components/ChatSeenPresenceFooter";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

interface SharedBusiness {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  shortDescription: string | null;
}

interface DirectConversation {
  id: string;
  status?: string;
  requestedByMemberId?: string | null;
  memberALastReadAt?: string | null;
  memberBLastReadAt?: string | null;
  memberA: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null };
  memberB: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null };
  messages: Array<{
    id: string;
    content: string;
    createdAt: string;
    senderId: string;
    sharedContentType?: string | null;
    sharedContentId?: string | null;
    sharedContentSlug?: string | null;
    sharedBusiness?: SharedBusiness;
    likeCount?: number;
    liked?: boolean;
    likedBy?: { id: string; profilePhotoUrl: string | null; firstName: string }[];
    sender?: { id: string; firstName: string; lastName: string; profilePhotoUrl?: string | null };
  }>;
}

function resolvePhotoUrl(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
}

function PhotoViewerModal({
  visible,
  photoUri,
  onClose,
  onSave,
  saving,
}: {
  visible: boolean;
  photoUri: string | null;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  if (!visible || !photoUri) return null;
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={photoViewerStyles.overlay}>
        <Pressable style={photoViewerStyles.backdrop} onPress={onClose} />
        <View style={photoViewerStyles.content}>
          <ScrollView
            style={photoViewerStyles.scroll}
            contentContainerStyle={photoViewerStyles.scrollContent}
            maximumZoomScale={4}
            minimumZoomScale={0.5}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
          >
            <Image
              source={{ uri: photoUri }}
              style={photoViewerStyles.image}
              resizeMode="contain"
            />
          </ScrollView>
          <View style={photoViewerStyles.actions}>
            <Pressable style={photoViewerStyles.actionBtn} onPress={onSave} disabled={saving}>
              {saving ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="download-outline" size={24} color="#fff" />}
              <Text style={photoViewerStyles.actionText}>{saving ? "Saving..." : "Save"}</Text>
            </Pressable>
            <Pressable style={photoViewerStyles.actionBtn} onPress={onClose}>
              <Ionicons name="close" size={24} color="#fff" />
              <Text style={photoViewerStyles.actionText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const photoViewerStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.9)" },
  backdrop: { ...StyleSheet.absoluteFillObject },
  content: { flex: 1, justifyContent: "center" },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: "center", alignItems: "center", minHeight: SCREEN_HEIGHT },
  image: { width: SCREEN_WIDTH, height: SCREEN_HEIGHT * 0.7 },
  actions: { flexDirection: "row", justifyContent: "center", gap: 24, paddingVertical: 24 },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 8 },
  actionText: { color: "#fff", fontSize: 16 },
});

export default function DirectConversationScreen() {
  const { id: rawConvId } = useLocalSearchParams<{ id: string }>();
  const convId = normalizeRouteParam(
    rawConvId as string | string[] | undefined
  );
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { member, loading: authLoading } = useAuth();
  const [conv, setConv] = useState<DirectConversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoViewerUri, setPhotoViewerUri] = useState<string | null>(null);
  const [savingPhoto, setSavingPhoto] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [acceptDeclineLoading, setAcceptDeclineLoading] = useState(false);
  const [listRefreshing, setListRefreshing] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const lastTapRef = useRef<{ messageId: string; time: number } | null>(null);

  const load = useCallback(async () => {
    if (!convId) return;
    setLoadError(null);
    try {
      const data = await apiGet<DirectConversation>(`/api/direct-conversations/${convId}`);
      setConv(data);
    } catch (e) {
      setConv(null);
      const err = e as { error?: string };
      setLoadError(err.error ?? "Could not load conversation");
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

  const directTypingNames = useMemo(() => {
    if (!conv || !member?.id) return undefined;
    const other = conv.memberA.id === member.id ? conv.memberB : conv.memberA;
    return { [other.id]: other.firstName ?? "Member" };
  }, [conv, member?.id]);

  const onLiveDirectMessage = useCallback((p: LiveSocketMessagePayload) => {
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
    "direct",
    convId,
    member?.id,
    load,
    { flatListRef, memberNamesById: directTypingNames, authLoading, onLiveMessage: onLiveDirectMessage }
  );

  const typingPeersResolved = useMemo((): ChatTypingPeer[] => {
    if (!conv || !member?.id || typingPeerIds.length === 0) return [];
    const other = conv.memberA.id === member.id ? conv.memberB : conv.memberA;
    const peerTyping = typingPeerIds.filter((tid) => tid && tid !== member.id);
    if (peerTyping.length === 0) return [];
    return peerTyping.map((tid) => {
      const m =
        conv.memberA.id === tid ? conv.memberA : conv.memberB.id === tid ? conv.memberB : other;
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
      const m = conv.memberA.id === id ? conv.memberA : conv.memberB.id === id ? conv.memberB : null;
      if (!m) return { id, name: "Member", photoUrl: null };
      const name = `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() || "Member";
      return { id, name, photoUrl: resolvePhotoUrl(m.profilePhotoUrl ?? undefined) ?? null };
    });
  }, [conv, peerPresenceIds]);

  const showDirectSeen = useMemo(() => {
    if (!conv || !member?.id) return false;
    const peerRead =
      conv.memberA.id === member.id ? conv.memberBLastReadAt : conv.memberALastReadAt;
    if (!peerRead) return false;
    const myOutbound = conv.messages.filter((m) => m.senderId === member.id);
    const lastMine = myOutbound[myOutbound.length - 1];
    if (!lastMine) return false;
    return new Date(peerRead).getTime() >= new Date(lastMine.createdAt).getTime();
  }, [conv, member?.id]);

  useFocusEffect(
    useCallback(() => {
      if (convId) {
        apiPatch(`/api/direct-conversations/${convId}/read`).catch(() => {});
      }
    }, [convId])
  );

  const handleLike = async (messageId: string) => {
    if (!convId || !member) return;
    try {
      const { liked } = await apiPost<{ liked: boolean }>(
        `/api/direct-conversations/${convId}/messages/${messageId}/like`,
        {}
      );
      setConv((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          messages: prev.messages.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  liked,
                  likeCount: (m.likeCount ?? 0) + (liked ? 1 : -1),
                  likedBy: liked
                    ? [...(m.likedBy ?? []), { id: member.id ?? "", profilePhotoUrl: member.profilePhotoUrl ?? null, firstName: member.firstName }]
                    : (m.likedBy ?? []).filter((u) => u.id !== member.id),
                }
              : m
          ),
        };
      });
    } catch {
      // ignore
    }
  };

  const formatLikedBy = (likedBy: { firstName: string }[]) => {
    if (!likedBy?.length) return "";
    const names = likedBy.map((u) => u.firstName);
    if (names.length === 1) return `Liked by ${names[0]}`;
    if (names.length === 2) return `Liked by ${names[0]} and ${names[1]}`;
    if (names.length === 3) return `Liked by ${names[0]}, ${names[1]}, and ${names[2]}`;
    return `Liked by ${names[0]}, ${names[1]}, and ${names.length - 2} others`;
  };

  const handleBubblePress = (item: DirectConversation["messages"][0]) => {
    const now = Date.now();
    const prev = lastTapRef.current;
    const DOUBLE_TAP_MS = 500;
    if (prev && prev.messageId === item.id && now - prev.time < DOUBLE_TAP_MS) {
      lastTapRef.current = null;
      handleLike(item.id);
      return;
    }
    lastTapRef.current = { messageId: item.id, time: now };
    setTimeout(() => {
      if (lastTapRef.current?.messageId === item.id && lastTapRef.current?.time === now) {
        lastTapRef.current = null;
        if (item.sharedContentType === "photo" && item.sharedContentId) {
          setPhotoViewerUri(resolvePhotoUrl(item.sharedContentId) ?? item.sharedContentId);
        }
      }
    }, DOUBLE_TAP_MS);
  };

  const handleSavePhoto = async () => {
    if (!photoViewerUri) return;
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow access to save photos to your library.");
      return;
    }
    setSavingPhoto(true);
    try {
      const filename = `nwc_${Date.now()}.jpg`;
      const docDir = (FileSystem as { documentDirectory?: string }).documentDirectory ?? "";
      const localPath = `${docDir}${filename}`;
      const { uri } = await FileSystem.downloadAsync(photoViewerUri, localPath);
      await MediaLibrary.createAssetAsync(uri);
      Alert.alert("Saved", "Photo saved to your library.");
      setPhotoViewerUri(null);
    } catch (e) {
      Alert.alert("Error", (e as Error).message ?? "Could not save photo.");
    } finally {
      setSavingPhoto(false);
    }
  };

  const isMessageRequest = conv?.status === "pending" && conv?.requestedByMemberId !== member?.id;

  const handleAcceptRequest = useCallback(async () => {
    if (!convId || acceptDeclineLoading) return;
    setAcceptDeclineLoading(true);
    try {
      await apiPatch(`/api/direct-conversations/${convId}`, { action: "accept" });
      load();
    } catch (e) {
      Alert.alert("Error", (e as { error?: string }).error ?? "Could not accept request.");
    } finally {
      setAcceptDeclineLoading(false);
    }
  }, [convId, acceptDeclineLoading, load]);

  const handleDeclineRequest = useCallback(async () => {
    if (!convId || acceptDeclineLoading) return;
    setAcceptDeclineLoading(true);
    try {
      await apiPatch(`/api/direct-conversations/${convId}`, { action: "decline" });
      router.back();
    } catch (e) {
      Alert.alert("Error", (e as { error?: string }).error ?? "Could not decline.");
    } finally {
      setAcceptDeclineLoading(false);
    }
  }, [convId, acceptDeclineLoading, router]);

  const otherMember = conv && member?.id
    ? (conv.memberA.id === member.id ? conv.memberB : conv.memberA)
    : conv?.memberA;
  const otherName = otherMember ? `${otherMember.firstName} ${otherMember.lastName}`.trim() : "Unknown";
  const otherPhoto = resolvePhotoUrl(otherMember?.profilePhotoUrl ?? undefined);

  const handleReportConversation = () => {
    setMenuOpen(false);
    if (!conv || !convId) return;
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
        contentType: "direct_message",
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
    if (!otherMember || !member) return;
    Alert.alert(
      "Block user",
      `Block ${otherName}? They will not be able to message you and their messages will be hidden.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Block",
          style: "destructive",
          onPress: async () => {
            try {
              await apiPost("/api/members/block", { memberId: otherMember.id });
              await apiPost("/api/reports", {
                contentType: "direct_message",
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
      const res = await apiPostWithRetry<{ id: string; content: string; createdAt: string; senderId: string; sharedContentType?: string; sharedContentId?: string; sender: { firstName: string; lastName: string }; botReply?: { id: string; content: string; createdAt: string; senderId: string; sender: { id: string; firstName: string; lastName: string } } }>(
        `/api/direct-conversations/${convId}`,
        { sharedContentType: "photo", sharedContentId: fullUrl, content: "" }
      );
      const newMessages: typeof conv.messages = [
        {
          id: res.id,
          content: res.content,
          createdAt: res.createdAt,
          senderId: res.senderId,
          sharedContentType: "photo",
          sharedContentId: fullUrl,
          sender: res.sender ? { ...res.sender, id: res.senderId } : undefined,
          likeCount: 0,
          liked: false,
        },
      ];
      if (res.botReply) {
        newMessages.push({
          id: res.botReply.id,
          content: res.botReply.content,
          createdAt: res.botReply.createdAt,
          senderId: res.botReply.senderId,
          sender: res.botReply.sender ? { ...res.botReply.sender, id: res.botReply.senderId } : undefined,
          likeCount: 0,
          liked: false,
        });
      }
      setConv((prev) =>
        (prev ? { ...prev, messages: [...prev.messages, ...newMessages] } : null) as DirectConversation | null
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
                likeCount: 0,
                liked: false,
              },
            ],
          }
        : null) as DirectConversation | null
    );
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
    setSending(true);
    try {
      const res = await apiPostWithRetry<{ id: string; content: string; createdAt: string; senderId: string; sender: { firstName: string; lastName: string }; botReply?: { id: string; content: string; createdAt: string; senderId: string; sender: { id: string; firstName: string; lastName: string } } }>(
        `/api/direct-conversations/${convId}`,
        { content: text }
      );
      const newMessages: typeof conv.messages = [
        {
          id: res.id,
          content: res.content,
          createdAt: res.createdAt,
          senderId: res.senderId,
          sender: res.sender ? { ...res.sender, id: res.senderId } : undefined,
          likeCount: 0,
          liked: false,
        },
      ];
      if (res.botReply) {
        newMessages.push({
          id: res.botReply.id,
          content: res.botReply.content,
          createdAt: res.botReply.createdAt,
          senderId: res.botReply.senderId,
          sender: res.botReply.sender,
          likeCount: 0,
          liked: false,
        });
      }
      setConv((prev) => {
        if (!prev) return null;
        const rest = prev.messages.filter((m) => m.id !== tempId);
        return { ...prev, messages: [...rest, ...newMessages] };
      });
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (e) {
      setConv((prev) =>
        (prev ? { ...prev, messages: prev.messages.filter((m) => m.id !== tempId) } : null) as DirectConversation | null
      );
      setMessage(text);
      const err = e as { error?: string };
      Alert.alert("Message not sent", err.error ?? "Please try again.");
    } finally {
      setSending(false);
    }
  };

  if (loading && !conv) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Chat</Text>
        </View>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      </View>
    );
  }

  if (!conv) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Chat</Text>
        </View>
        <View style={styles.center}>
          <Text style={styles.errorText}>{loadError ?? "Conversation not found"}</Text>
          <Pressable style={styles.retryBtn} onPress={() => { setLoading(true); load(); }}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
    >
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <View style={styles.headerCenter}>
          {otherPhoto ? (
            <Image source={{ uri: otherPhoto }} style={styles.headerAvatar} />
          ) : (
            <View style={[styles.headerAvatar, styles.avatarPlaceholder]}>
              <Ionicons name="person" size={20} color={theme.colors.placeholder} />
            </View>
          )}
          <Text style={styles.headerTitle} numberOfLines={1}>{otherName}</Text>
        </View>
        <Pressable onPress={() => setMenuOpen(true)} style={styles.headerMenuBtn}>
          <Ionicons name="ellipsis-vertical" size={22} color="#fff" />
        </Pressable>
      </View>

      {typingPeersResolved.length > 0 && !isMessageRequest && (
        <ChatTypingRow peers={typingPeersResolved} />
      )}

      {isMessageRequest && (
        <View style={styles.requestBanner}>
          <Text style={styles.requestBannerText}>Message request — accept to continue the conversation</Text>
          <View style={styles.requestBannerActions}>
            <Pressable
              style={[styles.requestAcceptBtn, acceptDeclineLoading && styles.requestBtnDisabled]}
              onPress={handleAcceptRequest}
              disabled={acceptDeclineLoading}
            >
              {acceptDeclineLoading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.requestAcceptBtnText}>Accept</Text>
              )}
            </Pressable>
            <Pressable
              style={[styles.requestDeclineBtn, acceptDeclineLoading && styles.requestBtnDisabled]}
              onPress={handleDeclineRequest}
              disabled={acceptDeclineLoading}
            >
              <Text style={styles.requestDeclineBtnText}>Decline</Text>
            </Pressable>
          </View>
        </View>
      )}

      {menuOpen && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
          <Pressable style={styles.menuOverlay} onPress={() => setMenuOpen(false)}>
            <View style={styles.menuSheet}>
              <Pressable style={styles.menuItem} onPress={handleReportConversation}>
                <Ionicons name="flag-outline" size={20} color="#c00" />
                <Text style={[styles.menuItemText, { color: "#c00" }]}>Report conversation</Text>
              </Pressable>
              <Pressable style={styles.menuItem} onPress={handleBlockUser}>
                <Ionicons name="ban-outline" size={20} color="#c00" />
                <Text style={[styles.menuItemText, { color: "#c00" }]}>Block user</Text>
              </Pressable>
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
        extraData={conv.messages?.length ?? 0}
        keyExtractor={(item, index) => item.id ?? `msg-${index}`}
        onScroll={onBottomPullScroll}
        scrollEventThrottle={scrollEventThrottle}
        bounces={true}
        overScrollMode="always"
        contentContainerStyle={styles.messageList}
        ListFooterComponent={
          showDirectSeen || chatPresencePeers.length > 0 ? (
            <ChatSeenPresenceFooter showSeen={showDirectSeen} peers={chatPresencePeers} />
          ) : null
        }
        renderItem={({ item }) => {
          const isMe = item.senderId === member?.id;
          const hasBusinessShare = item.sharedContentType === "business" && (item.sharedBusiness || item.sharedContentSlug);
          const hasEventShare = item.sharedContentType === "event" && !!item.sharedContentSlug;
          const isPhotoOnly = item.sharedContentType === "photo" && item.sharedContentId && !item.content?.trim();
          const photoUri = item.sharedContentType === "photo" && item.sharedContentId
            ? (resolvePhotoUrl(item.sharedContentId) ?? item.sharedContentId)
            : null;
          const bubbleStyle = isPhotoOnly
            ? [styles.bubble, styles.bubblePhoto]
            : [styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem];

          return (
            <View style={[styles.bubbleWrap, isMe && styles.bubbleWrapMe]}>
              <TouchableOpacity
                onPress={() => handleBubblePress(item)}
                style={bubbleStyle}
                activeOpacity={0.9}
                delayPressIn={0}
              >
                {item.sharedContentType === "photo" && item.sharedContentId && (
                  <Image
                    source={{ uri: photoUri ?? undefined }}
                    style={styles.sharedPhoto}
                    resizeMode="cover"
                  />
                )}
                {hasEventShare && (
                  <Pressable
                    style={({ pressed }) => [styles.sharedEventCard, pressed && { opacity: 0.9 }]}
                    onPress={() => item.sharedContentSlug && router.push(`/event/${item.sharedContentSlug}`)}
                  >
                    <View style={[styles.sharedEventIconWrap, isMe && styles.sharedEventIconWrapMe]}>
                      <Ionicons name="calendar-outline" size={28} color={isMe ? "#fff" : theme.colors.primary} />
                    </View>
                    <View style={styles.sharedEventContent}>
                      <Text style={[styles.sharedEventLabel, isMe && styles.sharedBusinessTextMe]}>
                        Local event
                      </Text>
                      <Text style={[styles.sharedEventLink, isMe && styles.sharedBusinessLinkMe]}>
                        Open event →
                      </Text>
                    </View>
                  </Pressable>
                )}
                {hasBusinessShare && (
                  <Pressable
                    style={({ pressed }) => [styles.sharedBusinessCard, pressed && { opacity: 0.9 }]}
                    onPress={() => item.sharedContentSlug && router.push(`/business/${item.sharedContentSlug}`)}
                  >
                    {item.sharedBusiness?.logoUrl ? (
                      <Image
                        source={{ uri: resolvePhotoUrl(item.sharedBusiness!.logoUrl) ?? item.sharedBusiness!.logoUrl! }}
                        style={styles.sharedBusinessLogo}
                        resizeMode="cover"
                      />
                    ) : (
                      <View style={[styles.sharedBusinessLogo, styles.sharedBusinessLogoPlaceholder]}>
                        <Ionicons name="business" size={32} color={theme.colors.primary} />
                      </View>
                    )}
                    <View style={styles.sharedBusinessContent}>
                      <Text style={[styles.sharedBusinessName, isMe && styles.sharedBusinessTextMe]}>
                        {item.sharedBusiness?.name ?? "Local Business"}
                      </Text>
                      {item.sharedBusiness?.shortDescription ? (
                        <Text style={[styles.sharedBusinessDesc, isMe && styles.sharedBusinessTextMe]} numberOfLines={2}>
                          {item.sharedBusiness.shortDescription}
                        </Text>
                      ) : null}
                      <Text style={[styles.sharedBusinessLink, isMe && styles.sharedBusinessLinkMe]}>
                        View business →
                      </Text>
                    </View>
                  </Pressable>
                )}
                {item.content ? (
                  <Text style={[styles.bubbleText, isMe && !isPhotoOnly && styles.bubbleTextMe]}>{item.content}</Text>
                ) : null}
              </TouchableOpacity>
              {(item.likeCount ?? 0) > 0 && (
                <View style={[styles.likedBadge, isMe && styles.likedBadgeMe]}>
                  <Ionicons name="heart" size={12} color={theme.colors.primary} />
                  <Text style={styles.likedBadgeText}>
                    {formatLikedBy(item.likedBy ?? []) ||
                      (() => {
                        const n = item.likeCount ?? 0;
                        return n === 1 ? "1 like" : `${n} likes`;
                      })()}
                  </Text>
                </View>
              )}
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
          multiline={true}
          maxLength={5000}
          onSubmitEditing={send}
          autoCorrect={true}
          autoComplete="off"
          textContentType="none"
        />
        <Pressable
          style={({ pressed }) => [styles.sendBtn, (!message.trim() || sending) && styles.sendBtnDisabled, pressed && { opacity: 0.8 }]}
          onPress={send}
          disabled={!message.trim() || sending}
        >
          <Ionicons name="send" size={22} color="#fff" />
        </Pressable>
      </View>

      <PhotoViewerModal
        visible={!!photoViewerUri}
        photoUri={photoViewerUri}
        onClose={() => setPhotoViewerUri(null)}
        onSave={handleSavePhoto}
        saving={savingPhoto}
      />
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
    backgroundColor: theme.colors.primary,
    borderBottomWidth: 2,
    borderBottomColor: "#000",
  },
  backBtn: { padding: 8 },
  headerCenter: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  headerAvatar: { width: 36, height: 36, borderRadius: 18 },
  avatarPlaceholder: { backgroundColor: theme.colors.cream, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 17, fontWeight: "600", color: "#fff", flex: 1 },
  headerMenuBtn: { padding: 8 },
  menuOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end", paddingBottom: 40 },
  menuSheet: { backgroundColor: "#fff", borderTopLeftRadius: 12, borderTopRightRadius: 12, padding: 16 },
  menuItem: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14 },
  menuItemText: { fontSize: 16, color: theme.colors.heading },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  errorText: { fontSize: 16, color: "#666", textAlign: "center", marginBottom: 16 },
  retryBtn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: theme.colors.primary,
    borderRadius: 8,
  },
  retryBtnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  requestBanner: {
    backgroundColor: theme.colors.cream ?? "#f5f5f5",
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  requestBannerText: { fontSize: 14, color: "#333", marginBottom: 10 },
  requestBannerActions: { flexDirection: "row", gap: 12 },
  requestAcceptBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
  },
  requestAcceptBtnText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  requestDeclineBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#999",
  },
  requestDeclineBtnText: { fontSize: 15, color: "#666", fontWeight: "600" },
  requestBtnDisabled: { opacity: 0.7 },
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
  bubblePhoto: {
    backgroundColor: "#f5f5f5",
    borderColor: "#e0e0e0",
  },
  bubbleText: { fontSize: 16, color: theme.colors.heading },
  bubbleTextMe: { color: "#fff" },
  likedBadge: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
    marginLeft: 4,
    gap: 4,
  },
  likedBadgeMe: { alignSelf: "flex-end", marginLeft: 0, marginRight: 4 },
  likedBadgeText: { fontSize: 11, color: theme.colors.primary },
  sharedPhoto: { width: 200, height: 200, borderRadius: 12, marginBottom: 8 },
  sharedEventCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    marginBottom: 8,
    backgroundColor: "rgba(255,255,255,0.3)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.1)",
    minWidth: 200,
    maxWidth: 260,
  },
  sharedEventIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  sharedEventIconWrapMe: {
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  sharedEventContent: { flex: 1, minWidth: 0 },
  sharedEventLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: theme.colors.heading,
    marginBottom: 4,
  },
  sharedEventLink: {
    fontSize: 12,
    color: theme.colors.primary,
    fontWeight: "600",
  },
  sharedBusinessCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    marginBottom: 8,
    backgroundColor: "rgba(255,255,255,0.3)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.1)",
    minWidth: 200,
    maxWidth: 260,
  },
  sharedBusinessLogo: {
    width: 56,
    height: 56,
    borderRadius: 8,
  },
  sharedBusinessLogoPlaceholder: {
    backgroundColor: "rgba(255,255,255,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  sharedBusinessContent: { flex: 1, minWidth: 0 },
  sharedBusinessName: {
    fontSize: 15,
    fontWeight: "600",
    color: theme.colors.heading,
    marginBottom: 4,
  },
  sharedBusinessDesc: {
    fontSize: 12,
    color: "#666",
    marginBottom: 4,
  },
  sharedBusinessTextMe: { color: "#fff" },
  sharedBusinessLink: {
    fontSize: 12,
    color: theme.colors.primary,
    fontWeight: "600",
  },
  sharedBusinessLinkMe: { color: "#fff" },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: "#eee",
    backgroundColor: "#fff",
  },
  photoBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 4,
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
