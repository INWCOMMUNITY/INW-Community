/**
 * ShareModal - Share content via NWC Messages, to feed, to groups, or externally.
 * Tapping "Share to Feed" opens a compose view with preview + text input.
 */
import { useCallback, useEffect, useState } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  Image,
  ActivityIndicator,
  StyleSheet,
  Linking,
  Alert,
  Share,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import {
  buildShareUrl,
  shareToFeed,
  shareToGroup,
  type ShareContent,
} from "@/lib/share-utils";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

export type SharedContentType = ShareContent["type"];

export interface ShareToChatSharedContent {
  type: SharedContentType;
  id: string;
  slug?: string;
  listingType?: "new" | "resale";
}

interface Friend {
  id: string;
  firstName: string;
  lastName: string;
  profilePhotoUrl: string | null;
}

interface CommunityGroup {
  id: string;
  name: string;
  slug?: string;
}

function resolvePhotoUrl(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
}

const TYPE_LABELS: Record<string, string> = {
  post: "Post",
  blog: "Blog Post",
  store_item: "Store Item",
  business: "Business",
  coupon: "Coupon",
  reward: "Reward",
  photo: "Photo",
};

interface ShareToChatModalProps {
  visible: boolean;
  onClose: () => void;
  sharedContent: ShareToChatSharedContent;
}

const SHARE_TITLE = "Check this out";

export function ShareToChatModal({
  visible,
  onClose,
  sharedContent,
}: ShareToChatModalProps) {
  const router = useRouter();
  const { member } = useAuth();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [groups, setGroups] = useState<CommunityGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [shareToFeedLoading, setShareToFeedLoading] = useState(false);
  const [shareToFeedText, setShareToFeedText] = useState("");
  const [composing, setComposing] = useState(false);
  const [shareToGroupPicker, setShareToGroupPicker] = useState(false);
  const [shareToGroupLoading, setShareToGroupLoading] = useState<string | null>(null);

  const content: ShareContent = {
    type: sharedContent.type,
    id: sharedContent.id,
    slug: sharedContent.slug,
    listingType: sharedContent.listingType,
  };
  const url = buildShareUrl(content);
  const canShareToGroup = sharedContent.type === "post";
  const typeLabel = TYPE_LABELS[sharedContent.type] ?? "Content";

  const load = useCallback(async () => {
    if (!visible) return;
    setLoading(true);
    try {
      const [fRes, gRes] = await Promise.all([
        apiGet<{ friends?: Friend[] }>("/api/me/friends"),
        apiGet<{ groups?: CommunityGroup[] }>("/api/me/groups?scope=member"),
      ]);
      setFriends(Array.isArray(fRes?.friends) ? fRes.friends : []);
      setGroups(Array.isArray(gRes?.groups) ? gRes.groups : []);
    } catch {
      setFriends([]);
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, [visible]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!visible) {
      setComposing(false);
      setShareToFeedText("");
      setShareToGroupPicker(false);
    }
  }, [visible]);

  const sendToFriend = async (addresseeId: string) => {
    const key = `friend-${addresseeId}`;
    setSending(key);
    try {
      const payload = {
        addresseeId,
        content: SHARE_TITLE,
        sharedContentType: sharedContent.type,
        sharedContentId: sharedContent.id,
        sharedContentSlug: sharedContent.slug ?? undefined,
      };
      const conv = await apiPost<{ id: string }>("/api/direct-conversations", payload);
      onClose();
      router.push(`/messages/${conv.id}`);
    } catch {
      setSending(null);
    }
  };

  const handleShareToFeed = async () => {
    setShareToFeedLoading(true);
    try {
      await shareToFeed(content, shareToFeedText);
      setShareToFeedText("");
      setComposing(false);
      onClose();
    } catch {
      Alert.alert("Error", "Could not share to feed. Try again.");
    } finally {
      setShareToFeedLoading(false);
    }
  };

  const handleShareToGroup = async (groupId: string) => {
    setShareToGroupLoading(groupId);
    try {
      await shareToGroup(content, groupId);
      onClose();
    } catch {
      Alert.alert("Error", "Could not share to group. Try again.");
    } finally {
      setShareToGroupLoading(null);
    }
  };

  const handleCopyLink = async () => {
    try {
      await Share.share({
        message: url,
        url,
        title: SHARE_TITLE,
      });
      onClose();
    } catch {
      // dismissed
    }
  };

  const handleShareViaText = () => {
    const body = encodeURIComponent(`${SHARE_TITLE} ${url}`);
    Linking.openURL(`sms:?body=${body}`).catch(() => {});
    onClose();
  };

  const handleShareViaEmail = () => {
    const subject = encodeURIComponent(SHARE_TITLE);
    const body = encodeURIComponent(`${SHARE_TITLE}\n\n${url}`);
    Linking.openURL(`mailto:?subject=${subject}&body=${body}`).catch(() => {});
    onClose();
  };

  if (composing) {
    return (
      <Modal visible={visible} transparent animationType="slide" onRequestClose={() => setComposing(false)}>
        <KeyboardAvoidingView
          style={styles.backdrop}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Pressable style={styles.backdrop} onPress={() => setComposing(false)}>
            <Pressable style={styles.composeSheet} onPress={(e) => e.stopPropagation()}>
              <View style={styles.composeHeader}>
                <Pressable onPress={() => setComposing(false)} style={({ pressed }) => [pressed && { opacity: 0.7 }]}>
                  <Ionicons name="arrow-back" size={24} color={theme.colors.primary} />
                </Pressable>
                <Text style={styles.composeTitle}>Share to Feed</Text>
                <View style={{ width: 24 }} />
              </View>

              <ScrollView
                style={styles.composeScroll}
                contentContainerStyle={styles.composeScrollContent}
                keyboardShouldPersistTaps="handled"
              >
                <View style={styles.previewCard}>
                  <View style={styles.previewIconWrap}>
                    <Ionicons
                      name={
                        sharedContent.type === "coupon" ? "pricetag" :
                        sharedContent.type === "business" ? "business" :
                        sharedContent.type === "blog" ? "newspaper" :
                        sharedContent.type === "store_item" ? "bag-handle" :
                        sharedContent.type === "reward" ? "star" :
                        "share-social"
                      }
                      size={28}
                      color={theme.colors.primary}
                    />
                  </View>
                  <View style={styles.previewTextWrap}>
                    <Text style={styles.previewType}>Sharing a {typeLabel}</Text>
                    <Text style={styles.previewUrl} numberOfLines={1}>{url}</Text>
                  </View>
                </View>

                <TextInput
                  style={styles.composeInput}
                  placeholder="Add a comment to your post..."
                  placeholderTextColor="#999"
                  value={shareToFeedText}
                  onChangeText={setShareToFeedText}
                  multiline
                  autoFocus
                  autoCorrect={true}
                />
              </ScrollView>

              <Pressable
                style={({ pressed }) => [
                  styles.composeShareBtn,
                  shareToFeedLoading && { opacity: 0.6 },
                  pressed && { opacity: 0.8 },
                ]}
                onPress={handleShareToFeed}
                disabled={shareToFeedLoading}
              >
                {shareToFeedLoading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.composeShareBtnText}>Share</Text>
                )}
              </Pressable>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <Text style={styles.title}>Share</Text>

          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator size="large" color={theme.colors.primary} />
            </View>
          ) : (
            <>
              <View style={styles.friendRowSection}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.friendRow}
                >
                  {friends.slice(0, 12).map((f) => {
                    const key = `friend-${f.id}`;
                    const isSending = sending === key;
                    const photoUrl = resolvePhotoUrl(f.profilePhotoUrl ?? undefined);
                    return (
                      <Pressable
                        key={f.id}
                        style={({ pressed }) => [
                          styles.friendAvatarWrap,
                          pressed && styles.friendAvatarPressed,
                        ]}
                        onPress={() => sendToFriend(f.id)}
                        disabled={isSending}
                      >
                        {photoUrl ? (
                          <Image source={{ uri: photoUrl }} style={styles.friendAvatar} />
                        ) : (
                          <View style={[styles.friendAvatar, styles.friendAvatarPlaceholder]}>
                            <Ionicons name="person" size={24} color={theme.colors.placeholder} />
                          </View>
                        )}
                        {isSending ? (
                          <View style={styles.friendAvatarOverlay}>
                            <ActivityIndicator size="small" color="#fff" />
                          </View>
                        ) : null}
                        <Text style={styles.friendName} numberOfLines={1}>
                          {`${f.firstName} ${f.lastName}`.trim() || "Friend"}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
                {friends.length === 0 && (
                  <Text style={styles.emptyHint}>Add friends to share via NWC Messages</Text>
                )}
              </View>

              <View style={styles.greenSection}>
                <Pressable
                  style={({ pressed }) => [styles.greenBtn, pressed && styles.greenBtnPressed]}
                  onPress={() => setComposing(true)}
                >
                  <Text style={styles.greenBtnText}>Share to Feed</Text>
                </Pressable>
                {canShareToGroup ? (
                  shareToGroupPicker ? (
                    <View style={styles.groupPicker}>
                      <Pressable
                        style={({ pressed }) => [styles.backToGroups, pressed && { opacity: 0.8 }]}
                        onPress={() => setShareToGroupPicker(false)}
                      >
                        <Ionicons name="arrow-back" size={20} color="#fff" />
                        <Text style={styles.backToGroupsText}>Back</Text>
                      </Pressable>
                      <ScrollView style={styles.groupList} nestedScrollEnabled>
                        {groups.map((g) => {
                          const key = `group-${g.id}`;
                          const isLoading = shareToGroupLoading === key;
                          return (
                            <Pressable
                              key={g.id}
                              style={({ pressed }) => [
                                styles.groupItem,
                                pressed && styles.groupItemPressed,
                                isLoading && styles.groupItemDisabled,
                              ]}
                              onPress={() => handleShareToGroup(g.id)}
                              disabled={isLoading}
                            >
                              {isLoading ? (
                                <ActivityIndicator size="small" color="#fff" />
                              ) : (
                                <Text style={styles.groupItemText}>{g.name}</Text>
                              )}
                            </Pressable>
                          );
                        })}
                        {groups.length === 0 && (
                          <Text style={styles.emptyHint}>You're not in any groups yet</Text>
                        )}
                      </ScrollView>
                    </View>
                  ) : (
                    <Pressable
                      style={({ pressed }) => [styles.greenBtn, pressed && styles.greenBtnPressed]}
                      onPress={() => setShareToGroupPicker(true)}
                    >
                      <Text style={styles.greenBtnText}>Share to Group</Text>
                    </Pressable>
                  )
                ) : null}
              </View>

              <View style={styles.tanSection}>
                <Pressable
                  style={({ pressed }) => [styles.tanBtn, pressed && styles.tanBtnPressed]}
                  onPress={handleShareViaText}
                >
                  <Ionicons name="chatbubble-outline" size={22} color={theme.colors.primary} />
                  <Text style={styles.tanBtnText}>Share via Text</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.tanBtn, pressed && styles.tanBtnPressed]}
                  onPress={handleShareViaEmail}
                >
                  <Ionicons name="mail-outline" size={22} color={theme.colors.primary} />
                  <Text style={styles.tanBtnText}>Share in Email</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.tanBtn, pressed && styles.tanBtnPressed]}
                  onPress={handleCopyLink}
                >
                  <Ionicons name="link-outline" size={22} color={theme.colors.primary} />
                  <Text style={styles.tanBtnText}>Copy Link</Text>
                </Pressable>
              </View>
            </>
          )}

          <Pressable
            style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.8 }]}
            onPress={onClose}
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: "85%",
    paddingBottom: 24,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: "#ccc",
    borderRadius: 2,
    alignSelf: "center",
    marginTop: 12,
    marginBottom: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: theme.colors.heading,
    textAlign: "center",
    marginBottom: 16,
  },
  loading: {
    padding: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  friendRowSection: {
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  friendRow: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 16,
  },
  friendAvatarWrap: {
    alignItems: "center",
    width: 64,
  },
  friendAvatarPressed: {
    opacity: 0.8,
  },
  friendAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
  },
  friendAvatarPlaceholder: {
    backgroundColor: theme.colors.cream,
    alignItems: "center",
    justifyContent: "center",
  },
  friendAvatarOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 26,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  friendName: {
    fontSize: 12,
    color: theme.colors.text,
    marginTop: 4,
    maxWidth: 64,
    textAlign: "center",
  },
  emptyHint: {
    fontSize: 14,
    color: theme.colors.placeholder,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  greenSection: {
    backgroundColor: theme.colors.secondary,
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 0,
    gap: 12,
  },
  greenBtn: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  greenBtnPressed: {
    opacity: 0.9,
  },
  greenBtnDisabled: {
    opacity: 0.7,
  },
  greenBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  groupPicker: {
    marginTop: 0,
  },
  backToGroups: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
  },
  backToGroupsText: {
    fontSize: 16,
    color: "#fff",
    fontWeight: "500",
  },
  groupList: {
    maxHeight: 160,
  },
  groupItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 8,
    marginBottom: 8,
  },
  groupItemPressed: {
    opacity: 0.9,
  },
  groupItemDisabled: {
    opacity: 0.7,
  },
  groupItemText: {
    fontSize: 16,
    color: "#fff",
  },
  tanSection: {
    backgroundColor: theme.colors.cream,
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginHorizontal: 0,
    gap: 8,
  },
  tanBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  tanBtnPressed: {
    backgroundColor: "rgba(0,0,0,0.05)",
  },
  tanBtnText: {
    fontSize: 16,
    color: theme.colors.text,
    fontWeight: "500",
  },
  cancelBtn: {
    marginHorizontal: 16,
    marginTop: 16,
    paddingVertical: 14,
    alignItems: "center",
    borderRadius: 8,
    backgroundColor: theme.colors.creamAlt,
  },
  cancelText: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.text,
  },
  composeSheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: "90%",
    paddingBottom: 24,
  },
  composeHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  composeTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: theme.colors.heading,
  },
  composeScroll: {
    maxHeight: 400,
  },
  composeScrollContent: {
    padding: 16,
  },
  previewCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#f5f5f5",
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    marginBottom: 16,
  },
  previewIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: `${theme.colors.primary}15`,
    alignItems: "center",
    justifyContent: "center",
  },
  previewTextWrap: {
    flex: 1,
  },
  previewType: {
    fontSize: 15,
    fontWeight: "600",
    color: theme.colors.heading,
    marginBottom: 2,
  },
  previewUrl: {
    fontSize: 12,
    color: "#888",
  },
  composeInput: {
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: theme.colors.text,
    minHeight: 100,
    textAlignVertical: "top",
  },
  composeShareBtn: {
    backgroundColor: theme.colors.primary,
    marginHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
  },
  composeShareBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
});
