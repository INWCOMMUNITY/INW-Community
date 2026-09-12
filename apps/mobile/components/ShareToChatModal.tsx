/**
 * Share sheet — NWC Messages, feed, groups, or external (text / email / copy / OS share).
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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
  Keyboard,
  Platform,
} from "react-native";
import { useSafeAreaInsets, initialWindowMetrics } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { theme } from "@/lib/theme";
import { apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import {
  buildShareUrl,
  shareToFeed,
  shareToGroup,
  recordPostShareEvent,
  type ShareContent,
  type PostShareChannel,
} from "@/lib/share-utils";
import { fetchStoreItemPreviewPayload } from "@/lib/fetch-store-item-preview";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

export type SharedContentType = ShareContent["type"];

export interface ShareToChatSharedContent {
  type: SharedContentType;
  id: string;
  slug?: string;
  /** Shown in share preview (e.g. store listing title instead of generic “Store Item”). */
  title?: string;
  /** First listing image for store_item preview (relative site path or absolute URL). */
  previewPhotoUrl?: string;
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
  storefront: "Storefront",
  coupon: "Coupon",
  reward: "Reward",
  event: "Event",
  photo: "Photo",
};

function typeIcon(type: string): keyof typeof Ionicons.glyphMap {
  switch (type) {
    case "coupon":
      return "pricetag";
    case "business":
      return "business";
    case "storefront":
      return "storefront";
    case "blog":
      return "newspaper";
    case "store_item":
      return "bag";
    case "reward":
      return "star";
    case "event":
      return "calendar";
    case "photo":
      return "image";
    default:
      return "share-social";
  }
}

interface ShareToChatModalProps {
  visible: boolean;
  onClose: () => void;
  sharedContent: ShareToChatSharedContent;
  /** When set, “Share to feed” creates the reshare in this community group (Post.groupId). */
  defaultFeedGroupId?: string | null;
  /** Called after a successful “Share to feed” (e.g. refresh group feed). */
  onShareToFeedComplete?: () => void;
  /** Called when a post share is recorded (feed, group, DM, or external). */
  onSourcePostShared?: (
    sourcePostId: string,
    opts?: { recorded?: boolean; shareCount?: number }
  ) => void;
}

const SHARE_TITLE = "Check this out";
const SHARE_DM_STORE_ITEM = "Check this item out!";
const FRIENDS_PREVIEW_LIMIT = 12;

const FULL_SCREEN_MODAL = {
  transparent: true as const,
  animationType: "slide" as const,
  presentationStyle: "overFullScreen" as const,
  statusBarTranslucent: true,
  ...(Platform.OS === "android" ? { navigationBarTranslucent: true } : {}),
};

/** iOS does not resize the window for the keyboard; pad the sheet instead of lifting it. */
function useIosKeyboardHeight() {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    const show = Keyboard.addListener("keyboardWillShow", (e) => {
      setHeight(e.endCoordinates.height);
    });
    const hide = Keyboard.addListener("keyboardWillHide", () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}

function ActionRow({
  icon,
  label,
  onPress,
  disabled,
  trailing,
  iconColor,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  trailing?: ReactNode;
  iconColor?: string;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.actionRow, pressed && styles.actionRowPressed, disabled && { opacity: 0.55 }]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={styles.actionIconWell}>
        <Ionicons name={icon} size={20} color={iconColor ?? theme.colors.earth} />
      </View>
      <Text style={styles.actionLabel} numberOfLines={1}>
        {label}
      </Text>
      {trailing}
    </Pressable>
  );
}

export function ShareToChatModal({
  visible,
  onClose,
  sharedContent,
  defaultFeedGroupId = null,
  onShareToFeedComplete,
  onSourcePostShared,
}: ShareToChatModalProps) {
  const insets = useSafeAreaInsets();
  const keyboardHeight = useIosKeyboardHeight();
  const bottomSafe = Math.max(insets.bottom, initialWindowMetrics?.insets.bottom ?? 0, 8);
  const sheetPad = {
    paddingBottom: keyboardHeight > 0 ? keyboardHeight : bottomSafe,
  };
  const { member } = useAuth();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [groups, setGroups] = useState<CommunityGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [sentIds, setSentIds] = useState<Set<string>>(() => new Set());
  const [shareToFeedLoading, setShareToFeedLoading] = useState(false);
  const [shareToFeedText, setShareToFeedText] = useState("");
  const [composing, setComposing] = useState(false);
  const [shareToGroupPicker, setShareToGroupPicker] = useState(false);
  const [shareToGroupLoading, setShareToGroupLoading] = useState<string | null>(null);
  const [storePreview, setStorePreview] = useState<{ title: string; photo?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [friendQuery, setFriendQuery] = useState("");
  const [seeAllFriends, setSeeAllFriends] = useState(false);
  const [statusToast, setStatusToast] = useState<string | null>(null);

  const content: ShareContent = {
    type: sharedContent.type,
    id: sharedContent.id,
    slug: sharedContent.slug,
  };
  const url = buildShareUrl(content);
  const canShareToGroup = sharedContent.type === "post";

  useEffect(() => {
    if (!visible || sharedContent.type !== "store_item") {
      setStorePreview(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const row = await fetchStoreItemPreviewPayload({
        id: sharedContent.id,
        slug: sharedContent.slug,
      });
      if (cancelled) return;
      if (row?.title) {
        const photo = row.photos?.find((p) => p && String(p).trim() !== "");
        setStorePreview({ title: row.title, photo });
      } else {
        setStorePreview(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, sharedContent.type, sharedContent.id, sharedContent.slug]);

  const typeNoun = TYPE_LABELS[sharedContent.type] ?? "Content";

  const previewTitle = useMemo(() => {
    if (sharedContent.type === "store_item") {
      const t = (storePreview?.title ?? sharedContent.title)?.trim();
      if (t) return t;
    }
    const t = sharedContent.title?.trim();
    if (t) return t;
    return typeNoun;
  }, [sharedContent.type, sharedContent.title, storePreview?.title, typeNoun]);

  const previewImageUri = useMemo(() => {
    const raw =
      sharedContent.type === "store_item"
        ? storePreview?.photo ?? sharedContent.previewPhotoUrl
        : sharedContent.previewPhotoUrl;
    return raw ? resolvePhotoUrl(raw) : undefined;
  }, [sharedContent.type, sharedContent.previewPhotoUrl, storePreview?.photo]);

  const load = useCallback(async () => {
    if (!visible) return;
    if (!member) {
      setFriends([]);
      setGroups([]);
      setLoading(false);
      return;
    }
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
  }, [visible, member]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!visible) {
      setComposing(false);
      setShareToFeedText("");
      setShareToGroupPicker(false);
      setStorePreview(null);
      setCopied(false);
      setSentIds(new Set());
      setFriendQuery("");
      setSeeAllFriends(false);
      setStatusToast(null);
      setSending(null);
    }
  }, [visible]);

  useEffect(() => {
    if (!statusToast) return;
    const id = setTimeout(() => setStatusToast(null), 1800);
    return () => clearTimeout(id);
  }, [statusToast]);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(id);
  }, [copied]);

  const notifyPostShared = useCallback(
    (recorded?: boolean, shareCount?: number) => {
      if (sharedContent.type !== "post") return;
      onSourcePostShared?.(sharedContent.id, { recorded, shareCount });
    },
    [sharedContent.type, sharedContent.id, onSourcePostShared]
  );

  const trackExternalPostShare = useCallback(
    async (channel: PostShareChannel) => {
      if (sharedContent.type !== "post") return;
      try {
        const res = await recordPostShareEvent(sharedContent.id, channel);
        notifyPostShared(res.recorded, res.shareCount);
      } catch (e) {
        console.warn("[ShareToChatModal] recordPostShareEvent failed:", e);
      }
    },
    [sharedContent.type, sharedContent.id, notifyPostShared]
  );

  const filteredFriends = useMemo(() => {
    const q = friendQuery.trim().toLowerCase();
    if (!q) return friends;
    return friends.filter((f) => `${f.firstName} ${f.lastName}`.toLowerCase().includes(q));
  }, [friends, friendQuery]);

  const visibleFriends = useMemo(() => {
    if (friendQuery.trim() || seeAllFriends) return filteredFriends;
    return filteredFriends.slice(0, FRIENDS_PREVIEW_LIMIT);
  }, [filteredFriends, friendQuery, seeAllFriends]);

  const sendToFriend = async (friend: Friend) => {
    const key = `friend-${friend.id}`;
    if (sending || sentIds.has(friend.id)) return;
    setSending(key);
    try {
      const dmShareText =
        sharedContent.type === "store_item" ? SHARE_DM_STORE_ITEM : SHARE_TITLE;
      const payload = {
        addresseeId: friend.id,
        content: dmShareText,
        sharedContentType: sharedContent.type,
        sharedContentId: sharedContent.id,
        sharedContentSlug: sharedContent.slug ?? undefined,
      };
      const conv = await apiPost<{ id: string; shareRecorded?: boolean; shareCount?: number }>(
        "/api/direct-conversations",
        payload
      );
      if (sharedContent.type === "post") {
        notifyPostShared(conv.shareRecorded, conv.shareCount);
      }
      setSentIds((prev) => new Set(prev).add(friend.id));
      const name = friend.firstName.trim() || "friend";
      setStatusToast(`Sent to ${name}`);
    } catch (e) {
      const err = e as { error?: string };
      Alert.alert("Couldn't send", err?.error ?? "Try again in a moment.");
    } finally {
      setSending(null);
    }
  };

  const handleShareToFeed = async () => {
    setShareToFeedLoading(true);
    try {
      const res = await shareToFeed(content, shareToFeedText, {
        groupId: defaultFeedGroupId ?? undefined,
      });
      setShareToFeedText("");
      setComposing(false);
      if (sharedContent.type === "post") {
        notifyPostShared(res.shareRecorded, res.shareCount);
      }
      onShareToFeedComplete?.();
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
      const res = await shareToGroup(content, groupId);
      if (sharedContent.type === "post") {
        notifyPostShared(res.shareRecorded, res.shareCount);
      }
      onClose();
    } catch {
      Alert.alert("Error", "Could not share to group. Try again.");
    } finally {
      setShareToGroupLoading(null);
    }
  };

  const handleCopyLink = async () => {
    try {
      await Clipboard.setStringAsync(url);
      setCopied(true);
      setStatusToast("Link copied");
      await trackExternalPostShare("link_copy");
    } catch {
      Alert.alert("Couldn't copy", "Try again in a moment.");
    }
  };

  const handleShareViaText = async () => {
    const body = encodeURIComponent(`${SHARE_TITLE} ${url}`);
    Linking.openURL(`sms:?body=${body}`).catch(() => {});
    await trackExternalPostShare("sms");
  };

  const handleShareViaEmail = async () => {
    const subject = encodeURIComponent(SHARE_TITLE);
    const body = encodeURIComponent(`${SHARE_TITLE}\n\n${url}`);
    Linking.openURL(`mailto:?subject=${subject}&body=${body}`).catch(() => {});
    await trackExternalPostShare("email");
  };

  const handleMoreShare = async () => {
    try {
      await Share.share({
        message: Platform.OS === "ios" ? SHARE_TITLE : `${SHARE_TITLE} ${url}`,
        url,
        title: SHARE_TITLE,
      });
      await trackExternalPostShare("external");
    } catch {
      // dismissed
    }
  };

  const previewCard = (
    <View style={styles.previewCard}>
      {previewImageUri ? (
        <Image source={{ uri: previewImageUri }} style={styles.previewThumb} resizeMode="cover" />
      ) : (
        <View style={styles.previewIconWrap}>
          <Ionicons name={typeIcon(sharedContent.type)} size={24} color={theme.colors.earth} />
        </View>
      )}
      <View style={styles.previewTextWrap}>
        <Text style={styles.previewKicker}>{typeNoun}</Text>
        <Text style={styles.previewTitle} numberOfLines={2}>
          {previewTitle}
        </Text>
      </View>
    </View>
  );

  if (composing) {
    return (
      <Modal visible={visible} {...FULL_SCREEN_MODAL} onRequestClose={() => setComposing(false)}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setComposing(false)} />
          <View style={[styles.sheet, sheetPad]}>
            <View style={styles.handle} />
            <View style={styles.composeHeader}>
              <Pressable
                onPress={() => setComposing(false)}
                hitSlop={10}
                style={({ pressed }) => [pressed && { opacity: 0.7 }]}
                accessibilityLabel="Back"
              >
                <Ionicons name="arrow-back" size={24} color={theme.colors.earth} />
              </Pressable>
              <Text style={styles.title}>Share to Feed</Text>
              <View style={{ width: 24 }} />
            </View>
            <ScrollView
              style={styles.composeScroll}
              contentContainerStyle={styles.composeScrollContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
            >
              {previewCard}
              <TextInput
                style={styles.composeInput}
                placeholder="Add a comment to your post..."
                placeholderTextColor={theme.colors.placeholder}
                value={shareToFeedText}
                onChangeText={setShareToFeedText}
                multiline
                autoCorrect
              />
            </ScrollView>
            <Pressable
              style={({ pressed }) => [
                styles.composeShareBtn,
                shareToFeedLoading && { opacity: 0.6 },
                pressed && { opacity: 0.85 },
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
          </View>
        </View>
      </Modal>
    );
  }

  const listFriendsVertically = Boolean(friendQuery.trim()) || seeAllFriends;

  return (
    <Modal visible={visible} {...FULL_SCREEN_MODAL} onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Dismiss share" />
        <View style={[styles.sheet, sheetPad]}>
            <View style={styles.handle} />
            <Text style={styles.title}>Share</Text>

            {statusToast ? (
              <View style={styles.statusToast} accessibilityLiveRegion="polite">
                <Ionicons name="checkmark-circle" size={18} color={theme.colors.gold} />
                <Text style={styles.statusToastText}>{statusToast}</Text>
              </View>
            ) : null}

            {loading ? (
              <View style={styles.loading}>
                <ActivityIndicator size="large" color={theme.colors.earth} />
              </View>
            ) : (
              <ScrollView
                style={styles.bodyScroll}
                contentContainerStyle={styles.bodyScrollContent}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                showsVerticalScrollIndicator={false}
              >
                {previewCard}

                <Text style={styles.sectionLabel}>Friends</Text>
                {friends.length > 6 ? (
                  <TextInput
                    style={styles.friendSearch}
                    placeholder="Search friends"
                    placeholderTextColor={theme.colors.placeholder}
                    value={friendQuery}
                    onChangeText={setFriendQuery}
                    autoCorrect={false}
                    autoCapitalize="none"
                    clearButtonMode="while-editing"
                  />
                ) : null}

                {friends.length === 0 ? (
                  <Text style={styles.emptyHint}>
                    {member ? "Add friends to share in Messages" : "Sign in to share with friends"}
                  </Text>
                ) : listFriendsVertically ? (
                  <View style={styles.friendList}>
                    {visibleFriends.map((f) => {
                      const key = `friend-${f.id}`;
                      const isSending = sending === key;
                      const sent = sentIds.has(f.id);
                      const photoUrl = resolvePhotoUrl(f.profilePhotoUrl ?? undefined);
                      const name = `${f.firstName} ${f.lastName}`.trim() || "Friend";
                      return (
                        <Pressable
                          key={f.id}
                          style={({ pressed }) => [styles.friendListRow, pressed && styles.actionRowPressed]}
                          onPress={() => sendToFriend(f)}
                          disabled={isSending || sent}
                        >
                          {photoUrl ? (
                            <Image source={{ uri: photoUrl }} style={styles.friendListAvatar} />
                          ) : (
                            <View style={[styles.friendListAvatar, styles.friendAvatarPlaceholder]}>
                              <Ionicons name="person" size={18} color={theme.colors.earth} />
                            </View>
                          )}
                          <Text style={styles.friendListName} numberOfLines={1}>
                            {name}
                          </Text>
                          {isSending ? (
                            <ActivityIndicator size="small" color={theme.colors.earth} />
                          ) : sent ? (
                            <Ionicons name="checkmark-circle" size={22} color={theme.colors.gold} />
                          ) : (
                            <Text style={styles.friendSendLabel}>Send</Text>
                          )}
                        </Pressable>
                      );
                    })}
                    {visibleFriends.length === 0 ? (
                      <Text style={styles.emptyHint}>No friends match that name</Text>
                    ) : null}
                  </View>
                ) : (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.friendRow}
                  >
                    {visibleFriends.map((f) => {
                      const key = `friend-${f.id}`;
                      const isSending = sending === key;
                      const sent = sentIds.has(f.id);
                      const photoUrl = resolvePhotoUrl(f.profilePhotoUrl ?? undefined);
                      return (
                        <Pressable
                          key={f.id}
                          style={({ pressed }) => [styles.friendAvatarWrap, pressed && { opacity: 0.85 }]}
                          onPress={() => sendToFriend(f)}
                          disabled={isSending || sent}
                          accessibilityLabel={`Send to ${f.firstName}`}
                        >
                          <View style={[styles.friendAvatarRing, sent && styles.friendAvatarRingSent]}>
                            {photoUrl ? (
                              <Image source={{ uri: photoUrl }} style={styles.friendAvatar} />
                            ) : (
                              <View style={[styles.friendAvatar, styles.friendAvatarPlaceholder]}>
                                <Ionicons name="person" size={22} color={theme.colors.earth} />
                              </View>
                            )}
                            {isSending ? (
                              <View style={styles.friendAvatarOverlay}>
                                <ActivityIndicator size="small" color="#fff" />
                              </View>
                            ) : sent ? (
                              <View style={styles.friendSentBadge}>
                                <Ionicons name="checkmark" size={12} color="#fff" />
                              </View>
                            ) : null}
                          </View>
                          <Text style={styles.friendName} numberOfLines={1}>
                            {f.firstName.trim() || "Friend"}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                )}

                {!friendQuery.trim() && friends.length > FRIENDS_PREVIEW_LIMIT ? (
                  <Pressable
                    onPress={() => setSeeAllFriends((v) => !v)}
                    style={({ pressed }) => [styles.seeAllBtn, pressed && { opacity: 0.75 }]}
                  >
                    <Text style={styles.seeAllText}>{seeAllFriends ? "Show less" : "See all friends"}</Text>
                  </Pressable>
                ) : null}

                <Text style={styles.sectionLabel}>On Northwest Community</Text>
                <View style={styles.actionGroup}>
                  <ActionRow
                    icon="newspaper-outline"
                    label="Share to Feed"
                    onPress={() => setComposing(true)}
                  />
                  {canShareToGroup ? (
                    <>
                      <ActionRow
                        icon="people-outline"
                        label="Share to Group"
                        onPress={() => setShareToGroupPicker((v) => !v)}
                        trailing={
                          <Ionicons
                            name={shareToGroupPicker ? "chevron-up" : "chevron-down"}
                            size={18}
                            color={theme.colors.earth}
                          />
                        }
                      />
                      {shareToGroupPicker ? (
                        <View style={styles.groupPicker}>
                          {groups.map((g) => {
                            const isLoading = shareToGroupLoading === g.id;
                            return (
                              <Pressable
                                key={g.id}
                                style={({ pressed }) => [
                                  styles.groupItem,
                                  pressed && styles.actionRowPressed,
                                  isLoading && { opacity: 0.7 },
                                ]}
                                onPress={() => handleShareToGroup(g.id)}
                                disabled={isLoading}
                              >
                                {isLoading ? (
                                  <ActivityIndicator size="small" color={theme.colors.earth} />
                                ) : (
                                  <Text style={styles.groupItemText}>{g.name}</Text>
                                )}
                              </Pressable>
                            );
                          })}
                          {groups.length === 0 ? (
                            <Text style={styles.emptyHint}>You’re not in any groups yet</Text>
                          ) : null}
                        </View>
                      ) : null}
                    </>
                  ) : null}
                </View>

                <View style={styles.divider} />

                <Text style={styles.sectionLabel}>Elsewhere</Text>
                <View style={styles.actionGroup}>
                  <ActionRow icon="chatbubble-outline" label="Share via Text" onPress={handleShareViaText} />
                  <ActionRow icon="mail-outline" label="Share in Email" onPress={handleShareViaEmail} />
                  <ActionRow
                    icon={copied ? "checkmark-circle" : "link-outline"}
                    label={copied ? "Copied" : "Copy Link"}
                    onPress={handleCopyLink}
                    iconColor={copied ? theme.colors.gold : undefined}
                  />
                  <ActionRow icon="ellipsis-horizontal" label="More…" onPress={handleMoreShare} />
                </View>
              </ScrollView>
            )}

            <Pressable
              style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.7 }]}
              onPress={onClose}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(93,79,64,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    width: "100%",
    backgroundColor: theme.colors.pageBackground,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "92%",
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: theme.colors.gold,
    borderRadius: 2,
    alignSelf: "center",
    marginTop: 10,
    marginBottom: 6,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: theme.colors.earth,
    textAlign: "center",
    marginBottom: 8,
  },
  composeHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    marginBottom: 4,
  },
  statusToast: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: theme.colors.cream,
    borderRadius: 10,
  },
  statusToastText: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.earth,
  },
  loading: {
    padding: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  bodyScroll: {
    maxHeight: 520,
  },
  bodyScrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  previewCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: 16,
  },
  previewIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 10,
    backgroundColor: theme.colors.cream,
    alignItems: "center",
    justifyContent: "center",
  },
  previewThumb: {
    width: 56,
    height: 56,
    borderRadius: 10,
    backgroundColor: theme.colors.cream,
  },
  previewTextWrap: {
    flex: 1,
  },
  previewKicker: {
    fontSize: 12,
    fontWeight: "600",
    color: theme.colors.gold,
    marginBottom: 2,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  previewTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: theme.colors.heading,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: theme.colors.earth,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 8,
    marginTop: 4,
  },
  friendSearch: {
    backgroundColor: "#fff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "ios" ? 10 : 8,
    fontSize: 15,
    color: theme.colors.text,
    marginBottom: 10,
  },
  friendRow: {
    flexDirection: "row",
    gap: 14,
    paddingBottom: 4,
  },
  friendAvatarWrap: {
    alignItems: "center",
    width: 68,
  },
  friendAvatarRing: {
    borderWidth: 2,
    borderColor: theme.colors.earth,
    borderRadius: 28,
    padding: 2,
  },
  friendAvatarRingSent: {
    borderColor: theme.colors.gold,
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
    ...StyleSheet.absoluteFillObject,
    borderRadius: 26,
    backgroundColor: "rgba(93,79,64,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  friendSentBadge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: theme.colors.gold,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: theme.colors.pageBackground,
  },
  friendName: {
    fontSize: 12,
    color: theme.colors.earth,
    marginTop: 6,
    maxWidth: 68,
    textAlign: "center",
    fontWeight: "500",
  },
  friendList: {
    backgroundColor: "#fff",
    borderRadius: 12,
    overflow: "hidden",
    marginBottom: 4,
  },
  friendListRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.borderMuted,
  },
  friendListAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  friendListName: {
    flex: 1,
    fontSize: 15,
    fontWeight: "500",
    color: theme.colors.heading,
  },
  friendSendLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.earth,
  },
  seeAllBtn: {
    alignSelf: "flex-start",
    paddingVertical: 8,
    marginBottom: 4,
  },
  seeAllText: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.earth,
  },
  emptyHint: {
    fontSize: 14,
    color: theme.colors.placeholder,
    paddingVertical: 8,
    marginBottom: 8,
  },
  actionGroup: {
    backgroundColor: "#fff",
    borderRadius: 12,
    overflow: "hidden",
    marginBottom: 12,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    minHeight: 52,
  },
  actionRowPressed: {
    backgroundColor: theme.colors.creamAlt,
  },
  actionIconWell: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: theme.colors.cream,
    alignItems: "center",
    justifyContent: "center",
  },
  actionLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.heading,
  },
  groupPicker: {
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  groupItem: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: theme.colors.creamAlt,
    marginBottom: 6,
  },
  groupItemText: {
    fontSize: 15,
    color: theme.colors.heading,
    fontWeight: "500",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border,
    marginBottom: 12,
  },
  cancelBtn: {
    marginHorizontal: 16,
    marginTop: 4,
    paddingVertical: 12,
    alignItems: "center",
  },
  cancelText: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.earth,
  },
  composeScroll: {
    maxHeight: 400,
  },
  composeScrollContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  composeInput: {
    borderWidth: 1.5,
    borderColor: theme.colors.earth,
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: theme.colors.text,
    minHeight: 100,
    textAlignVertical: "top",
  },
  composeShareBtn: {
    backgroundColor: theme.colors.earth,
    marginHorizontal: 16,
    marginTop: 12,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  composeShareBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
});
