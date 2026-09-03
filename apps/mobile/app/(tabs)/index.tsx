import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Platform,
  ScrollView,
  Animated,
  Dimensions,
  type ListRenderItemInfo,
  type ViewToken,
} from "react-native";
import { FlatList } from "react-native-gesture-handler";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useScrollToTop } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { getToken, apiGet } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { CommunityUgcTermsModal } from "@/components/CommunityUgcTermsModal";
import { fetchFeed, fetchNewPostCount, type FeedPost } from "@/lib/feed-api";
import { useFeedQuery, flattenFeedPages } from "@/hooks/use-feed";
import { useFeedInteractions } from "@/hooks/use-feed-interactions";
import { FeedPostCard } from "@/components/FeedPostCard";
import { FeedPostSkeleton } from "@/components/FeedPostSkeleton";
import { prefetchImages } from "@/components/AppImage";
import { FeedCommentsModal } from "@/components/FeedCommentsModal";
import { CouponPopup } from "@/components/CouponPopup";
import { ShareToChatModal } from "@/components/ShareToChatModal";
import { useCreatePost } from "@/contexts/CreatePostContext";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");
const UGC_TERMS_STORAGE_KEY = "nwc_community_ugc_terms_v2";

const FEED_FILTERS = [
  { key: "all", label: "All" },
  { key: "friends", label: "Friends" },
  { key: "groups", label: "Groups" },
  { key: "businesses", label: "Businesses" },
  { key: "trending", label: "Trending" },
] as const;

const NEW_POSTS_POLL_INTERVAL = 60_000;
/** Kept in scope so Metro HMR cannot crash on a stale StyleSheet ref. */
const feedActionBtnBorder = theme.colors.earth;

export default function CommunityScreen() {
  const feedListRef = useRef<FlatList<FeedPost>>(null);
  /** Re-tap Community tab while on this screen → scroll feed to top (see React Navigation tabPress). */
  useScrollToTop(feedListRef);

  const createPostMenu = useCreatePost();
  const openCreatePost = createPostMenu?.openCreatePost ?? (() => {});
  const openEditPost = createPostMenu?.openEditPost;
  const createPostVisible = createPostMenu?.createPostVisible ?? false;
  const prevCreatePostVisibleRef = useRef(false);
  const router = useRouter();
  const { member: authMember } = useAuth();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [ugcGate, setUgcGate] = useState<"loading" | "needs" | "ok">("loading");
  const [feedFilter, setFeedFilter] = useState<string>("all");
  const [couponPopupId, setCouponPopupId] = useState<string | null>(null);
  const [shareToChatPost, setShareToChatPost] = useState<{ id: string; slug?: string } | null>(null);
  const [commentPostId, setCommentPostId] = useState<string | null>(null);
  const [viewerManagedBusinessIds, setViewerManagedBusinessIds] = useState<string[]>([]);
  /** Feed videos autoplay only when their card is sufficiently on-screen. */
  const [feedVisiblePostIds, setFeedVisiblePostIds] = useState<Set<string>>(new Set());
  const [feedViewabilityReady, setFeedViewabilityReady] = useState(false);
  const [pendingIncomingFriendRequests, setPendingIncomingFriendRequests] = useState(0);

  // ─── New posts polling (4B) ───────────────────────────────────────────
  const [newPostCount, setNewPostCount] = useState(0);
  const newestPostTimestamp = useRef<string | null>(null);
  const newPostsBannerAnim = useRef(new Animated.Value(0)).current;

  // ─── React Query feed ───────────────────────────────────────────────
  const feedQueryKey = useMemo(() => ["feed", feedFilter] as const, [feedFilter]);
  const feedFetchFn = useCallback(
    (cursor?: string) => fetchFeed(cursor, feedFilter),
    [feedFilter]
  );

  const {
    data,
    isLoading,
    isFetchingNextPage,
    isRefetching,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = useFeedQuery(feedQueryKey, feedFetchFn, {
    enabled: signedIn !== null && ugcGate === "ok",
  });

  const posts = useMemo(() => flattenFeedPages(data), [data]);
  const loading = isLoading;
  const loadingMore = isFetchingNextPage;
  const refreshing = isRefetching && !isFetchingNextPage;

  // ─── Feed interactions (like, comment, share, save, report, block, delete) ──
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
    queryKey: feedQueryKey,
    signedIn,
    authMemberId: authMember?.id,
    onCommentOpen: setCommentPostId,
    onShareOpen: (postId) => setShareToChatPost({ id: postId }),
  });

  // Prefetch only the first screen of post photos so later pages do not
  // compete with images the user can already see.
  useEffect(() => {
    if (posts.length === 0) return;
    const firstPhotos = posts
      .slice(0, 6)
      .map((p) => p.photos?.[0])
      .filter(Boolean) as string[];
    prefetchImages(firstPhotos, { targetWidth: Dimensions.get("window").width, quality: 60 });
  }, [posts]);

  const loadPendingFriendRequests = useCallback(() => {
    if (signedIn === false) {
      setPendingIncomingFriendRequests(0);
      return;
    }
    if (signedIn !== true) return;
    apiGet<{ incoming?: { id: string }[] }>("/api/friend-requests")
      .then((d) =>
        setPendingIncomingFriendRequests(Array.isArray(d?.incoming) ? d.incoming.length : 0)
      )
      .catch(() => setPendingIncomingFriendRequests(0));
  }, [signedIn]);

  // Track the newest post timestamp for polling
  useEffect(() => {
    if (posts.length > 0 && posts[0].createdAt) {
      newestPostTimestamp.current = posts[0].createdAt;
    }
  }, [posts]);

  // Animate the new posts banner in/out
  useEffect(() => {
    Animated.timing(newPostsBannerAnim, {
      toValue: newPostCount > 0 ? 1 : 0,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [newPostCount, newPostsBannerAnim]);

  // Poll for new posts every 60 seconds when the tab is focused
  useFocusEffect(
    useCallback(() => {
      loadPendingFriendRequests();

      if (!signedIn) return;
      const poll = setInterval(() => {
        const since = newestPostTimestamp.current;
        if (!since) return;
        fetchNewPostCount(since)
          .then((count) => setNewPostCount(count))
          .catch(() => {});
      }, NEW_POSTS_POLL_INTERVAL);
      return () => clearInterval(poll);
    }, [loadPendingFriendRequests, signedIn])
  );

  useEffect(() => {
    if (prevCreatePostVisibleRef.current && !createPostVisible) {
      refetch();
    }
    prevCreatePostVisibleRef.current = createPostVisible;
  }, [createPostVisible, refetch]);

  useEffect(() => {
    if (!authMember) {
      setViewerManagedBusinessIds([]);
      return;
    }
    apiGet<{ id: string }[]>("/api/businesses?mine=1")
      .then((rows) =>
        setViewerManagedBusinessIds(Array.isArray(rows) ? rows.map((r) => r.id) : [])
      )
      .catch(() => setViewerManagedBusinessIds([]));
  }, [authMember?.id]);

  const checkAuth = useCallback(() => {
    getToken().then((token) => {
      setSignedIn(!!token);
    });
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (signedIn === null) return;
    if (!signedIn) {
      setUgcGate("ok");
      return;
    }
    let cancelled = false;
    AsyncStorage.getItem(UGC_TERMS_STORAGE_KEY)
      .then((v) => {
        if (!cancelled) setUgcGate(v === "1" ? "ok" : "needs");
      })
      .catch(() => {
        if (!cancelled) setUgcGate("needs");
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  const acceptUgcTerms = useCallback(() => {
    AsyncStorage.setItem(UGC_TERMS_STORAGE_KEY, "1").catch(() => {});
    setUgcGate("ok");
  }, []);

  const openTermsWeb = useCallback(() => {
    (router.push as (href: string) => void)(
      `/web?url=${encodeURIComponent(`${siteBase}/terms`)}&title=${encodeURIComponent("Terms of Service")}`
    );
  }, [router]);

  const onRefresh = useCallback(() => {
    loadPendingFriendRequests();
    setNewPostCount(0);
    refetch();
  }, [loadPendingFriendRequests, refetch]);

  const handleNewPostsBannerPress = useCallback(() => {
    setNewPostCount(0);
    refetch();
    feedListRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, [refetch]);

  // Auto-close comments modal if the post was removed (e.g. deleted)
  useEffect(() => {
    if (commentPostId && posts.length > 0 && !posts.some((p) => p.id === commentPostId)) {
      setCommentPostId(null);
    }
  }, [commentPostId, posts]);

  const listHeader = useMemo(
    () => (
      <View style={styles.header}>
        <Text style={styles.title}>Northwest Community Feed</Text>
        <Text style={styles.subtitle}>
          {signedIn
            ? "Posts from people you follow and groups you've joined."
            : "Browse recent posts. Sign in to like, comment, and save."}
        </Text>
        <View
          style={[
            styles.headerBtnsRow,
            pendingIncomingFriendRequests > 0 && styles.headerBtnsRowBadgeInset,
          ]}
        >
          <View
            style={[
              styles.headerFriendsWrap,
              pendingIncomingFriendRequests > 0 && styles.headerFriendsWrapRaised,
            ]}
          >
            <Pressable
              style={({ pressed }) => [styles.headerSideBtn, pressed && styles.buttonPressed]}
              onPress={() => {
                if (!signedIn) {
                  Alert.alert("Sign in", "Sign in to find and manage friends.", [
                    { text: "OK" },
                    { text: "Sign in", onPress: () => router.push("/(auth)/login") },
                  ]);
                  return;
                }
                (router.push as (href: string) => void)("/community/my-friends");
              }}
              accessibilityLabel={
                pendingIncomingFriendRequests > 0
                  ? `My friends, ${pendingIncomingFriendRequests} pending friend request${pendingIncomingFriendRequests === 1 ? "" : "s"}`
                  : "My friends"
              }
            >
              <Ionicons name="people-outline" size={22} color={theme.colors.buttonText} />
              <Text style={styles.headerSideBtnLabel}>Friends</Text>
            </Pressable>
            {pendingIncomingFriendRequests > 0 ? (
              <View style={styles.headerFriendRequestBadge} pointerEvents="none">
                <Text style={styles.headerFriendRequestBadgeText}>!</Text>
              </View>
            ) : null}
          </View>
          {signedIn ? (
            <Pressable
              style={({ pressed }) => [styles.createPostBtn, pressed && styles.buttonPressed]}
              onPress={() => openCreatePost()}
            >
              <Text style={styles.createPostBtnText}>Create Post</Text>
            </Pressable>
          ) : (
            <Pressable
              style={({ pressed }) => [styles.createPostBtn, pressed && styles.buttonPressed]}
              onPress={() => router.push("/(auth)/login")}
            >
              <Text style={styles.createPostBtnText}>Sign in</Text>
            </Pressable>
          )}
          <Pressable
            style={({ pressed }) => [styles.headerSideBtn, pressed && styles.buttonPressed]}
            onPress={() => {
              if (!signedIn) {
                Alert.alert("Sign in", "Sign in to browse and join groups.", [
                  { text: "OK" },
                  { text: "Sign in", onPress: () => router.push("/(auth)/login") },
                ]);
                return;
              }
              (router.push as (href: string) => void)("/community/groups");
            }}
            accessibilityLabel="Community groups"
          >
            <Ionicons name="people-circle-outline" size={22} color={theme.colors.buttonText} />
            <Text style={styles.headerSideBtnLabel}>Groups</Text>
          </Pressable>
        </View>

        {/* Filter chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterChipsRow}
          style={styles.filterChipsScroll}
        >
          {FEED_FILTERS.map((f) => (
            <Pressable
              key={f.key}
              style={[
                styles.filterChip,
                feedFilter === f.key ? styles.filterChipActive : styles.filterChipInactive,
              ]}
              onPress={() => setFeedFilter(f.key)}
            >
              <Text
                style={[
                  styles.filterChipText,
                  feedFilter === f.key ? styles.filterChipTextActive : styles.filterChipTextInactive,
                ]}
              >
                {f.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    ),
    [signedIn, pendingIncomingFriendRequests, openCreatePost, router, feedFilter]
  );

  const listEmpty = useMemo(() => {
    if (loading) {
      return <FeedPostSkeleton count={3} />;
    }
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="chatbubbles-outline" size={64} color={theme.colors.primary} style={{ opacity: 0.6, marginBottom: 12 }} />
        <Text style={styles.emptyTitle}>
          {signedIn ? "Your feed is empty" : "No public posts yet"}
        </Text>
        <Text style={styles.emptyDescription}>
          {signedIn
            ? "Follow businesses, join groups, or create a post to start building your personalized feed."
            : "Sign in to see posts from friends, groups, and businesses in your community."}
        </Text>
        {signedIn ? (
          <View style={styles.emptyCTAs}>
            <Pressable
              style={({ pressed }) => [styles.emptyCTABtn, pressed && styles.buttonPressed]}
              onPress={() => (router.push as (href: string) => void)("/(tabs)/support-local")}
            >
              <Ionicons name="storefront-outline" size={16} color={theme.colors.buttonText} />
              <Text style={styles.emptyCTAText}>Find businesses</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.emptyCTABtn, pressed && styles.buttonPressed]}
              onPress={() => (router.push as (href: string) => void)("/community/groups")}
            >
              <Ionicons name="people-outline" size={16} color={theme.colors.buttonText} />
              <Text style={styles.emptyCTAText}>Join a group</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.emptyCTABtnOutline, pressed && styles.buttonPressed]}
              onPress={() => openCreatePost()}
            >
              <Ionicons name="create-outline" size={16} color={theme.colors.primary} />
              <Text style={styles.emptyCTATextOutline}>Create your first post</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            style={({ pressed }) => [styles.emptyCTABtn, pressed && styles.buttonPressed]}
            onPress={() => router.push("/(auth)/login")}
          >
            <Text style={styles.emptyCTAText}>Sign in to get started</Text>
          </Pressable>
        )}
      </View>
    );
  }, [loading, signedIn, openCreatePost, router]);

  const listFooter = useMemo(() => {
    if (!loadingMore) return null;
    return (
      <View style={styles.listFooterLoading}>
        <ActivityIndicator size="small" color={theme.colors.primary} />
      </View>
    );
  }, [loadingMore]);

  const onEndReachedFeed = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const onFeedViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const next = new Set<string>();
      for (const v of viewableItems) {
        if (v.isViewable && v.item && typeof (v.item as FeedPost).id === "string") {
          next.add((v.item as FeedPost).id);
        }
      }
      setFeedVisiblePostIds(next);
      setFeedViewabilityReady(true);
    },
    []
  );

  const feedViewabilityConfig = useRef({
    itemVisiblePercentThreshold: 40,
    minimumViewTime: 100,
  }).current;

  const renderPost = useCallback(
    ({ item }: ListRenderItemInfo<FeedPost>) => (
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
        viewerManagedBusinessIds={viewerManagedBusinessIds.length ? viewerManagedBusinessIds : undefined}
        onOpenCoupon={(id) => setCouponPopupId(id)}
        isFeedCardVisible={
          !feedViewabilityReady ? false : feedVisiblePostIds.has(item.id)
        }
      />
    ),
    [
      handleLike,
      handleComment,
      handleShare,
      handleReport,
      handleBlockUser,
      handleSave,
      openEditPost,
      handleDeletePost,
      viewerManagedBusinessIds,
      signedIn,
      feedViewabilityReady,
      feedVisiblePostIds,
    ]
  );

  if (signedIn === null || ugcGate === "loading") {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <>
      <CommunityUgcTermsModal
        visible={signedIn === true && ugcGate === "needs"}
        onAccept={acceptUgcTerms}
        onOpenTerms={openTermsWeb}
      />

      {/* New posts polling banner */}
      {newPostCount > 0 && (
        <Animated.View
          style={[
            styles.newPostsBanner,
            { opacity: newPostsBannerAnim, transform: [{ translateY: newPostsBannerAnim.interpolate({ inputRange: [0, 1], outputRange: [-40, 0] }) }] },
          ]}
        >
          <Pressable style={styles.newPostsBannerPressable} onPress={handleNewPostsBannerPress}>
            <Ionicons name="arrow-up" size={16} color="#fff" />
            <Text style={styles.newPostsBannerText}>
              {newPostCount} new post{newPostCount === 1 ? "" : "s"} — Tap to refresh
            </Text>
          </Pressable>
        </Animated.View>
      )}

      <FlatList
        ref={feedListRef}
        data={posts}
        keyExtractor={(item) => item.id}
        renderItem={renderPost}
        viewabilityConfig={feedViewabilityConfig}
        onViewableItemsChanged={onFeedViewableItemsChanged}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={listEmpty}
        ListFooterComponent={listFooter}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[theme.colors.primary]}
          />
        }
        onEndReached={onEndReachedFeed}
        onEndReachedThreshold={0.35}
        style={[styles.scroll, styles.scrollOverflowVisible]}
        contentContainerStyle={[
          styles.scrollContent,
          posts.length === 0 && !loading ? styles.scrollContentEmpty : null,
        ]}
        removeClippedSubviews={false}
        windowSize={9}
        maxToRenderPerBatch={6}
        initialNumToRender={4}
        updateCellsBatchingPeriod={50}
        keyboardShouldPersistTaps="handled"
      />

      {couponPopupId && (
        <CouponPopup
          couponId={couponPopupId}
          onClose={() => setCouponPopupId(null)}
        />
      )}

      {shareToChatPost && (
        <ShareToChatModal
          visible={!!shareToChatPost}
          onClose={() => setShareToChatPost(null)}
          sharedContent={{ type: "post", id: shareToChatPost.id, slug: shareToChatPost.slug }}
          onSourcePostShared={handleSourcePostShared}
        />
      )}

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
    </>
  );
}


const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  container: {
    flex: 1,
    padding: 20,
    justifyContent: "center",
  },
  scroll: {
    flex: 1,
    backgroundColor: theme.colors.pageBackground,
  },
  scrollOverflowVisible: {
    overflow: "visible",
  },
  scrollContent: {
    paddingBottom: 40,
  },
  scrollContentEmpty: {
    flexGrow: 1,
  },
  listFooterLoading: {
    paddingVertical: 20,
    alignItems: "center",
  },
  header: {
    marginBottom: 20,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: "bold",
    color: theme.colors.heading,
    fontFamily: theme.fonts.heading,
    textAlign: "center",
  },
  subtitle: {
    marginTop: 6,
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    marginBottom: 16,
  },
  headerBtnsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 8,
    overflow: "visible",
  },
  headerBtnsRowBadgeInset: {
    paddingTop: 6,
    paddingRight: 4,
  },
  headerSideBtn: {
    backgroundColor: theme.colors.earth,
    borderRadius: 6,
    borderWidth: 0,
    borderColor: feedActionBtnBorder,
    minWidth: 52,
    paddingVertical: 8,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  headerFriendsWrap: {
    position: "relative",
    overflow: "visible",
    zIndex: 0,
  },
  headerFriendsWrapRaised: {
    zIndex: 3,
  },
  headerFriendRequestBadge: {
    position: "absolute",
    top: -5,
    right: -5,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 4,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.22,
        shadowRadius: 2,
      },
      android: { elevation: 4 },
      default: {},
    }),
  },
  headerFriendRequestBadgeText: {
    fontSize: 12,
    fontWeight: "800",
    color: theme.colors.primary,
    marginTop: Platform.OS === "ios" ? -1 : 0,
  },
  headerSideBtnLabel: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: "600",
    color: theme.colors.buttonText,
    letterSpacing: 0.2,
  },
  createPostBtn: {
    flex: 1,
    backgroundColor: theme.colors.earth,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  createPostBtnText: {
    color: theme.colors.buttonText,
    fontSize: 16,
    fontWeight: "600",
  },
  webLinkBtn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },
  webLinkBtnText: {
    color: theme.colors.primary,
    fontSize: 16,
    fontWeight: "600",
  },
  buttonPressed: { opacity: 0.8 },
  primaryButton: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 6,
    alignSelf: "center",
    marginTop: 8,
  },
  primaryButtonText: {
    color: theme.colors.buttonText,
    fontSize: 16,
    fontWeight: "600",
  },
  secondaryButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignSelf: "center",
    marginTop: 12,
  },
  secondaryButtonText: {
    color: theme.colors.primary,
    fontSize: 15,
    fontWeight: "500",
  },
  loading: {
    paddingVertical: 48,
    alignItems: "center",
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: "#666",
  },
  emptyContainer: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: theme.colors.heading,
    textAlign: "center",
    marginBottom: 8,
  },
  emptyDescription: {
    fontSize: 15,
    color: "#666",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 20,
  },
  emptyCTAs: {
    gap: 10,
    width: "100%",
    maxWidth: 260,
  },
  emptyCTABtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: theme.colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  emptyCTAText: {
    color: theme.colors.buttonText,
    fontSize: 14,
    fontWeight: "600",
  },
  emptyCTABtnOutline: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  emptyCTATextOutline: {
    color: theme.colors.primary,
    fontSize: 14,
    fontWeight: "600",
  },
  emptyText: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
    lineHeight: 24,
  },
  // Filter chips
  filterChipsScroll: {
    marginTop: 14,
  },
  filterChipsRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 2,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  filterChipActive: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  filterChipInactive: {
    backgroundColor: theme.colors.background,
    borderColor: theme.colors.primary,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: "600",
  },
  filterChipTextActive: {
    color: theme.colors.buttonText,
  },
  filterChipTextInactive: {
    color: theme.colors.primary,
  },
  // New posts banner
  newPostsBanner: {
    position: "absolute",
    top: 0,
    left: 16,
    right: 16,
    zIndex: 100,
    borderRadius: 8,
    overflow: "hidden",
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4 },
      android: { elevation: 6 },
      default: {},
    }),
  },
  newPostsBannerPressable: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: theme.colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  newPostsBannerText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
});
