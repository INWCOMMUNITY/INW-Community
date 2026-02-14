import { useCallback, useEffect, useState, useRef } from "react";
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
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPost, apiUploadFile } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

interface GroupConversation {
  id: string;
  name: string | null;
  createdBy: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null };
  members: { member: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null } }[];
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

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

function resolvePhotoUrl(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
}

export default function GroupConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { member } = useAuth();
  const [conv, setConv] = useState<GroupConversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const data = await apiGet<GroupConversation>(`/api/group-conversations/${id}`);
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

  const groupName = conv?.name ?? conv?.members?.map((m) => m.member.firstName).filter(Boolean).join(", ") ?? "Group";

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
      const msg = await apiPost<{
        id: string;
        content: string;
        createdAt: string;
        senderId: string;
        sharedContentType?: string;
        sharedContentId?: string;
        sender: { id: string; firstName: string; lastName: string };
      }>(`/api/group-conversations/${id}`, {
        sharedContentType: "photo",
        sharedContentId: fullUrl,
        content: "",
      });
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
                  sharedContentType: "photo",
                  sharedContentId: fullUrl,
                  sender: msg.sender,
                },
              ],
            }
          : null
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
      const msg = await apiPost<{
        id: string;
        content: string;
        createdAt: string;
        senderId: string;
        sender: { id: string; firstName: string; lastName: string };
      }>(`/api/group-conversations/${id}`, { content: text });
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
                  sender: msg.sender,
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
      </View>

      <FlatList
        ref={flatListRef}
        data={conv.messages ?? []}
        keyExtractor={(item, index) => item.id ?? `msg-${index}`}
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
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  messageList: { padding: 16, paddingBottom: 8 },
  bubbleWrap: { marginBottom: 12, alignItems: "flex-start" },
  bubbleWrapMe: { alignItems: "flex-end" },
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
