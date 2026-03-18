import { useEffect, useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Image,
  Pressable,
  ActivityIndicator,
  Alert,
  Modal,
} from "react-native";
import { TouchableOpacity } from "react-native-gesture-handler";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Dimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPost, apiPatch } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { ImageGalleryViewer } from "@/components/ImageGalleryViewer";
import { getBadgeIcon } from "@/lib/badge-icons";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const GRID_GAP = 4;
const COLS = 3;
const { width: SCREEN_WIDTH } = Dimensions.get("window");
const CELL_SIZE = Math.floor((SCREEN_WIDTH - 32 - GRID_GAP * (COLS - 1)) / COLS);

interface Badge {
  id: string;
  name: string;
  slug: string;
  description?: string;
}

interface FavoriteBusiness {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
}

interface MemberProfile {
  id: string;
  firstName: string;
  lastName: string;
  profilePhotoUrl: string | null;
  bio: string | null;
  city: string | null;
  allTimePointsEarned: number;
  badges: Badge[];
  favoriteBusinesses: FavoriteBusiness[];
  /** When false, profile is private and viewer is not a friend; photos/posts are hidden. */
  canSeeFullProfile?: boolean;
}

interface MemberPost {
  id: string;
  content: string | null;
  photos: string[];
  createdAt: string;
  author: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null };
}

function resolveUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  const base = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");
  return path.startsWith("http") ? path : `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}

export default function MemberProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { member: currentMember } = useAuth();

  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [badgePopup, setBadgePopup] = useState<Badge | null>(null);
  const [friendStatus, setFriendStatus] = useState<"none" | "friends" | "pending_outgoing" | "pending_incoming">("none");
  const [incomingRequestId, setIncomingRequestId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [memberPosts, setMemberPosts] = useState<MemberPost[]>([]);
  const [postsNextCursor, setPostsNextCursor] = useState<string | null>(null);
  const [postsLoading, setPostsLoading] = useState(false);
  const [memberPhotosGalleryOpen, setMemberPhotosGalleryOpen] = useState(false);
  const [memberPhotosGalleryInitialIndex, setMemberPhotosGalleryInitialIndex] = useState(0);

  const loadProfile = useCallback(async () => {
    if (!id || typeof id !== "string") return;
    setLoading(true);
    setError("");
    try {
      const data = await apiGet<MemberProfile>(`/api/members/${id}`);
      if (data) {
        setProfile(data);
        if (data.canSeeFullProfile === false) {
          setMemberPosts([]);
          setPostsNextCursor(null);
        }
      } else setError("Profile not found");
    } catch {
      setError("Could not load profile");
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

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

  const handleMessage = () => {
    if (!profile) return;
    router.push(`/messages/new?addresseeId=${profile.id}`);
  };

  const loadMemberPosts = useCallback(
    async (cursor?: string | null) => {
      const targetId = id ?? profile?.id;
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
    if (!id || !profile?.id || profile.canSeeFullProfile === false) return;
    loadMemberPosts();
  }, [id, profile?.id, profile?.canSeeFullProfile, loadMemberPosts]);


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
              router.back();
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

  const isOwnProfile = currentMember?.id === id;

  if (loading) {
    return (
      <View style={[styles.center, { paddingTop: insets.top + 48 }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (error || !profile) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.primary} />
        </Pressable>
        <View style={styles.center}>
          <Text style={styles.errorText}>{error || "Profile not found"}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {profile.firstName} {profile.lastName}
        </Text>
        {!isOwnProfile ? (
          <Pressable style={styles.menuBtn} onPress={() => setMenuOpen(true)}>
            <Ionicons name="ellipsis-vertical" size={22} color="#fff" />
          </Pressable>
        ) : (
          <View style={styles.headerRight} />
        )}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.profileBlock}>
          <View style={styles.profileRow}>
            {profile.profilePhotoUrl ? (
              <Image source={{ uri: resolveUrl(profile.profilePhotoUrl) ?? profile.profilePhotoUrl }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarInitials}>
                  {profile.firstName?.[0]}
                  {profile.lastName?.[0]}
                </Text>
              </View>
            )}
            <View style={styles.profileInfo}>
              <Text style={styles.name}>
                {profile.firstName} {profile.lastName}
              </Text>
              {profile.city != null && profile.city !== "" ? (
                <Text style={styles.cityText}>{profile.city}</Text>
              ) : null}
              {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
              {profile.allTimePointsEarned != null ? (
                <Text style={styles.metaText}>All time reward points: {profile.allTimePointsEarned}</Text>
              ) : null}
            </View>
          </View>
        </View>

        {!isOwnProfile ? (
          <View style={styles.actionsBlock}>
            <View style={styles.actionsRow}>
              <Pressable
                style={[
                  styles.primaryBtn,
                  styles.actionBtnEqual,
                  { backgroundColor: theme.colors.primary },
                  (friendStatus === "pending_outgoing" || friendStatus === "friends") && styles.primaryBtnDisabled,
                  !currentMember && styles.primaryBtnDisabled,
                ]}
                onPress={currentMember ? handleAddFriend : () => Alert.alert("Sign in", "Please sign in to add friends.")}
                disabled={!!actionLoading || friendStatus === "pending_outgoing" || friendStatus === "friends"}
              >
                {actionLoading === "friend" ? (
                  <Text style={styles.primaryBtnText}>…</Text>
                ) : (
                  <>
                    {friendStatus === "none" || friendStatus === "pending_incoming" ? (
                      <Ionicons name="person-add" size={20} color="#fff" style={styles.primaryBtnIcon} />
                    ) : friendStatus === "pending_outgoing" ? (
                      <Ionicons name="time-outline" size={20} color="#fff" style={styles.primaryBtnIcon} />
                    ) : (
                      <Ionicons name="people-outline" size={20} color="#fff" style={styles.primaryBtnIcon} />
                    )}
                    <Text style={styles.primaryBtnText} numberOfLines={1}>
                      {friendStatus === "pending_incoming" ? "Accept" : friendStatus === "pending_outgoing" ? "Pending" : friendStatus === "friends" ? "Friends" : "Add Friend"}
                    </Text>
                  </>
                )}
              </Pressable>
              <Pressable
                style={[styles.secondaryBtn, styles.actionBtnEqual, { borderColor: theme.colors.primary }, !currentMember && styles.primaryBtnDisabled]}
                onPress={currentMember ? handleMessage : () => Alert.alert("Sign in", "Please sign in to message this member.")}
              >
                <Ionicons name="chatbubble-outline" size={20} color={theme.colors.primary} />
                <Text style={[styles.secondaryBtnText, { color: theme.colors.primary }]} numberOfLines={1}>
                  Message {profile.firstName}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : isOwnProfile ? (
          <View style={styles.actionsRowSpacer} />
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{profile.firstName}'s Photos</Text>
          {!currentMember ? (
            <View style={styles.photosMessageBox}>
              <Text style={styles.photosMessageText}>Sign in to view {profile.firstName}'s photos</Text>
            </View>
          ) : profile.canSeeFullProfile === false ? (
            <View style={styles.photosMessageBox}>
              <Text style={styles.photosMessageText}>Photos are only visible to friends</Text>
            </View>
          ) : (
            <>
              <View style={styles.photosGrid} collapsable={false}>
                {(() => {
                  const memberPhotosFlatUrls: string[] = [];
                  const items: { type: "post"; post: MemberPost; photoIndex: number } | { type: "placeholder"; index: number }[] = [];
                  for (const post of memberPosts) {
                    const first = (post.photos ?? [])[0];
                    if (first) {
                      const url = resolveUrl(first) ?? first;
                      if (url) {
                        memberPhotosFlatUrls.push(url);
                        items.push({ type: "post", post, photoIndex: memberPhotosFlatUrls.length - 1 });
                      }
                    }
                    if (memberPhotosFlatUrls.length >= 9) break;
                  }
                  while (items.length < 9) {
                    items.push({ type: "placeholder", index: items.length });
                  }
                  return items.slice(0, 9).map((item) =>
                    item.type === "post" ? (
                      <TouchableOpacity
                        key={item.post.id}
                        style={[styles.photoCell, styles.photoCellBordered]}
                        activeOpacity={0.8}
                        onPress={() => {
                          setMemberPhotosGalleryInitialIndex(item.photoIndex);
                          setMemberPhotosGalleryOpen(true);
                        }}
                        hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                      >
                        <Image
                          source={{ uri: resolveUrl(item.post.photos?.[0]) ?? item.post.photos?.[0] }}
                          style={styles.photoCellImage}
                          pointerEvents="none"
                        />
                      </TouchableOpacity>
                    ) : (
                      <View key={`placeholder-${item.index}`} style={[styles.photoCell, styles.photoCellBordered, styles.photoCellPlaceholder]}>
                        <Ionicons name="images-outline" size={CELL_SIZE * 0.35} color="#999" />
                        <Text style={styles.photoCellPlaceholderText} numberOfLines={3}>
                          {isOwnProfile
                            ? "Post in the feed to add photos to your gallery"
                            : "No photo yet"}
                        </Text>
                      </View>
                    )
                  );
                })()}
              </View>
              {postsNextCursor && (
                <Pressable
                  style={({ pressed }) => [styles.loadMorePhotos, pressed && styles.pressed]}
                  onPress={() => loadMemberPosts(postsNextCursor)}
                  disabled={postsLoading}
                >
                  <Text style={styles.loadMorePhotosText}>
                    {postsLoading ? "Loading…" : "Load more"}
                  </Text>
                </Pressable>
              )}
            </>
          )}
        </View>

        {profile.favoriteBusinesses.length > 0 && (
          <View style={[styles.section, styles.sectionWithLine]}>
            <Pressable
              style={({ pressed }) => [styles.sectionHeaderRow, pressed && styles.pressed]}
              onPress={() => router.push(`/members/businesses/${profile.id}`)}
            >
              <Text style={styles.sectionTitle}>Favorite Businesses</Text>
              <Ionicons name="chevron-forward" size={20} color={theme.colors.primary} />
            </Pressable>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.businessGallery}>
              {profile.favoriteBusinesses.map((b) => {
                const logoUri = b.logoUrl ? (resolveUrl(b.logoUrl) ?? b.logoUrl) : undefined;
                return (
                  <Pressable
                    key={b.id}
                    style={({ pressed }) => [styles.businessPreviewCard, pressed && styles.pressed]}
                    onPress={() => router.push(`/business/${b.slug}`)}
                  >
                    {logoUri ? (
                      <Image source={{ uri: logoUri }} style={styles.businessPreviewImage} resizeMode="cover" />
                    ) : (
                      <View style={[styles.businessPreviewImage, styles.businessLogoPlaceholder]}>
                        <Text style={styles.businessLogoText}>{b.name[0]}</Text>
                      </View>
                    )}
                    <Text style={styles.businessPreviewName} numberOfLines={2}>{b.name}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}

        {profile.badges.length > 0 && (
          <View style={[styles.section, styles.sectionWithLine]}>
            <Text style={styles.sectionTitle}>Badges</Text>
            <View style={styles.badgesRow}>
              {profile.badges.map((b) => (
                <Pressable
                  key={b.id}
                  style={({ pressed }) => [styles.badgeCircle, pressed && styles.pressed]}
                  onPress={() => setBadgePopup(b)}
                >
                  <Ionicons name={getBadgeIcon(b.slug)} size={26} color={theme.colors.primary} />
                </Pressable>
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      <Modal visible={menuOpen} transparent animationType="fade">
        <Pressable style={styles.menuOverlay} onPress={() => setMenuOpen(false)}>
          <View style={styles.menuPanel}>
            <Pressable style={styles.menuItem} onPress={handleBlock}>
              <Text style={styles.menuItemDanger}>Block member</Text>
            </Pressable>
            <Pressable style={styles.menuItem} onPress={handleReport}>
              <Text style={styles.menuItemText}>Report member</Text>
            </Pressable>
            <Pressable style={styles.menuItem} onPress={() => setMenuOpen(false)}>
              <Text style={styles.menuItemText}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={!!badgePopup} transparent animationType="fade">
        <Pressable style={styles.badgeOverlay} onPress={() => setBadgePopup(null)}>
          <Pressable style={styles.badgePopupCard} onPress={(e) => e.stopPropagation()}>
            <View style={styles.badgePopupIconWrap}>
              <Ionicons name={getBadgeIcon(badgePopup?.slug ?? "")} size={48} color={theme.colors.primary} />
            </View>
            <Text style={styles.badgePopupTitle}>{badgePopup?.name}</Text>
            {badgePopup?.description ? (
              <Text style={styles.badgePopupDescription}>{badgePopup.description}</Text>
            ) : null}
            <Pressable style={styles.badgePopupCloseBtn} onPress={() => setBadgePopup(null)}>
              <Text style={styles.badgePopupCloseText}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {(() => {
        const memberPhotosFlatUrls: string[] = [];
        for (const post of memberPosts) {
          const first = (post.photos ?? [])[0];
          if (first) {
            const url = resolveUrl(first) ?? first;
            if (url) memberPhotosFlatUrls.push(url);
          }
          if (memberPhotosFlatUrls.length >= 9) break;
        }
        if (memberPhotosFlatUrls.length === 0 || !memberPhotosGalleryOpen) return null;
        const safeIndex = Math.min(memberPhotosGalleryInitialIndex, memberPhotosFlatUrls.length - 1);
        return (
          <ImageGalleryViewer
            visible={memberPhotosGalleryOpen}
            images={memberPhotosFlatUrls}
            initialIndex={safeIndex}
            onClose={() => setMemberPhotosGalleryOpen(false)}
          />
        );
      })()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: theme.colors.primary,
    borderBottomWidth: 2,
    borderBottomColor: "#000",
  },
  backBtn: { padding: 8, marginRight: 8 },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: "700", color: "#fff", textAlign: "center" },
  headerRight: { width: 40 },
  menuBtn: { padding: 8 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 32 },
  profileBlock: { borderBottomWidth: 1, borderBottomColor: "#e0e0e0", paddingBottom: 16, marginBottom: 16 },
  profileRow: { flexDirection: "row", gap: 16 },
  actionsBlock: { borderBottomWidth: 1, borderBottomColor: "#e0e0e0", paddingBottom: 16, marginBottom: 20 },
  avatar: { width: 80, height: 80, borderRadius: 40 },
  avatarPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#e0e0e0",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitials: { fontSize: 24, fontWeight: "700", color: "#666" },
  profileInfo: { flex: 1, justifyContent: "center", minWidth: 0 } as const,
  name: { fontSize: 22, fontWeight: "700", color: theme.colors.heading },
  cityText: { fontSize: 14, color: "#666", marginTop: 4 },
  bio: { fontSize: 15, color: "#333", lineHeight: 22, marginTop: 6 },
  metaText: { fontSize: 14, color: "#666", marginTop: 6 },
  section: { marginBottom: 20 },
  sectionWithLine: { borderTopWidth: 1, borderTopColor: "#e0e0e0", paddingTop: 20, marginTop: 4 },
  sectionTitle: { fontSize: 16, fontWeight: "700", marginBottom: 8, color: theme.colors.heading },
  photosMessageBox: {
    paddingVertical: 24,
    paddingHorizontal: 16,
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  photosMessageText: { fontSize: 15, color: "#666", textAlign: "center" },
  photosGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: GRID_GAP,
    marginBottom: 8,
  },
  photoCell: { width: CELL_SIZE, height: CELL_SIZE },
  photoCellBordered: { borderWidth: 1, borderColor: "#ddd", backgroundColor: "#f5f5f5" },
  photoCellImage: { width: "100%", height: "100%", backgroundColor: "#eee" },
  photoCellPlaceholder: {
    backgroundColor: "#f5f5f5",
    alignItems: "center",
    justifyContent: "center",
    padding: 6,
  },
  photoCellPlaceholderText: {
    fontSize: 10,
    color: "#999",
    textAlign: "center",
    marginTop: 4,
  },
  loadMorePhotos: {
    paddingVertical: 10,
    alignItems: "center",
  },
  loadMorePhotosText: { fontSize: 15, fontWeight: "600", color: theme.colors.primary },
  sectionHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  primaryBtnDisabled: { opacity: 0.7 },
  badgesRow: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  badgeChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: "#f0f0f0" },
  badgeText: { fontSize: 12, color: "#555" },
  badgeCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#f0f0f0",
    alignItems: "center",
    justifyContent: "center",
  },
  actionsRow: { flexDirection: "row", gap: 12, marginBottom: 20, alignItems: "stretch" },
  actionsRowSpacer: { marginBottom: 20, minHeight: 44 },
  actionBtnEqual: { flex: 1, minWidth: 0 },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8 },
  primaryBtnIcon: { marginRight: 0 },
  primaryBtnText: { fontSize: 15, fontWeight: "600", color: "#fff" },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 2,
  },
  secondaryBtnText: { fontSize: 15, fontWeight: "600" },
  businessRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#eee",
    borderRadius: 8,
    marginBottom: 8,
  },
  businessLogo: { width: 40, height: 40, borderRadius: 8 },
  businessLogoPlaceholder: { backgroundColor: "#eee", justifyContent: "center", alignItems: "center" },
  businessLogoText: { fontSize: 18, fontWeight: "700", color: "#666" },
  businessName: { flex: 1, fontSize: 15, color: "#333" },
  pressed: { opacity: 0.8 },
  errorText: { fontSize: 16, color: "#666" },
  menuOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  menuPanel: { backgroundColor: "#fff", borderTopLeftRadius: 12, borderTopRightRadius: 12, padding: 16 },
  menuItem: { paddingVertical: 14 },
  menuItemText: { fontSize: 16, color: "#333" },
  menuItemDanger: { fontSize: 16, color: "#c00" },
  businessGallery: { marginTop: 8 },
  businessPreviewCard: { width: 96, marginRight: 16, alignItems: "center" },
  businessPreviewImage: { width: 96, height: 96, borderRadius: 8 },
  businessPreviewName: { fontSize: 13, color: "#333", marginTop: 6, textAlign: "center" },
  badgeOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", alignItems: "center", padding: 24 },
  badgePopupCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 24,
    maxWidth: 320,
    width: "100%",
    alignItems: "center",
  },
  badgePopupIconWrap: { marginBottom: 12 },
  badgePopupTitle: { fontSize: 18, fontWeight: "700", color: theme.colors.heading, textAlign: "center" },
  badgePopupDescription: { fontSize: 15, color: "#333", lineHeight: 22, marginTop: 8, textAlign: "center" },
  badgePopupCloseBtn: { marginTop: 16, paddingVertical: 10, paddingHorizontal: 20 },
  badgePopupCloseText: { fontSize: 16, fontWeight: "600", color: theme.colors.primary },
});
