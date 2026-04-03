import { useState, useEffect, useCallback, useMemo } from "react";
import {
  StyleSheet,
  FlatList,
  Text,
  View,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Platform,
  type ListRenderItemInfo,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { getToken, apiGet } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { CommunityUgcTermsModal } from "@/components/CommunityUgcTermsModal";
import {
  fetchFeed,
  toggleLike,
  deletePost,
  type FeedPost,
} from "@/lib/feed-api";
import { FeedPostCard } from "@/components/FeedPostCard";
import { FeedCommentsModal } from "@/components/FeedCommentsModal";
import { CouponPopup } from "@/components/CouponPopup";
import { ShareToChatModal } from "@/components/ShareToChatModal";
import { useCreatePost } from "@/contexts/CreatePostContext";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");
const UGC_TERMS_STORAGE_KEY = "nwc_community_ugc_terms_v2";

export default function CommunityScreen() {
  const createPostMenu = useCreatePost();
  const openCreatePost = createPostMenu?.openCreatePost ?? (() => {});
  const openEditPost = createPostMenu?.openEditPost;
  const router = useRouter();
  const { member: authMember } = useAuth();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [ugcGate, setUgcGate] = useState<"loading" | "needs" | "ok">("loading");
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [couponPopupId, setCouponPopupId] = useState<string | null>(null);
  const [shareToChatPost, setShareToChatPost] = useState<{ id: string; slug?: string } | null>(null);
  const [commentPostId, setCommentPostId] = useState<string | null>(null);
  const [viewerManagedBusinessIds, setViewerManagedBusinessIds] = useState<string[]>([]);
  const [pendingIncomingFriendRequests, setPendingIncomingFriendRequests] = useState(0);

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

  useFocusEffect(
    useCallback(() => {
      loadPendingFriendRequests();
    }, [loadPendingFriendRequests])
  );

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

  const loadFeed = useCallback(
    async (cursor?: string) => {
      const opts = cursor ? { cursor } : {};
      const { posts: p, nextCursor: c } = await fetchFeed(cursor);
      return { posts: p, nextCursor: c };
    },
    []
  );

  const loadInitial = useCallback(() => {
    setLoading(true);
    loadFeed()
      .then(({ posts: p, nextCursor: c }) => {
        setPosts(p ?? []);
        setNextCursor(c ?? null);
      })
      .catch(() => {
        setPosts([]);
        setNextCursor(null);
      })
      .finally(() => setLoading(false));
  }, [loadFeed]);

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

  useEffect(() => {
    if (signedIn !== null && ugcGate === "ok") {
      loadInitial();
    }
  }, [signedIn, ugcGate, loadInitial]);

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
    setRefreshing(true);
    loadPendingFriendRequests();
    loadFeed()
      .then(({ posts: p, nextCursor: c }) => {
        setPosts(p ?? []);
        setNextCursor(c ?? null);
      })
      .catch(() => {
        setPosts([]);
        setNextCursor(null);
      })
      .finally(() => setRefreshing(false));
  }, [loadFeed, loadPendingFriendRequests]);

  const loadMore = useCallback(() => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    loadFeed(nextCursor)
      .then(({ posts: more, nextCursor: c }) => {
        setPosts((prev) => [...prev, ...more]);
        setNextCursor(c);
      })
      .finally(() => setLoadingMore(false));
  }, [nextCursor, loadingMore, loadFeed]);

  const handleLike = useCallback(
    async (postId: string) => {
      if (!signedIn) {
        Alert.alert("Sign in", "Sign in to like posts.", [
          { text: "OK" },
          { text: "Sign in", onPress: () => router.push("/(auth)/login") },
        ]);
        return;
      }
      try {
        const { liked } = await toggleLike(postId);
        setPosts((prev) =>
          prev.map((p) =>
            p.id === postId
              ? {
                  ...p,
                  liked,
                  likeCount: p.likeCount + (liked ? 1 : -1),
                }
              : p
          )
        );
      } catch (_) {}
    },
    [signedIn, router]
  );

  const handleShare = useCallback(
    (postId: string) => {
      if (!signedIn) {
        Alert.alert("Sign in", "Sign in to share posts.", [
          { text: "OK" },
          { text: "Sign in", onPress: () => router.push("/(auth)/login") },
        ]);
        return;
      }
      setShareToChatPost({ id: postId });
    },
    [signedIn, router]
  );

  const handleComment = useCallback(
    (postId: string) => {
      if (!signedIn) {
        Alert.alert("Sign in", "Sign in to comment on posts.", [
          { text: "OK" },
          { text: "Sign in", onPress: () => router.push("/(auth)/login") },
        ]);
        return;
      }
      setCommentPostId(postId);
    },
    [signedIn]
  );

  const handleSave = useCallback(
    async (postId: string) => {
      if (!signedIn) {
        Alert.alert("Sign in", "Sign in to save posts.", [
          { text: "OK" },
          { text: "Sign in", onPress: () => router.push("/(auth)/login") },
        ]);
        return;
      }
      try {
        const { apiPost } = await import("@/lib/api");
        await apiPost("/api/saved", { type: "post", referenceId: postId });
        Alert.alert("Saved", "Post saved! View it in your Saved Posts.");
      } catch {
        Alert.alert("Error", "Could not save post. Try again.");
      }
    },
    [signedIn]
  );

  const handleReport = useCallback((postId: string) => {
    Alert.alert(
      "Report post",
      "Why are you reporting this post?",
      [
        { text: "Political content", onPress: () => reportPost(postId, "political") },
        { text: "Nudity / explicit", onPress: () => reportPost(postId, "nudity") },
        { text: "Spam", onPress: () => reportPost(postId, "spam") },
        { text: "Other", onPress: () => reportPost(postId, "other") },
        { text: "Cancel", style: "cancel" },
      ]
    );
  }, []);

  const reportPost = async (postId: string, reason: "political" | "hate" | "nudity" | "spam" | "other") => {
    try {
      const { apiPost } = await import("@/lib/api");
      await apiPost("/api/reports", { contentType: "post", contentId: postId, reason });
      Alert.alert("Report submitted", "Thank you. We will review this post.");
    } catch (e) {
      Alert.alert("Couldn't submit", (e as { error?: string }).error ?? "Try again.");
    }
  };

  const handleBlockUser = useCallback(async (memberId: string, postId: string) => {
    if (authMember?.id === memberId) {
      Alert.alert(
        "Cannot block yourself",
        "Blocking is for other members. It removes their posts from your feed and stops them from messaging you."
      );
      return;
    }
    Alert.alert(
      "Block user",
      "This user will be blocked. Their posts will be removed from your feed and they will not be able to message you.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Block",
          style: "destructive",
          onPress: async () => {
            try {
              const { apiPost } = await import("@/lib/api");
              await apiPost("/api/members/block", { memberId });
              await apiPost("/api/reports", {
                contentType: "post",
                contentId: postId,
                reason: "other",
                details: "User blocked by viewer",
              }).catch(() => {});
              setPosts((prev) => prev.filter((p) => p.author.id !== memberId));
              Alert.alert("User blocked", "They have been blocked and their posts removed from your feed.");
            } catch (e) {
              Alert.alert("Error", (e as { error?: string }).error ?? "Could not block user.");
            }
          },
        },
      ]
    );
  }, [authMember?.id]);

  const handleCommentAdded = useCallback(() => {
    if (!commentPostId) return;
    setPosts((prev) =>
      prev.map((p) =>
        p.id === commentPostId ? { ...p, commentCount: p.commentCount + 1 } : p
      )
    );
  }, [commentPostId]);

  const handleDeletePost = useCallback(
    (postId: string) => {
      Alert.alert(
        "Delete post",
        "Delete this post? This cannot be undone.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => {
              void deletePost(postId)
                .then(() => {
                  setPosts((prev) => prev.filter((p) => p.id !== postId));
                  setCommentPostId((id) => (id === postId ? null : id));
                })
                .catch((e) =>
                  Alert.alert("Error", (e as { error?: string }).error ?? "Could not delete post.")
                );
            },
          },
        ]
      );
    },
    []
  );

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
      </View>
    ),
    [signedIn, pendingIncomingFriendRequests, openCreatePost, router]
  );

  const listEmpty = useMemo(() => {
    if (loading) {
      return (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={styles.loadingText}>Loading feed…</Text>
        </View>
      );
    }
    return (
      <Text style={styles.emptyText}>
        {signedIn
          ? "No posts yet. Follow blog authors, join groups, or share to get started!"
          : "No public posts to show yet."}
      </Text>
    );
  }, [loading, signedIn]);

  const listFooter = useMemo(() => {
    if (!loadingMore) return null;
    return (
      <View style={styles.listFooterLoading}>
        <ActivityIndicator size="small" color={theme.colors.primary} />
      </View>
    );
  }, [loadingMore]);

  const onEndReachedFeed = useCallback(() => {
    if (!nextCursor || loadingMore || loading) return;
    loadMore();
  }, [nextCursor, loadingMore, loading, loadMore]);

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
      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        renderItem={renderPost}
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
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          posts.length === 0 && !loading ? styles.scrollContentEmpty : null,
        ]}
        removeClippedSubviews={Platform.OS === "android"}
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
          onCommentAdded={handleCommentAdded}
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
    backgroundColor: "#fafafa",
  },
  scrollContent: {
    padding: 16,
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
    backgroundColor: theme.colors.primary,
    borderRadius: 6,
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
    backgroundColor: theme.colors.primary,
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
  emptyText: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
    lineHeight: 24,
  },
});
