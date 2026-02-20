import { useState, useEffect, useCallback } from "react";
import {
  StyleSheet,
  ScrollView,
  Text,
  View,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Linking,
} from "react-native";
import { useRouter } from "expo-router";
import { theme } from "@/lib/theme";
import { getToken } from "@/lib/api";
import {
  fetchFeed,
  toggleLike,
  type FeedPost,
  EXAMPLE_FEED_POSTS,
} from "@/lib/feed-api";
import { FeedPostCard } from "@/components/FeedPostCard";
import { FeedCommentsModal } from "@/components/FeedCommentsModal";
import { CouponPopup } from "@/components/CouponPopup";
import { CreatePostModal } from "@/components/CreatePostModal";
import { ShareToChatModal } from "@/components/ShareToChatModal";
import { useCreatePost } from "@/contexts/CreatePostContext";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

export default function CommunityScreen() {
  const createPostCtx = useCreatePost();
  const createPostVisible = createPostCtx?.createPostVisible ?? false;
  const setCreatePostVisible = createPostCtx?.setCreatePostVisible ?? (() => {});
  const openCreatePost = createPostCtx?.openCreatePost ?? (() => {});
  const router = useRouter();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [couponPopupId, setCouponPopupId] = useState<string | null>(null);
  const [shareToChatPost, setShareToChatPost] = useState<{ id: string; slug?: string } | null>(null);
  const [commentPostId, setCommentPostId] = useState<string | null>(null);

  const checkAuth = useCallback(() => {
    getToken().then((token) => {
      setSignedIn(!!token);
      if (!token) setLoading(false);
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
        const displayPosts = (p?.length ?? 0) > 0 ? p : EXAMPLE_FEED_POSTS;
        setPosts(displayPosts);
        setNextCursor((p?.length ?? 0) > 0 ? c : null);
      })
      .catch(() => {
        setPosts(EXAMPLE_FEED_POSTS);
        setNextCursor(null);
      })
      .finally(() => setLoading(false));
  }, [loadFeed]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (signedIn) {
      loadInitial();
    }
  }, [signedIn, loadInitial]);

  const onRefresh = useCallback(() => {
    if (!signedIn) return;
    setRefreshing(true);
    loadFeed()
      .then(({ posts: p, nextCursor: c }) => {
        const displayPosts = (p?.length ?? 0) > 0 ? p : EXAMPLE_FEED_POSTS;
        setPosts(displayPosts);
        setNextCursor((p?.length ?? 0) > 0 ? c : null);
      })
      .catch(() => {
        setPosts(EXAMPLE_FEED_POSTS);
        setNextCursor(null);
      })
      .finally(() => setRefreshing(false));
  }, [signedIn, loadFeed]);

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

  const handleLike = useCallback(async (postId: string) => {
    if (postId.startsWith("example-")) {
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? {
                ...p,
                liked: !p.liked,
                likeCount: p.likeCount + (p.liked ? -1 : 1),
              }
            : p
        )
      );
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
  }, []);

  const handleShare = useCallback((postId: string) => {
    if (postId.startsWith("example-")) {
      Alert.alert("Demo", "This is an example post. Share real posts from your feed!");
      return;
    }
    setShareToChatPost({ id: postId });
  }, []);

  const handleComment = useCallback((postId: string) => {
    if (postId.startsWith("example-")) {
      Alert.alert("Demo", "This is an example post. Comment on real posts from your feed!");
      return;
    }
    setCommentPostId(postId);
  }, []);

  const handleSave = useCallback(async (postId: string) => {
    if (postId.startsWith("example-")) return;
    try {
      const { apiPost } = await import("@/lib/api");
      await apiPost("/api/saved", { type: "post", referenceId: postId });
      Alert.alert("Saved", "Post saved! View it in your Saved Posts.");
    } catch {
      Alert.alert("Error", "Could not save post. Try again.");
    }
  }, []);

  const handleReport = useCallback((postId: string) => {
    if (postId.startsWith("example-")) return;
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

  const reportPost = async (postId: string, reason: "political" | "hate" | "nudity" | "other") => {
    try {
      const { apiPost } = await import("@/lib/api");
      await apiPost("/api/reports", { contentType: "post", contentId: postId, reason });
      Alert.alert("Report submitted", "Thank you. We will review this post.");
    } catch (e) {
      Alert.alert("Couldn't submit", (e as { error?: string }).error ?? "Try again.");
    }
  };

  const handleCommentAdded = useCallback(() => {
    if (!commentPostId) return;
    setPosts((prev) =>
      prev.map((p) =>
        p.id === commentPostId ? { ...p, commentCount: p.commentCount + 1 } : p
      )
    );
  }, [commentPostId]);


  const openMyCommunity = () => {
    Linking.openURL(`${siteBase}/my-community`).catch(() => {});
  };

  if (signedIn === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (!signedIn) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Northwest Community Feed</Text>
        <Text style={styles.subtitle}>
          Sign in to see posts from people you follow and groups you've joined.
        </Text>
        <Pressable
          style={({ pressed }) => [
            styles.primaryButton,
            pressed && styles.buttonPressed,
          ]}
          onPress={() => {
            (router.push as (href: string) => void)("/(tabs)/my-community");
          }}
        >
          <Text style={styles.primaryButtonText}>Sign In</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          colors={[theme.colors.primary]}
        />
      }
    >
      <View style={styles.header}>
        <Text style={styles.title}>Northwest Community Feed</Text>
        <Text style={styles.subtitle}>
          Posts from people you follow and groups you've joined.
        </Text>
        <View style={styles.headerBtns}>
          <Pressable
            style={({ pressed }) => [
              styles.createPostBtn,
              pressed && styles.buttonPressed,
            ]}
            onPress={() => openCreatePost()}
          >
            <Text style={styles.createPostBtnText}>Create post</Text>
          </Pressable>
        </View>
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={styles.loadingText}>Loading feed…</Text>
        </View>
      ) : posts.length === 0 ? (
        <Text style={styles.emptyText}>
          No posts yet. Follow blog authors, join groups, or share to get
          started!
        </Text>
      ) : (
        <>
          {posts.map((post) => (
            <FeedPostCard
              key={post.id}
              post={post}
              onLike={handleLike}
              onComment={handleComment}
              onShare={handleShare}
              onReport={handleReport}
              onSave={handleSave}
              onOpenCoupon={(id) => {
              if (id.startsWith("ex-")) {
                Alert.alert("Demo", "This is an example coupon. Browse real coupons in Support Local!");
                return;
              }
              setCouponPopupId(id);
            }}
            />
          ))}
          {nextCursor ? (
            <Pressable
              style={({ pressed }) => [
                styles.loadMoreBtn,
                (loadingMore || pressed) && styles.buttonPressed,
              ]}
              onPress={loadMore}
              disabled={loadingMore}
            >
              {loadingMore ? (
                <ActivityIndicator size="small" color={theme.colors.primary} />
              ) : (
                <Text style={styles.loadMoreBtnText}>Load more</Text>
              )}
            </Pressable>
          ) : null}
        </>
      )}

      {couponPopupId && (
        <CouponPopup
          couponId={couponPopupId}
          onClose={() => setCouponPopupId(null)}
        />
      )}

      <CreatePostModal
        visible={createPostVisible}
        onClose={() => setCreatePostVisible(false)}
        onSuccess={onRefresh}
      />

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
    </ScrollView>
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
  headerBtns: {
    flexDirection: "row",
    gap: 12,
    justifyContent: "center",
    flexWrap: "wrap",
    marginTop: 36,
  },
  createPostBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 6,
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
  loadMoreBtn: {
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 6,
    marginTop: 8,
  },
  loadMoreBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.primary,
  },
});
