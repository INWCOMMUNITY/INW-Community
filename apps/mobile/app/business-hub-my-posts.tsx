import { useCallback, useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  FlatList,
  RefreshControl,
  Alert,
  type ViewToken,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet } from "@/lib/api";
import {
  fetchBusinessHubBusinessPosts,
  toggleLike,
  deletePost,
  type FeedPost,
} from "@/lib/feed-api";
import { FeedPostCard } from "@/components/FeedPostCard";
import { FeedCommentsModal } from "@/components/FeedCommentsModal";
import { ShareToChatModal } from "@/components/ShareToChatModal";
import { useAuth } from "@/contexts/AuthContext";
import { useCreatePost } from "@/contexts/CreatePostContext";

export default function BusinessHubMyPostsScreen() {
  const router = useRouter();
  const { member } = useAuth();
  const createPostMenu = useCreatePost();
  const openEditPost = createPostMenu?.openEditPost;
  const signedIn = !!member;
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [commentPostId, setCommentPostId] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState<FeedPost | null>(null);
  const [viewerManagedBusinessIds, setViewerManagedBusinessIds] = useState<string[]>([]);
  const [hubFeedVisibleIds, setHubFeedVisibleIds] = useState<Set<string>>(new Set());
  const [hubFeedViewabilityReady, setHubFeedViewabilityReady] = useState(false);
  const hubFeedViewabilityConfig = useRef({
    itemVisiblePercentThreshold: 40,
    minimumViewTime: 100,
  }).current;

  const onHubFeedViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const next = new Set<string>();
      for (const v of viewableItems) {
        if (v.isViewable && v.item && typeof (v.item as FeedPost).id === "string") {
          next.add((v.item as FeedPost).id);
        }
      }
      setHubFeedVisibleIds(next);
      setHubFeedViewabilityReady(true);
    },
    []
  );

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

  const load = useCallback(async (cursor?: string) => {
    const { posts: p, nextCursor: c } = await fetchBusinessHubBusinessPosts(cursor);
    return { posts: p ?? [], nextCursor: c };
  }, []);

  const loadInitial = useCallback(() => {
    setLoading(true);
    load()
      .then(({ posts: p, nextCursor: c }) => {
        setPosts(p);
        setNextCursor(c);
      })
      .catch(() => {
        setPosts([]);
        setNextCursor(null);
      })
      .finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load()
      .then(({ posts: p, nextCursor: c }) => {
        setPosts(p);
        setNextCursor(c);
      })
      .finally(() => setRefreshing(false));
  }, [load]);

  const loadMore = useCallback(() => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    load(nextCursor)
      .then(({ posts: more, nextCursor: c }) => {
        setPosts((prev) => [...prev, ...more]);
        setNextCursor(c);
      })
      .finally(() => setLoadingMore(false));
  }, [nextCursor, loadingMore, load]);

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
              ? { ...p, liked, likeCount: p.likeCount + (liked ? 1 : -1) }
              : p
          )
        );
      } catch {
        /* ignore */
      }
    },
    [signedIn, router]
  );

  const handleDeletePost = useCallback((postId: string) => {
    Alert.alert("Delete post", "Delete this post? This cannot be undone.", [
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
    ]);
  }, []);

  const commentPost = posts.find((p) => p.id === commentPostId) ?? null;

  return (
    <View style={styles.container}>
      <Pressable style={styles.backRow} onPress={() => router.back()}>
        <Ionicons name="arrow-back" size={24} color={theme.colors.primary} />
        <Text style={styles.backText}>Back</Text>
      </Pressable>
      <Text style={styles.title}>My Business Posts</Text>
      <Text style={styles.subtitle}>
        Posts you published as your business. Open the menu on a post to edit or delete.
      </Text>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : (
        <FlatList
          data={posts}
          keyExtractor={(item) => item.id}
          viewabilityConfig={hubFeedViewabilityConfig}
          onViewableItemsChanged={onHubFeedViewableItemsChanged}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[theme.colors.primary]} />
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.35}
          ListEmptyComponent={
            <Text style={styles.empty}>
              No business posts yet. Create one from Business Hub (Create Post).
            </Text>
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator style={styles.footerSpinner} color={theme.colors.primary} />
            ) : null
          }
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <FeedPostCard
              post={item}
              isFeedCardVisible={
                !hubFeedViewabilityReady ? false : hubFeedVisibleIds.has(item.id)
              }
              onLike={handleLike}
              onComment={(pid) => {
                if (!signedIn) {
                  Alert.alert("Sign in", "Sign in to comment.", [
                    { text: "OK" },
                    { text: "Sign in", onPress: () => router.push("/(auth)/login") },
                  ]);
                  return;
                }
                setCommentPostId(pid);
              }}
              onShare={() => setShareOpen(item)}
              onEditPost={openEditPost}
              onDeletePost={handleDeletePost}
              viewerManagedBusinessIds={
                viewerManagedBusinessIds.length ? viewerManagedBusinessIds : undefined
              }
            />
          )}
        />
      )}

      {commentPost && commentPostId === commentPost.id && (
        <FeedCommentsModal
          visible
          postId={commentPostId}
          post={commentPost}
          initialCommentCount={commentPost.commentCount}
          onClose={() => setCommentPostId(null)}
          onCommentAdded={() =>
            setPosts((prev) =>
              prev.map((p) =>
                p.id === commentPostId ? { ...p, commentCount: p.commentCount + 1 } : p
              )
            )
          }
        />
      )}

      {shareOpen && (
        <ShareToChatModal
          visible
          onClose={() => setShareOpen(null)}
          sharedContent={{ type: "post", id: shareOpen.id }}
          defaultFeedGroupId={shareOpen.sourceGroup?.id ?? shareOpen.groupId ?? null}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff", paddingHorizontal: 16 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  backRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 48,
    marginBottom: 8,
    gap: 8,
  },
  backText: { fontSize: 16, color: theme.colors.primary, fontWeight: "600" },
  title: { fontSize: 22, fontWeight: "700", color: theme.colors.heading, marginBottom: 6 },
  subtitle: { fontSize: 14, color: "#666", marginBottom: 12 },
  listContent: { paddingBottom: 40 },
  empty: { fontSize: 15, color: "#888", textAlign: "center", marginTop: 24, paddingHorizontal: 16 },
  footerSpinner: { marginVertical: 16 },
});
