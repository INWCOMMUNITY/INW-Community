import { useCallback, useEffect, useMemo, useRef, useState, useLayoutEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Image,
  ActivityIndicator,
  Alert,
  Modal,
  RefreshControl,
  FlatList,
  Platform,
  type ViewToken,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { theme } from "@/lib/theme";
import { apiGet, apiPost, apiPatch } from "@/lib/api";
import { fetchGroupFeed, type FeedPost } from "@/lib/feed-api";
import { useFeedQuery, flattenFeedPages } from "@/hooks/use-feed";
import { useFeedInteractions } from "@/hooks/use-feed-interactions";
import { FeedPostCard } from "@/components/FeedPostCard";
import { FeedCommentsModal } from "@/components/FeedCommentsModal";
import { useAuth } from "@/contexts/AuthContext";
import { useCreatePost } from "@/contexts/CreatePostContext";
import { ImageGalleryViewer } from "@/components/ImageGalleryViewer";
import { ShareToChatModal } from "@/components/ShareToChatModal";

const API_BASE = process.env.EXPO_PUBLIC_API_URL?.replace(/\/api.*$/, "") || "https://www.inwcommunity.com";
function toFullUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  return url.startsWith("http") ? url : `${API_BASE}${url.startsWith("/") ? "" : "/"}${url}`;
}

interface GroupDetail {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category: string | null;
  coverImageUrl: string | null;
  rules: string | null;
  allowBusinessPosts?: boolean;
  isMember: boolean;
  memberRole: string | null;
  createdBy: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null };
  _count?: { members: number; groupPosts: number };
}

export default function GroupDetailScreen() {
  const { slug, adminInvite } = useLocalSearchParams<{ slug: string; adminInvite?: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const { member } = useAuth();
  const createPostMenu = useCreatePost();
  const openEditPost = createPostMenu?.openEditPost;
  const openCreatePostInGroup = createPostMenu?.openCreatePostInGroup;
  const createPostVisible = createPostMenu?.createPostVisible;
  const signedIn = !!member;
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [rulesModalOpen, setRulesModalOpen] = useState(false);

  const queryKey = useMemo(() => ["group-feed", slug] as const, [slug]);

  const {
    data,
    isLoading: feedLoading,
    isFetchingNextPage: loadingMore,
    isRefetching,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = useFeedQuery(
    queryKey,
    (cursor) => fetchGroupFeed(slug!, cursor),
    { enabled: !!slug && !!group?.isMember }
  );

  const posts = useMemo(() => flattenFeedPages(data), [data]);
  const refreshing = isRefetching && !loadingMore;

  const [commentPostId, setCommentPostId] = useState<string | null>(null);
  const [coverGalleryOpen, setCoverGalleryOpen] = useState(false);
  const [coverGalleryIndex, setCoverGalleryIndex] = useState(0);
  const [shareToChatPost, setShareToChatPost] = useState<{ id: string } | null>(null);
  const [viewerManagedBusinessIds, setViewerManagedBusinessIds] = useState<string[]>([]);
  const [groupFeedVisibleIds, setGroupFeedVisibleIds] = useState<Set<string>>(new Set());
  const [groupFeedViewabilityReady, setGroupFeedViewabilityReady] = useState(false);
  const groupFeedViewabilityConfig = useRef({
    itemVisiblePercentThreshold: 40,
    minimumViewTime: 100,
  }).current;

  const onGroupFeedViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const next = new Set<string>();
      for (const v of viewableItems) {
        if (v.isViewable && v.item && typeof (v.item as FeedPost).id === "string") {
          next.add((v.item as FeedPost).id);
        }
      }
      setGroupFeedVisibleIds(next);
      setGroupFeedViewabilityReady(true);
    },
    []
  );

  const {
    handleLike,
    handleComment,
    handleShare,
    handleSave,
    handleReport,
    handleBlockUser,
    handleDeletePost,
    handleCommentAdded,
    handleSourcePostShared,
  } = useFeedInteractions({
    queryKey,
    signedIn,
    authMemberId: member?.id,
    onCommentOpen: setCommentPostId,
    onShareOpen: (postId) => setShareToChatPost({ id: postId }),
  });

  useEffect(() => {
    if (!member) {
      setViewerManagedBusinessIds([]);
      return;
    }
    apiGet<{ id: string }[]>("/api/businesses?mine=1")
      .then((rows) =>
        setViewerManagedBusinessIds(Array.isArray(rows) ? rows.map((r) => r.id) : [])
      )
      .catch(() => setViewerManagedBusinessIds([]));
  }, [member?.id]);

  const groupGalleryUrls = useMemo(() => {
    if (!group) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    const add = (u?: string | null) => {
      if (!u || seen.has(u)) return;
      seen.add(u);
      out.push(u);
    };
    add(toFullUrl(group.coverImageUrl));
    for (const p of posts) {
      for (const ph of p.photos ?? []) {
        add(toFullUrl(ph));
      }
    }
    return out;
  }, [group, posts]);

  const load = useCallback(async () => {
    if (!slug) return;
    try {
      const data = await apiGet<GroupDetail>(`/api/groups/${slug}`);
      setGroup(data);
    } catch {
      setGroup(null);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useLayoutEffect(() => {
    if (group?.name) {
      navigation.setOptions({
        title: group.name,
        headerRight:
          group.memberRole === "admin"
            ? () => (
                <Pressable
                  onPress={() =>
                    (router.push as (h: string) => void)(`/community/group-admin?slug=${encodeURIComponent(slug)}`)
                  }
                  hitSlop={12}
                  style={({ pressed }) => [{ paddingHorizontal: 10, opacity: pressed ? 0.85 : 1 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Group admin"
                >
                  <Ionicons name="shield" size={24} color="#fff" />
                </Pressable>
              )
            : undefined,
      });
    }
  }, [group?.name, group?.memberRole, navigation, router, slug]);

  const adminInviteHandledSlugRef = useRef<string | null>(null);
  useEffect(() => {
    if (adminInvite !== "1" || !slug || !member) return;
    if (adminInviteHandledSlugRef.current === slug) return;
    adminInviteHandledSlugRef.current = slug;
    let cancelled = false;
    void (async () => {
      try {
        await apiPatch(`/api/groups/${slug}/admin-invite`, { action: "accept" });
        if (!cancelled) {
          Alert.alert("Co-admin", "You accepted the group admin invite.");
          await load();
        }
      } catch (e) {
        adminInviteHandledSlugRef.current = null;
        if (!cancelled) {
          const msg = (e as { error?: string })?.error ?? "Could not accept invite.";
          Alert.alert("Invite", msg);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adminInvite, slug, member?.id, load]);

  const wasCreatePostOpenRef = useRef(false);
  useEffect(() => {
    if (wasCreatePostOpenRef.current && !createPostVisible && group?.isMember && slug) {
      void refetch();
    }
    wasCreatePostOpenRef.current = !!createPostVisible;
  }, [createPostVisible, group?.isMember, refetch, slug]);

  useLayoutEffect(() => {
    if (!group?.isMember || !openCreatePostInGroup || !group) {
      navigation.setOptions({
        headerRight: undefined,
        ...(Platform.OS === "ios" ? { unstable_headerRightItems: undefined } : {}),
      });
      return;
    }

    const groupIdForPost = group.id;
    if (Platform.OS === "ios") {
      navigation.setOptions({
        headerRight: undefined,
        unstable_headerRightItems: () => [
          {
            type: "custom",
            element: (
              <Pressable
                onPress={() =>
                  openCreatePostInGroup(groupIdForPost, !!group.allowBusinessPosts)
                }
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Create Post in this group"
              >
                <Ionicons name="add" size={26} color="#fff" />
              </Pressable>
            ),
            hidesSharedBackground: true,
          },
        ],
      });
    } else {
      navigation.setOptions({
        unstable_headerRightItems: undefined,
        headerRight: () => (
          <Pressable
            onPress={() =>
                  openCreatePostInGroup(groupIdForPost, !!group.allowBusinessPosts)
                }
            style={({ pressed }) => [pressed && { opacity: 0.85 }]}
            android_ripple={{ color: "rgba(255,255,255,0.2)", borderless: true }}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Create Post in this group"
          >
            <Ionicons name="add" size={26} color="#fff" />
          </Pressable>
        ),
      });
    }
  }, [group?.id, group?.isMember, navigation, openCreatePostInGroup]);

  const handleJoin = async (agreedToRules = false) => {
    if (!group || joining) return;
    if (group.rules?.trim() && !agreedToRules) {
      setRulesModalOpen(true);
      return;
    }
    setJoining(true);
    try {
      await apiPost(`/api/groups/${group.slug}/join`, { agreedToRules: true });
      setGroup((g) => (g ? { ...g, isMember: true, memberRole: "member" } : g));
      setRulesModalOpen(false);
    } catch (e) {
      const err = e as { error?: string };
      Alert.alert("Error", err?.error ?? "Failed to join group");
    } finally {
      setJoining(false);
    }
  };

  const refreshGroupFeed = useCallback(() => {
    if (group?.isMember && slug) void refetch();
  }, [group?.isMember, slug, refetch]);

  if (loading || !group) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        {!loading && !group && <Text style={styles.notFound}>Group not found.</Text>}
      </View>
    );
  }

  const coverUri = toFullUrl(group.coverImageUrl);

  const listHeader = (
    <>
      {coverUri ? (
        <Pressable
          onPress={() => {
            if (groupGalleryUrls.length === 0) return;
            setCoverGalleryIndex(0);
            setCoverGalleryOpen(true);
          }}
          accessibilityRole="button"
          accessibilityLabel="View group photos"
        >
          <Image source={{ uri: coverUri }} style={styles.cover} resizeMode="cover" />
        </Pressable>
      ) : (
        <View style={styles.coverPlaceholder}>
          <Ionicons name="people" size={48} color={theme.colors.primary} />
        </View>
      )}
      <View style={styles.body}>
        <Text style={styles.name}>{group.name}</Text>
        {group.category ? (
          <Text style={styles.category}>{group.category}</Text>
        ) : null}
        {group._count && (
          <Text style={styles.meta}>
            {group._count.members} members · {group._count.groupPosts} posts
          </Text>
        )}
        {group.description ? (
          <Text style={styles.description}>{group.description}</Text>
        ) : null}
        {group.rules?.trim() ? (
          <View style={styles.rulesBlock}>
            <Text style={styles.rulesTitle}>Group rules</Text>
            <Text style={styles.rulesText}>{group.rules}</Text>
          </View>
        ) : null}
        {!group.isMember && (
          <Pressable
            style={({ pressed }) => [styles.joinBtn, pressed && styles.joinBtnPressed]}
            onPress={() => handleJoin(false)}
            disabled={joining}
          >
            {joining ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.joinBtnText}>Join group</Text>
            )}
          </Pressable>
        )}
        {group.isMember && group.memberRole === "admin" && (
          <Text style={styles.adminBadge}>Admin</Text>
        )}
      </View>
      {group.isMember ? (
        <View style={styles.feedSectionHeader}>
          <Text style={styles.feedSectionTitle}>Group feed</Text>
          {feedLoading && posts.length === 0 ? (
            <View style={styles.feedLoading}>
              <ActivityIndicator size="large" color={theme.colors.primary} />
            </View>
          ) : null}
        </View>
      ) : null}
    </>
  );

  const listFooter =
    group.isMember && hasNextPage ? (
      <View style={styles.feedPostWrap}>
        <Pressable
          style={({ pressed }) => [
            styles.loadMoreBtn,
            (loadingMore || pressed) && styles.buttonPressed,
          ]}
          onPress={() => fetchNextPage()}
          disabled={loadingMore}
        >
          {loadingMore ? (
            <ActivityIndicator size="small" color={theme.colors.primary} />
          ) : (
            <Text style={styles.loadMoreText}>Load more</Text>
          )}
        </Pressable>
      </View>
    ) : null;

  const renderFeedEmpty = () => {
    if (!group.isMember || feedLoading || posts.length > 0) return null;
    return (
      <View style={styles.feedPostWrap}>
        <Text style={styles.feedEmpty}>No posts in this group yet. Be the first to post!</Text>
      </View>
    );
  };

  return (
    <>
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={group.isMember ? posts : []}
      keyExtractor={(item) => item.id}
      viewabilityConfig={groupFeedViewabilityConfig}
      onViewableItemsChanged={onGroupFeedViewableItemsChanged}
      renderItem={({ item }) => (
        <View style={styles.feedPostWrap}>
          <FeedPostCard
            post={item}
            onLike={handleLike}
            onComment={handleComment}
            onShare={handleShare}
            onReport={handleReport}
            onBlockUser={signedIn ? handleBlockUser : undefined}
            onSave={handleSave}
            onEditPost={openEditPost}
            onDeletePost={handleDeletePost}
            viewerManagedBusinessIds={
              viewerManagedBusinessIds.length ? viewerManagedBusinessIds : undefined
            }
            isFeedCardVisible={
              !groupFeedViewabilityReady ? false : groupFeedVisibleIds.has(item.id)
            }
          />
        </View>
      )}
      ListHeaderComponent={listHeader}
      ListFooterComponent={listFooter}
      ListEmptyComponent={group.isMember ? renderFeedEmpty : undefined}
      refreshControl={
        group.isMember && slug ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => refetch()}
            colors={[theme.colors.primary]}
          />
        ) : undefined
      }
    />

      {commentPostId && (
        <FeedCommentsModal
          visible={!!commentPostId}
          postId={commentPostId}
          post={posts.find((p) => p.id === commentPostId) ?? undefined}
          initialCommentCount={
            posts.find((p) => p.id === commentPostId)?.commentCount ?? 0
          }
          onClose={() => setCommentPostId(null)}
          onCommentAdded={() => handleCommentAdded(commentPostId)}
        />
      )}

      {shareToChatPost && group && (
        <ShareToChatModal
          visible={!!shareToChatPost}
          onClose={() => setShareToChatPost(null)}
          sharedContent={{ type: "post", id: shareToChatPost.id }}
          defaultFeedGroupId={group.id}
          onShareToFeedComplete={refreshGroupFeed}
          onSourcePostShared={handleSourcePostShared}
        />
      )}

      {rulesModalOpen && group.rules?.trim() && (
        <Modal visible transparent animationType="fade">
          <Pressable style={styles.modalOverlay} onPress={() => setRulesModalOpen(false)}>
            <View style={styles.modalSheet}>
              <Text style={styles.modalTitle}>Group rules</Text>
              <ScrollView style={styles.modalRulesScroll}>
                <Text style={styles.modalRulesText}>{group.rules}</Text>
              </ScrollView>
              <Text style={styles.modalHint}>You must agree to the rules to join.</Text>
              <View style={styles.modalActions}>
                <Pressable style={styles.modalCancelBtn} onPress={() => setRulesModalOpen(false)}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.modalAgreeBtn, pressed && { opacity: 0.8 }]}
                  onPress={() => handleJoin(true)}
                  disabled={joining}
                >
                  {joining ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.modalAgreeText}>I agree</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </Pressable>
        </Modal>
      )}

      <ImageGalleryViewer
        key={coverGalleryOpen ? groupGalleryUrls.join("|") : "closed"}
        visible={coverGalleryOpen && groupGalleryUrls.length > 0}
        images={groupGalleryUrls}
        initialIndex={coverGalleryIndex}
        onClose={() => setCoverGalleryOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { paddingBottom: 40 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  notFound: { marginTop: 12, fontSize: 16, color: theme.colors.placeholder },
  cover: { width: "100%", height: 360, backgroundColor: theme.colors.cream },
  coverPlaceholder: {
    width: "100%",
    height: 360,
    backgroundColor: theme.colors.cream,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { padding: 16 },
  name: { fontSize: 22, fontWeight: "700", color: theme.colors.heading, marginBottom: 4 },
  category: { fontSize: 14, color: theme.colors.primary, marginBottom: 4 },
  meta: { fontSize: 14, color: theme.colors.placeholder, marginBottom: 12 },
  description: { fontSize: 16, color: theme.colors.heading, lineHeight: 24, marginBottom: 16 },
  rulesBlock: { marginBottom: 16, padding: 12, backgroundColor: "#f5f5f5", borderRadius: 8 },
  rulesTitle: { fontSize: 14, fontWeight: "600", marginBottom: 6 },
  rulesText: { fontSize: 14, color: theme.colors.heading, lineHeight: 20 },
  joinBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
  },
  joinBtnPressed: { opacity: 0.8 },
  joinBtnText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  adminBadge: { fontSize: 14, color: theme.colors.primary, fontWeight: "600", marginTop: 8 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 24 },
  modalSheet: { backgroundColor: "#fff", borderRadius: 12, padding: 20, maxHeight: "80%" },
  modalTitle: { fontSize: 18, fontWeight: "600", marginBottom: 12 },
  modalRulesScroll: { maxHeight: 200, marginBottom: 12 },
  modalRulesText: { fontSize: 15, lineHeight: 22, color: theme.colors.heading },
  modalHint: { fontSize: 13, color: theme.colors.placeholder, marginBottom: 16 },
  modalActions: { flexDirection: "row", gap: 12, justifyContent: "flex-end" },
  modalCancelBtn: { paddingVertical: 10, paddingHorizontal: 16 },
  modalCancelText: { fontSize: 16, color: theme.colors.placeholder },
  modalAgreeBtn: { backgroundColor: theme.colors.primary, paddingVertical: 10, paddingHorizontal: 24, borderRadius: 8 },
  modalAgreeText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  feedSectionHeader: { paddingHorizontal: 16, paddingTop: 24 },
  feedPostWrap: { paddingHorizontal: 16 },
  feedSectionTitle: { fontSize: 18, fontWeight: "700", color: theme.colors.heading, marginBottom: 16 },
  feedLoading: { paddingVertical: 32, alignItems: "center" },
  feedEmpty: { fontSize: 15, color: theme.colors.placeholder, textAlign: "center", paddingVertical: 24 },
  loadMoreBtn: {
    marginTop: 16,
    marginBottom: 24,
    paddingVertical: 12,
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },
  loadMoreText: { fontSize: 16, fontWeight: "600", color: theme.colors.primary },
  buttonPressed: { opacity: 0.8 },
});
