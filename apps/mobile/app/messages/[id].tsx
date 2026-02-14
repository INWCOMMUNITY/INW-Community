import { useCallback, useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  Pressable,
  Image,
  Modal,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Dimensions,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system";
import * as MediaLibrary from "expo-media-library";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPost, apiUploadFile } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
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
    sender?: { id: string; firstName: string; lastName: string };
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
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { member } = useAuth();
  const [conv, setConv] = useState<DirectConversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoViewerUri, setPhotoViewerUri] = useState<string | null>(null);
  const [savingPhoto, setSavingPhoto] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const data = await apiGet<DirectConversation>(`/api/direct-conversations/${id}`);
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

  const handleLike = async (messageId: string) => {
    if (!id || !member) return;
    try {
      const { liked } = await apiPost<{ liked: boolean }>(
        `/api/direct-conversations/${id}/messages/${messageId}/like`,
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
                }
              : m
          ),
        };
      });
    } catch {
      // ignore
    }
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
      const localPath = `${FileSystem.documentDirectory}${filename}`;
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

  const otherMember = conv && member?.id
    ? (conv.memberA.id === member.id ? conv.memberB : conv.memberA)
    : conv?.memberA;
  const otherName = otherMember ? `${otherMember.firstName} ${otherMember.lastName}`.trim() : "Unknown";
  const otherPhoto = resolvePhotoUrl(otherMember?.profilePhotoUrl ?? undefined);

  const pickAndSendPhoto = async () => {
    if (!conv || sending || uploadingPhoto) return;
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
      const res = await apiPost<{ id: string; content: string; createdAt: string; senderId: string; sharedContentType?: string; sharedContentId?: string; sender: { firstName: string; lastName: string }; botReply?: { id: string; content: string; createdAt: string; senderId: string; sender: { id: string; firstName: string; lastName: string } } }>(
        `/api/direct-conversations/${id}`,
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
          sender: res.sender,
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
      setConv((prev) =>
        prev ? { ...prev, messages: [...prev.messages, ...newMessages] } : null
      );
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (e) {
      Alert.alert("Error", (e as { error?: string }).error ?? "Photo upload failed.");
    } finally {
      setUploadingPhoto(false);
    }
  };

  const send = async () => {
    if (!conv || !message.trim() || sending) return;
    const text = message.trim();
    setMessage("");
    setSending(true);
    try {
      const res = await apiPost<{ id: string; content: string; createdAt: string; senderId: string; sender: { firstName: string; lastName: string }; botReply?: { id: string; content: string; createdAt: string; senderId: string; sender: { id: string; firstName: string; lastName: string } } }>(
        `/api/direct-conversations/${id}`,
        { content: text }
      );
      const newMessages: typeof conv.messages = [
        {
          id: res.id,
          content: res.content,
          createdAt: res.createdAt,
          senderId: res.senderId,
          sender: res.sender,
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
      setConv((prev) =>
        prev ? { ...prev, messages: [...prev.messages, ...newMessages] } : null
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
          <Text style={styles.headerTitle}>Chat</Text>
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
            <View style={[styles.headerAvatar, styles.avatarPlaceholder]}>
              <Ionicons name="person" size={20} color={theme.colors.placeholder} />
            </View>
          )}
          <Text style={styles.headerTitle} numberOfLines={1}>{otherName}</Text>
        </View>
      </View>

      <FlatList
        ref={flatListRef}
        data={conv.messages ?? []}
        keyExtractor={(item, index) => item.id ?? `msg-${index}`}
        contentContainerStyle={styles.messageList}
        renderItem={({ item }) => {
          const isMe = item.senderId === member?.id;
          const hasBusinessShare = item.sharedContentType === "business" && (item.sharedBusiness || item.sharedContentSlug);
          const isPhotoOnly = item.sharedContentType === "photo" && item.sharedContentId && !item.content?.trim();
          const photoUri = item.sharedContentType === "photo" && item.sharedContentId
            ? (resolvePhotoUrl(item.sharedContentId) ?? item.sharedContentId)
            : null;
          const bubbleStyle = isPhotoOnly
            ? [styles.bubble, styles.bubblePhoto]
            : [styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem];
          const doubleTap = Gesture.Tap()
            .numberOfTaps(2)
            .maxDuration(400)
            .runOnJS(true)
            .onEnd(() => handleLike(item.id));
          const singleTap = Gesture.Tap()
            .numberOfTaps(1)
            .maxDuration(400)
            .runOnJS(true)
            .onEnd(() => {
              if (item.sharedContentType === "photo" && item.sharedContentId) {
                setPhotoViewerUri(resolvePhotoUrl(item.sharedContentId) ?? item.sharedContentId);
              }
            });
          singleTap.requireExternalGestureToFail(doubleTap);
          const composed = Gesture.Exclusive(doubleTap, singleTap);

          return (
            <View style={[styles.bubbleWrap, isMe && styles.bubbleWrapMe]}>
              <GestureDetector gesture={composed}>
                <View style={bubbleStyle}>
                {item.sharedContentType === "photo" && item.sharedContentId && (
                  <Image
                    source={{ uri: photoUri ?? undefined }}
                    style={styles.sharedPhoto}
                    resizeMode="cover"
                  />
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
                {(item.likeCount ?? 0) > 0 && (
                  <View style={styles.likedBadge}>
                    <Ionicons name="heart" size={12} color={theme.colors.primary} />
                    <Text style={styles.likedCount}>{item.likeCount}</Text>
                  </View>
                )}
                </View>
              </GestureDetector>
            </View>
          );
        }}
      />

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
    paddingTop: 48,
    backgroundColor: theme.colors.primary,
    borderBottomWidth: 2,
    borderBottomColor: "#000",
  },
  backBtn: { padding: 8 },
  headerCenter: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  headerAvatar: { width: 36, height: 36, borderRadius: 18 },
  avatarPlaceholder: { backgroundColor: theme.colors.cream, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 17, fontWeight: "600", color: "#fff", flex: 1 },
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
  bubblePhoto: {
    backgroundColor: "#f5f5f5",
    borderColor: "#e0e0e0",
  },
  likedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 6,
  },
  likedCount: { fontSize: 11, color: theme.colors.primary },
  bubbleText: { fontSize: 16, color: theme.colors.heading },
  bubbleTextMe: { color: "#fff" },
  sharedPhoto: { width: 200, height: 200, borderRadius: 12, marginBottom: 8 },
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
    padding: 12,
    paddingBottom: 24,
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
