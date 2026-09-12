import { useEffect, useState, useCallback, useMemo } from "react";
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
  Modal,
  Share,
  RefreshControl,
} from "react-native";
import { TouchableOpacity } from "react-native-gesture-handler";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Dimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { theme } from "@/lib/theme";
import { apiGet, apiPost, apiPatch } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { ImageGalleryViewer } from "@/components/ImageGalleryViewer";
import { AppImage } from "@/components/AppImage";
import { buildBusinessPath } from "@/lib/business-referrer";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const SITE_BASE = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");
const GRID_GAP = 6;
const COLS = 3;
const { width: SCREEN_WIDTH } = Dimensions.get("window");
const PAGE_PAD = 16;
const CARD_PAD = 12;
const CELL_SIZE = Math.floor(
  (SCREEN_WIDTH - PAGE_PAD * 2 - CARD_PAD * 2 - GRID_GAP * (COLS - 1)) / COLS
);
const COVER_HEIGHT = 168;
const AVATAR_SIZE = 92;

interface FavoriteBusiness {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
}

interface MemberBlog {
  id: string;
  slug: string;
  title: string;
  createdAt: string;
}

interface MemberProfile {
  id: string;
  firstName: string;
  lastName: string;
  profilePhotoUrl: string | null;
  coverPhotoUrl?: string | null;
  bio: string | null;
  city: string | null;
  memberSince?: string;
  postCount?: number;
  friendCount?: number;
  favoriteBusinesses?: FavoriteBusiness[];
  blogs?: MemberBlog[];
  allTimePointsEarned?: number;
  /** When false, profile is private and viewer is not a friend; photos/posts are hidden. */
  canSeeFullProfile?: boolean;
}

interface MemberPost {
  id: string;
  content: string | null;
  photos: string[];
  createdAt: string;
  author: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null };
  sourceBlog?: { photos?: string[] } | null;
  sourceStoreItem?: { photos?: string[] } | null;
  sourceEvent?: { photos?: string[] } | null;
  sourceListingCollection?: { previewPhotos?: string[] } | null;
  sourcePost?: {
    photos?: string[];
    sourceBlog?: { photos?: string[] } | null;
    sourceStoreItem?: { photos?: string[] } | null;
    sourceEvent?: { photos?: string[] } | null;
    sourceListingCollection?: { previewPhotos?: string[] } | null;
  } | null;
}

function firstGalleryPhoto(post: MemberPost): string | undefined {
  const lists = [
    post.photos,
    post.sourcePost?.photos,
    post.sourceBlog?.photos,
    post.sourceStoreItem?.photos,
    post.sourceEvent?.photos,
    post.sourceListingCollection?.previewPhotos,
    post.sourcePost?.sourceBlog?.photos,
    post.sourcePost?.sourceStoreItem?.photos,
    post.sourcePost?.sourceEvent?.photos,
    post.sourcePost?.sourceListingCollection?.previewPhotos,
  ];
  for (const arr of lists) {
    const raw = (arr ?? []).find((x) => typeof x === "string" && x.trim().length > 0);
    if (!raw) continue;
    return resolveUrl(raw) ?? raw;
  }
  return undefined;
}

function resolveUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${SITE_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
}

function formatMemberSince(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function formatBlogDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Cold opens (e.g. from a push) may leave no stack under this screen — router.back() does nothing. */
function useLeaveMemberProfile(router: ReturnType<typeof useRouter>) {
  return useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/home" as never);
  }, [router]);
}

export default function MemberProfileScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  const router = useRouter();
  const leaveProfile = useLeaveMemberProfile(router);
  const insets = useSafeAreaInsets();
  const { member: currentMember } = useAuth();

  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [friendStatus, setFriendStatus] = useState<"none" | "friends" | "pending_outgoing" | "pending_incoming">("none");
  const [incomingRequestId, setIncomingRequestId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [messageLoading, setMessageLoading] = useState(false);
  const [memberPosts, setMemberPosts] = useState<MemberPost[]>([]);
  const [postsNextCursor, setPostsNextCursor] = useState<string | null>(null);
  const [postsLoading, setPostsLoading] = useState(false);
  const [memberPhotosGalleryOpen, setMemberPhotosGalleryOpen] = useState(false);
  const [memberPhotosGalleryInitialIndex, setMemberPhotosGalleryInitialIndex] = useState(0);
  const [heroGalleryOpen, setHeroGalleryOpen] = useState(false);
  const [heroGalleryIndex, setHeroGalleryIndex] = useState(0);

  const isOwnProfile =
    !!currentMember?.id && (currentMember.id === id || currentMember.id === profile?.id);

  const loadProfile = useCallback(async (refresh = false) => {
    if (!id || typeof id !== "string") return null;
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const data = await apiGet<MemberProfile>(`/api/members/${id}`);
      if (data) {
        setProfile(data);
        if (data.canSeeFullProfile === false && data.id !== currentMember?.id) {
          setMemberPosts([]);
          setPostsNextCursor(null);
        }
        return data;
      }
      setError("Profile not found");
      return null;
    } catch {
      setError("Could not load profile");
      setProfile(null);
      return null;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id, currentMember?.id]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    if (!profile || !currentMember?.id || profile.id === currentMember.id) return;
    apiGet<{
      incoming: { id: string; requester: { id: string } }[];
      outgoing: { addressee: { id: string } }[];
      friends: { id: string }[];
    }>("/api/friend-requests")
      .then((data) => {
        if (data?.friends?.some((f: { id: string }) => f.id === profile.id)) {
          setFriendStatus("friends");
          setIncomingRequestId(null);
        } else if (data?.outgoing?.some((r: { addressee: { id: string } }) => r.addressee?.id === profile.id)) {
          setFriendStatus("pending_outgoing");
          setIncomingRequestId(null);
        } else {
          const incoming = data?.incoming?.find((r: { requester: { id: string } }) => r.requester?.id === profile.id);
          if (incoming) {
            setFriendStatus("pending_incoming");
            setIncomingRequestId((incoming as { id: string }).id);
          } else {
            setFriendStatus("none");
            setIncomingRequestId(null);
          }
        }
      })
      .catch(() => {});
  }, [profile?.id, currentMember?.id]);

  const handleAddFriend = async () => {
    if (!profile || actionLoading) return;
    if (friendStatus === "pending_incoming" && incomingRequestId) {
      setActionLoading("friend");
      try {
        await apiPatch(`/api/friend-requests/${incomingRequestId}`, { status: "accepted" });
        setFriendStatus("friends");
        setIncomingRequestId(null);
      } catch {
        Alert.alert("Error", "Could not accept friend request.");
      } finally {
        setActionLoading(null);
      }
      return;
    }
    setActionLoading("friend");
    try {
      await apiPost("/api/friend-requests", { addresseeId: profile.id });
      setFriendStatus("pending_outgoing");
    } catch {
      Alert.alert("Error", "Could not send friend request.");
    } finally {
      setActionLoading(null);
    }
  };

  const handleMessage = async () => {
    if (!profile || !currentMember || messageLoading) return;
    setMessageLoading(true);
    try {
      const conv = await apiPost<{ id: string }>("/api/direct-conversations", { addresseeId: profile.id });
      if (conv?.id) router.push(`/messages/${conv.id}`);
      else Alert.alert("Error", "Could not open chat.");
    } catch (e) {
      const err = e as { error?: string };
      Alert.alert("Error", err.error ?? "Could not open chat.");
    } finally {
      setMessageLoading(false);
    }
  };

  const handleDeclineFriend = async () => {
    if (!incomingRequestId || actionLoading) return;
    setActionLoading("decline");
    try {
      await apiPatch(`/api/friend-requests/${incomingRequestId}`, { status: "declined" });
      setFriendStatus("none");
      setIncomingRequestId(null);
    } catch {
      Alert.alert("Error", "Could not decline friend request.");
    } finally {
      setActionLoading(null);
    }
  };

  const handleUnfriend = async () => {
    if (!profile || actionLoading || friendStatus !== "friends") return;
    Alert.alert(
      "Unfriend",
      `Are you sure you want to unfriend ${profile.firstName}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unfriend",
          style: "destructive",
          onPress: async () => {
            setMenuOpen(false);
            setActionLoading("unfriend");
            try {
              await apiPost(`/api/members/${profile.id}/unfriend`, {});
              setFriendStatus("none");
            } catch {
              Alert.alert("Error", "Could not unfriend this member.");
            } finally {
              setActionLoading(null);
            }
          },
        },
      ]
    );
  };

  const loadMemberPosts = useCallback(
    async (cursor?: string | null) => {
      const targetId = (typeof profile?.id === "string" ? profile.id : null) ?? id;
      if (!targetId || typeof targetId !== "string") return;
      const isAppend = !!cursor;
      setPostsLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("limit", "9");
        if (cursor) params.set("cursor", cursor);
        const data = await apiGet<{ posts: MemberPost[]; nextCursor: string | null }>(
          `/api/members/${targetId}/posts?${params}`
        );
        const posts = data?.posts ?? [];
        setMemberPosts((prev) => (isAppend ? [...prev, ...posts] : posts));
        setPostsNextCursor(data?.nextCursor ?? null);
      } catch {
        if (!isAppend) setMemberPosts([]);
      } finally {
        setPostsLoading(false);
      }
    },
    [id, profile?.id]
  );

  useEffect(() => {
    if (!id || !profile?.id) return;
    const own = !!currentMember?.id && currentMember.id === profile.id;
    if (!own && profile.canSeeFullProfile === false) return;
    loadMemberPosts();
  }, [id, profile?.id, profile?.canSeeFullProfile, currentMember?.id, loadMemberPosts]);

  const onRefresh = useCallback(async () => {
    const data = await loadProfile(true);
    if (!data) return;
    const own = !!currentMember?.id && currentMember.id === data.id;
    if (own || data.canSeeFullProfile !== false) {
      await loadMemberPosts();
    }
  }, [loadProfile, loadMemberPosts, currentMember?.id]);

  const handleShareProfile = useCallback(async () => {
    if (!profile) return;
    setMenuOpen(false);
    const url = `${SITE_BASE}/members/${profile.id}`;
    const name = `${profile.firstName} ${profile.lastName}`.trim() || "this member";
    try {
      await Share.share({
        message: `Check out ${name}'s profile on Inland Northwest Community\n${url}`,
        url,
        title: name,
      });
    } catch {
      /* cancelled */
    }
  }, [profile]);

  const handleBlock = () => {
    if (!profile) return;
    if (!currentMember) {
      Alert.alert("Sign in", "Please sign in to block members.");
      setMenuOpen(false);
      return;
    }
    Alert.alert(
      "Block member",
      `Block ${profile.firstName} ${profile.lastName}? You won't see their content and they won't be able to message you.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Block",
          style: "destructive",
          onPress: async () => {
            setActionLoading("block");
            try {
              await apiPost("/api/members/block", { memberId: profile.id });
              setMenuOpen(false);
              leaveProfile();
            } catch {
              Alert.alert("Error", "Could not block.");
            } finally {
              setActionLoading(null);
            }
          },
        },
      ]
    );
  };

  const handleReport = () => {
    if (!profile) return;
    if (!currentMember) {
      Alert.alert("Sign in", "Please sign in to report members.");
      setMenuOpen(false);
      return;
    }
    Alert.alert(
      "Report member",
      "Why are you reporting this member?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Political", onPress: () => submitReport("political") },
        { text: "Hate / harassment", onPress: () => submitReport("hate") },
        { text: "Spam", onPress: () => submitReport("spam") },
        { text: "Other", onPress: () => submitReport("other") },
      ]
    );
    setMenuOpen(false);
  };

  const submitReport = async (reason: "political" | "hate" | "nudity" | "spam" | "other") => {
    if (!profile) return;
    try {
      await apiPost("/api/reports", {
        contentType: "member",
        contentId: profile.id,
        reason,
      });
      Alert.alert("Report submitted", "Thank you. We will review this.");
    } catch {
      Alert.alert("Error", "Could not submit report.");
    }
  };

  const photoGallery = useMemo(() => {
    const urls: string[] = [];
    const items: { post: MemberPost; photoIndex: number; uri: string }[] = [];
    for (const post of memberPosts) {
      const url = firstGalleryPhoto(post);
      if (!url) continue;
      urls.push(url);
      items.push({ post, photoIndex: urls.length - 1, uri: url });
      if (urls.length >= 9) break;
    }
    return { urls, items };
  }, [memberPosts]);

  const favoriteBusinesses = profile?.favoriteBusinesses ?? [];
  const blogs = profile?.blogs ?? [];
  const coverUrl = resolveUrl(profile?.coverPhotoUrl);
  const avatarUrl = resolveUrl(profile?.profilePhotoUrl);
  const heroImages = useMemo(() => {
    const urls: string[] = [];
    if (coverUrl) urls.push(coverUrl);
    if (avatarUrl) urls.push(avatarUrl);
    return urls;
  }, [coverUrl, avatarUrl]);
  const canSeeFull = isOwnProfile || profile?.canSeeFullProfile !== false;
  const memberSinceLabel = formatMemberSince(profile?.memberSince);
  const showStats =
    canSeeFull &&
    (profile?.postCount != null || profile?.friendCount != null || memberSinceLabel != null);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.pageBackground, paddingTop: insets.top + 48 }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (error || !profile) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
        <Pressable onPress={leaveProfile} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.primary} />
        </Pressable>
        <View style={styles.center}>
          <Text style={styles.errorText}>{error || "Profile not found"}</Text>
        </View>
      </View>
    );
  }

  const displayName = `${profile.firstName} ${profile.lastName}`.trim();
  const actionsDisabled = actionLoading != null;

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={styles.headerSide}>
          <Pressable onPress={leaveProfile} style={styles.headerIconBtn} hitSlop={8}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </Pressable>
        </View>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {displayName}
        </Text>
        <View style={[styles.headerSide, styles.headerSideRight]}>
          <Pressable onPress={handleShareProfile} style={styles.headerIconBtn} hitSlop={8}>
            <Ionicons name="share-outline" size={22} color="#fff" />
          </Pressable>
          {!isOwnProfile ? (
            <Pressable style={styles.headerIconBtn} onPress={() => setMenuOpen(true)} hitSlop={8}>
              <Ionicons name="ellipsis-vertical" size={22} color="#fff" />
            </Pressable>
          ) : null}
        </View>
      </View>

      {!isOwnProfile &&
      friendStatus === "pending_incoming" &&
      incomingRequestId &&
      currentMember ? (
        <View style={styles.incomingRequestBanner}>
          <Text style={styles.incomingRequestTitle}>Friend request</Text>
          <Text style={styles.incomingRequestSubtitle}>
            {profile.firstName} wants to connect with you
          </Text>
          <View style={styles.incomingRequestActions}>
            <Pressable
              style={[styles.incomingAcceptBtn, actionsDisabled && styles.incomingBtnDisabled]}
              onPress={handleAddFriend}
              disabled={actionsDisabled}
            >
              {actionLoading === "friend" ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.incomingAcceptBtnText}>Accept</Text>
              )}
            </Pressable>
            <Pressable
              style={[styles.incomingDeclineBtn, actionsDisabled && styles.incomingBtnDisabled]}
              onPress={handleDeclineFriend}
              disabled={actionsDisabled}
            >
              {actionLoading === "decline" ? (
                <ActivityIndicator color={theme.colors.earth} />
              ) : (
                <Text style={styles.incomingDeclineBtnText}>Decline</Text>
              )}
            </Pressable>
          </View>
        </View>
      ) : null}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[theme.colors.primary]}
            tintColor={theme.colors.primary}
          />
        }
      >
        <View style={styles.coverWrap}>
          {coverUrl ? (
            <Pressable
              style={styles.cover}
              onPress={() => {
                if (heroImages.length === 0) return;
                setHeroGalleryIndex(0);
                setHeroGalleryOpen(true);
              }}
            >
              <AppImage uri={coverUrl} targetWidth={SCREEN_WIDTH} style={styles.cover} resizeMode="cover" />
            </Pressable>
          ) : (
            <LinearGradient
              colors={[theme.colors.cream, theme.colors.primary]}
              start={{ x: 0.1, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.cover}
            />
          )}
          <LinearGradient colors={["transparent", "rgba(93,79,64,0.45)"]} style={styles.coverGradient} />
        </View>

        <View style={styles.identityCard}>
          <View style={styles.profileRow}>
            <Pressable
              onPress={() => {
                if (!avatarUrl) return;
                const idx = heroImages.indexOf(avatarUrl);
                setHeroGalleryIndex(idx >= 0 ? idx : 0);
                setHeroGalleryOpen(true);
              }}
              style={styles.avatarWrap}
            >
              {avatarUrl ? (
                <AppImage uri={avatarUrl} targetWidth={AVATAR_SIZE} style={styles.avatar} resizeMode="cover" />
              ) : (
                <View style={styles.avatarPlaceholder}>
                  <Text style={styles.avatarInitials}>
                    {profile.firstName?.[0]}
                    {profile.lastName?.[0]}
                  </Text>
                </View>
              )}
            </Pressable>
            <View style={styles.profileInfo}>
              <View style={styles.nameRow}>
                <Text style={styles.name} numberOfLines={2}>
                  {displayName}
                </Text>
                {friendStatus === "friends" ? (
                  <View style={styles.friendsChip}>
                    <Ionicons name="people" size={12} color={theme.colors.earth} />
                    <Text style={styles.friendsChipText}>Friends</Text>
                  </View>
                ) : null}
              </View>
              {profile.city != null && profile.city !== "" ? (
                <View style={styles.cityRow}>
                  <Ionicons name="location-outline" size={14} color={theme.colors.earth} />
                  <Text style={styles.cityText}>{profile.city}</Text>
                </View>
              ) : null}
            </View>
          </View>

          {canSeeFull && profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
          {canSeeFull && profile.allTimePointsEarned != null ? (
            <Text style={styles.metaText}>All time reward points: {profile.allTimePointsEarned}</Text>
          ) : null}

          {showStats ? (
            <View style={styles.statsRow}>
              {profile.postCount != null ? (
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>{profile.postCount}</Text>
                  <Text style={styles.statLabel}>{profile.postCount === 1 ? "Post" : "Posts"}</Text>
                </View>
              ) : null}
              {profile.friendCount != null ? (
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>{profile.friendCount}</Text>
                  <Text style={styles.statLabel}>{profile.friendCount === 1 ? "Friend" : "Friends"}</Text>
                </View>
              ) : null}
              {memberSinceLabel ? (
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>{memberSinceLabel}</Text>
                  <Text style={styles.statLabel}>Joined</Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {isOwnProfile ? (
            <View style={styles.actionsRow}>
              <Pressable
                style={[styles.primaryBtn, styles.actionBtnEqual]}
                onPress={() => router.push("/profile-edit")}
              >
                <Ionicons name="create-outline" size={18} color="#fff" />
                <Text style={styles.primaryBtnText}>Edit Profile</Text>
              </Pressable>
              <Pressable
                style={[styles.secondaryBtn, styles.actionBtnEqual]}
                onPress={handleShareProfile}
              >
                <Ionicons name="share-outline" size={18} color={theme.colors.primary} />
                <Text style={styles.secondaryBtnText}>Share</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.actionsBlock}>
              {friendStatus === "pending_incoming" ? (
                <Pressable
                  style={[
                    styles.secondaryBtn,
                    styles.messageFullWidth,
                    (!currentMember || messageLoading) && styles.btnDisabled,
                  ]}
                  onPress={
                    currentMember
                      ? handleMessage
                      : () => Alert.alert("Sign in", "Please sign in to message this member.")
                  }
                  disabled={!currentMember || messageLoading}
                >
                  {messageLoading ? (
                    <ActivityIndicator color={theme.colors.primary} />
                  ) : (
                    <>
                      <Ionicons name="chatbubble-outline" size={18} color={theme.colors.primary} />
                      <Text style={styles.secondaryBtnText} numberOfLines={1}>
                        Message {profile.firstName}
                      </Text>
                    </>
                  )}
                </Pressable>
              ) : (
                <View style={styles.actionsRow}>
                  <Pressable
                    style={[
                      friendStatus === "friends" ? styles.goldOutlineBtn : styles.primaryBtn,
                      styles.actionBtnEqual,
                      friendStatus === "pending_outgoing" && styles.btnDisabled,
                      !currentMember && styles.btnDisabled,
                    ]}
                    onPress={
                      currentMember
                        ? handleAddFriend
                        : () => Alert.alert("Sign in", "Please sign in to add friends.")
                    }
                    disabled={
                      !!actionLoading ||
                      friendStatus === "pending_outgoing" ||
                      friendStatus === "friends"
                    }
                  >
                    {actionLoading === "friend" ? (
                      <ActivityIndicator color={friendStatus === "friends" ? theme.colors.gold : "#fff"} />
                    ) : (
                      <>
                        <Ionicons
                          name={
                            friendStatus === "none"
                              ? "person-add"
                              : friendStatus === "pending_outgoing"
                                ? "time-outline"
                                : "people-outline"
                          }
                          size={18}
                          color={friendStatus === "friends" ? theme.colors.earth : "#fff"}
                        />
                        <Text
                          style={
                            friendStatus === "friends" ? styles.goldOutlineBtnText : styles.primaryBtnText
                          }
                          numberOfLines={1}
                        >
                          {friendStatus === "pending_outgoing"
                            ? "Pending"
                            : friendStatus === "friends"
                              ? "Friends"
                              : "Add Friend"}
                        </Text>
                      </>
                    )}
                  </Pressable>
                  <Pressable
                    style={[
                      friendStatus === "friends" ? styles.primaryBtn : styles.secondaryBtn,
                      styles.actionBtnEqual,
                      (!currentMember || messageLoading) && styles.btnDisabled,
                    ]}
                    onPress={
                      currentMember
                        ? handleMessage
                        : () => Alert.alert("Sign in", "Please sign in to message this member.")
                    }
                    disabled={!currentMember || messageLoading}
                  >
                    {messageLoading ? (
                      <ActivityIndicator
                        color={friendStatus === "friends" ? "#fff" : theme.colors.primary}
                      />
                    ) : (
                      <>
                        <Ionicons
                          name="chatbubble-outline"
                          size={18}
                          color={friendStatus === "friends" ? "#fff" : theme.colors.primary}
                        />
                        <Text
                          style={
                            friendStatus === "friends" ? styles.primaryBtnText : styles.secondaryBtnText
                          }
                          numberOfLines={1}
                        >
                          Message
                        </Text>
                      </>
                    )}
                  </Pressable>
                </View>
              )}
            </View>
          )}
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>{profile.firstName}'s Photos</Text>
          {!currentMember ? (
            <View style={styles.messageBox}>
              <Ionicons name="lock-closed-outline" size={22} color={theme.colors.earth} />
              <Text style={styles.messageBoxText}>Sign in to view {profile.firstName}'s photos</Text>
            </View>
          ) : !canSeeFull ? (
            <View style={styles.messageBox}>
              <Ionicons name="people-outline" size={22} color={theme.colors.earth} />
              <Text style={styles.messageBoxText}>Photos are only visible to friends</Text>
            </View>
          ) : photoGallery.items.length === 0 && !postsLoading ? (
            <View style={styles.messageBox}>
              <Ionicons name="images-outline" size={22} color={theme.colors.earth} />
              <Text style={styles.messageBoxText}>
                {isOwnProfile
                  ? "Post in the feed to add photos to your gallery"
                  : `${profile.firstName} hasn't posted photos yet`}
              </Text>
            </View>
          ) : (
            <>
              <View style={styles.photosGrid} collapsable={false}>
                {photoGallery.items.map((item) => (
                  <TouchableOpacity
                    key={item.post.id}
                    style={styles.photoCell}
                    activeOpacity={0.8}
                    onPress={() => {
                      setMemberPhotosGalleryInitialIndex(item.photoIndex);
                      setMemberPhotosGalleryOpen(true);
                    }}
                    hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                  >
                    <AppImage
                      uri={item.uri}
                      targetWidth={CELL_SIZE}
                      style={styles.photoCellImage}
                      resizeMode="cover"
                    />
                  </TouchableOpacity>
                ))}
              </View>
              {postsLoading && photoGallery.items.length === 0 ? (
                <ActivityIndicator color={theme.colors.primary} style={{ marginTop: 8 }} />
              ) : null}
              {postsNextCursor ? (
                <Pressable
                  style={({ pressed }) => [styles.loadMorePhotos, pressed && styles.pressed]}
                  onPress={() => loadMemberPosts(postsNextCursor)}
                  disabled={postsLoading}
                >
                  <Text style={styles.loadMorePhotosText}>
                    {postsLoading ? "Loading…" : "Load more"}
                  </Text>
                </Pressable>
              ) : null}
            </>
          )}
        </View>

        {canSeeFull && favoriteBusinesses.length > 0 ? (
          <View style={styles.sectionCard}>
            <Pressable
              style={({ pressed }) => [styles.sectionHeaderRow, pressed && styles.pressed]}
              onPress={() => router.push(`/members/businesses/${profile.id}`)}
            >
              <Text style={styles.sectionTitle}>Favorite Businesses</Text>
              <Ionicons name="chevron-forward" size={20} color={theme.colors.gold} />
            </Pressable>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.businessGallery}>
              {favoriteBusinesses.map((b) => {
                const logoUri = b.logoUrl ? (resolveUrl(b.logoUrl) ?? b.logoUrl) : undefined;
                return (
                  <Pressable
                    key={b.id}
                    style={({ pressed }) => [styles.businessPreviewCard, pressed && styles.pressed]}
                    onPress={() =>
                      router.push(
                        buildBusinessPath(b.slug, { type: "member-profile", memberId: profile.id }) as never
                      )
                    }
                  >
                    {logoUri ? (
                      <AppImage
                        uri={logoUri}
                        targetWidth={96}
                        style={styles.businessPreviewImage}
                        resizeMode="cover"
                      />
                    ) : (
                      <View style={[styles.businessPreviewImage, styles.businessLogoPlaceholder]}>
                        <Text style={styles.businessLogoText}>{b.name[0]}</Text>
                      </View>
                    )}
                    <Text style={styles.businessPreviewName} numberOfLines={2}>
                      {b.name}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ) : null}

        {canSeeFull && blogs.length > 0 ? (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Blogs</Text>
            {blogs.map((b, i) => (
              <Pressable
                key={b.id}
                style={({ pressed }) => [
                  styles.blogRow,
                  i < blogs.length - 1 && styles.blogRowBorder,
                  pressed && styles.pressed,
                ]}
                onPress={() =>
                  router.push(
                    `/web?url=${encodeURIComponent(`${SITE_BASE}/blog/${b.slug}`)}&title=${encodeURIComponent(b.title)}` as never
                  )
                }
              >
                <View style={styles.blogTextWrap}>
                  <Text style={styles.blogTitle} numberOfLines={2}>
                    {b.title}
                  </Text>
                  <Text style={styles.blogDate}>{formatBlogDate(b.createdAt)}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.colors.gold} />
              </Pressable>
            ))}
          </View>
        ) : null}

        <View style={{ height: 28 }} />
      </ScrollView>

      <Modal visible={menuOpen} transparent animationType="fade">
        <Pressable style={styles.menuOverlay} onPress={() => setMenuOpen(false)}>
          <View style={styles.menuPanel}>
            <View style={styles.menuHandle} />
            <Pressable style={styles.menuItem} onPress={handleShareProfile}>
              <Ionicons name="share-outline" size={20} color={theme.colors.earth} />
              <Text style={styles.menuItemText}>Share profile</Text>
            </Pressable>
            {friendStatus === "friends" ? (
              <Pressable style={styles.menuItem} onPress={handleUnfriend}>
                <Ionicons name="person-remove-outline" size={20} color="#c00" />
                <Text style={styles.menuItemDanger}>Unfriend</Text>
              </Pressable>
            ) : null}
            <Pressable style={styles.menuItem} onPress={handleBlock}>
              <Ionicons name="ban-outline" size={20} color="#c00" />
              <Text style={styles.menuItemDanger}>Block member</Text>
            </Pressable>
            <Pressable style={styles.menuItem} onPress={handleReport}>
              <Ionicons name="flag-outline" size={20} color={theme.colors.earth} />
              <Text style={styles.menuItemText}>Report member</Text>
            </Pressable>
            <Pressable style={styles.menuItem} onPress={() => setMenuOpen(false)}>
              <Text style={styles.menuItemText}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {heroImages.length > 0 ? (
        <ImageGalleryViewer
          visible={heroGalleryOpen}
          images={heroImages}
          initialIndex={Math.min(heroGalleryIndex, heroImages.length - 1)}
          onClose={() => setHeroGalleryOpen(false)}
        />
      ) : null}

      {photoGallery.urls.length > 0 ? (
        <ImageGalleryViewer
          visible={memberPhotosGalleryOpen}
          images={photoGallery.urls}
          initialIndex={Math.min(memberPhotosGalleryInitialIndex, photoGallery.urls.length - 1)}
          onClose={() => setMemberPhotosGalleryOpen(false)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.pageBackground },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingBottom: 10,
    backgroundColor: theme.colors.primary,
  },
  headerSide: {
    width: 88,
    flexDirection: "row",
    alignItems: "center",
  },
  headerSideRight: {
    justifyContent: "flex-end",
  },
  headerIconBtn: { padding: 8, width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "700",
    color: "#fff",
    textAlign: "center",
    fontFamily: theme.fonts.heading,
  },
  backBtn: { padding: 8, marginRight: 8 },
  incomingRequestBanner: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: theme.colors.cream,
    borderBottomWidth: 2,
    borderBottomColor: theme.colors.gold,
  },
  incomingRequestTitle: { fontSize: 15, fontWeight: "700", color: theme.colors.heading },
  incomingRequestSubtitle: { fontSize: 14, color: theme.colors.earth, marginTop: 4, marginBottom: 12 },
  incomingRequestActions: { flexDirection: "row", gap: 12 },
  incomingAcceptBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: theme.radii.button,
    backgroundColor: theme.colors.primary,
    minHeight: 44,
  },
  incomingAcceptBtnText: { fontSize: 16, fontWeight: "600", color: "#fff" },
  incomingDeclineBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: theme.radii.button,
    borderWidth: 2,
    borderColor: theme.colors.earth,
    backgroundColor: "#fff",
    minHeight: 44,
  },
  incomingDeclineBtnText: { fontSize: 16, fontWeight: "600", color: theme.colors.earth },
  incomingBtnDisabled: { opacity: 0.65 },
  messageFullWidth: { width: "100%" },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 8 },
  coverWrap: { height: COVER_HEIGHT, backgroundColor: theme.colors.cream, position: "relative" },
  cover: { width: "100%", height: COVER_HEIGHT },
  coverGradient: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 72,
  },
  identityCard: {
    backgroundColor: theme.colors.surface,
    marginHorizontal: PAGE_PAD,
    marginTop: -36,
    borderRadius: theme.radii.card,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
    ...theme.shadows.card,
  },
  profileRow: { flexDirection: "row", gap: 14, alignItems: "flex-end" },
  avatarWrap: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    marginTop: -52,
    borderRadius: AVATAR_SIZE / 2,
    borderWidth: 3,
    borderColor: "#fff",
    overflow: "hidden",
    backgroundColor: theme.colors.cream,
    ...theme.shadows.card,
  },
  avatar: { width: "100%", height: "100%" },
  avatarPlaceholder: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.cream,
  },
  avatarInitials: { fontSize: 28, fontWeight: "700", color: theme.colors.earth },
  profileInfo: { flex: 1, justifyContent: "center", minWidth: 0, paddingBottom: 4 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  name: {
    fontSize: 22,
    fontWeight: "700",
    color: theme.colors.heading,
    fontFamily: theme.fonts.heading,
    flexShrink: 1,
  },
  friendsChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: theme.colors.cream,
    borderWidth: 1,
    borderColor: theme.colors.gold,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: theme.radii.chip,
  },
  friendsChipText: { fontSize: 11, fontWeight: "700", color: theme.colors.earth },
  cityRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  cityText: { fontSize: 14, color: theme.colors.earth },
  bio: { fontSize: 15, color: theme.colors.text, lineHeight: 22, marginTop: 12 },
  metaText: { fontSize: 14, color: theme.colors.earth, marginTop: 8 },
  statsRow: {
    flexDirection: "row",
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: theme.colors.borderMuted,
  },
  statItem: { flex: 1, alignItems: "center" },
  statValue: { fontSize: 16, fontWeight: "700", color: theme.colors.heading },
  statLabel: { fontSize: 12, color: theme.colors.earth, marginTop: 2 },
  actionsBlock: { marginTop: 14 },
  sectionCard: {
    backgroundColor: theme.colors.surface,
    marginHorizontal: PAGE_PAD,
    marginTop: 14,
    borderRadius: theme.radii.card,
    paddingHorizontal: CARD_PAD,
    paddingTop: 14,
    paddingBottom: 14,
    ...theme.shadows.card,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 10,
    color: theme.colors.heading,
    fontFamily: theme.fonts.heading,
  },
  messageBox: {
    paddingVertical: 22,
    paddingHorizontal: 16,
    backgroundColor: theme.colors.cream,
    borderRadius: theme.radii.card,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  messageBoxText: { fontSize: 15, color: theme.colors.earth, textAlign: "center" },
  photosGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: GRID_GAP,
  },
  photoCell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: theme.colors.cardImageWell,
  },
  photoCellImage: { width: "100%", height: "100%", backgroundColor: theme.colors.cardImageWell },
  loadMorePhotos: {
    paddingVertical: 10,
    alignItems: "center",
  },
  loadMorePhotosText: { fontSize: 15, fontWeight: "600", color: theme.colors.primary },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  btnDisabled: { opacity: 0.7 },
  actionsRow: { flexDirection: "row", gap: 10, marginTop: 14, alignItems: "stretch" },
  actionBtnEqual: { flex: 1, minWidth: 0 },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: theme.radii.button,
    backgroundColor: theme.colors.primary,
    minHeight: 44,
  },
  primaryBtnText: { fontSize: 15, fontWeight: "600", color: "#fff" },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: theme.radii.button,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    backgroundColor: "#fff",
    minHeight: 44,
  },
  secondaryBtnText: { fontSize: 15, fontWeight: "600", color: theme.colors.primary },
  goldOutlineBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: theme.radii.button,
    borderWidth: 2,
    borderColor: theme.colors.gold,
    backgroundColor: theme.colors.cream,
    minHeight: 44,
  },
  goldOutlineBtnText: { fontSize: 15, fontWeight: "600", color: theme.colors.earth },
  businessLogoPlaceholder: { backgroundColor: theme.colors.cream, justifyContent: "center", alignItems: "center" },
  businessLogoText: { fontSize: 18, fontWeight: "700", color: theme.colors.earth },
  pressed: { opacity: 0.8 },
  errorText: { fontSize: 16, color: theme.colors.earth },
  menuOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  menuPanel: {
    backgroundColor: theme.colors.cream,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingBottom: 24,
    paddingTop: 8,
  },
  menuHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.gold,
    marginBottom: 8,
  },
  menuItem: { paddingVertical: 14, flexDirection: "row", alignItems: "center", gap: 10 },
  menuItemText: { fontSize: 16, color: theme.colors.earth },
  menuItemDanger: { fontSize: 16, color: "#c00" },
  businessGallery: { marginTop: 4 },
  businessPreviewCard: { width: 96, marginRight: 14, alignItems: "center" },
  businessPreviewImage: { width: 96, height: 96, borderRadius: 10 },
  businessPreviewName: { fontSize: 13, color: theme.colors.text, marginTop: 6, textAlign: "center" },
  blogRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
  },
  blogRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderMuted,
  },
  blogTextWrap: { flex: 1, minWidth: 0 },
  blogTitle: { fontSize: 15, fontWeight: "600", color: theme.colors.primary },
  blogDate: { fontSize: 12, color: theme.colors.earth, marginTop: 2 },
});
