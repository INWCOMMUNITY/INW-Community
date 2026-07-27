import { useCallback, useEffect, useState, useRef, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  FlatList,
  RefreshControl,
  type ViewToken,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet } from "@/lib/api";
import { fetchBusinessHubBusinessPosts, type FeedPost } from "@/lib/feed-api";
import { useFeedQuery, flattenFeedPages } from "@/hooks/use-feed";
import { useFeedInteractions } from "@/hooks/use-feed-interactions";
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

  const queryKey = useMemo(() => ["business-posts"] as const, []);

  const {
    data,
    isLoading,
    isFetchingNextPage: loadingMore,
    isRefetching,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = useFeedQuery(queryKey, fetchBusinessHubBusinessPosts);

  const posts = useMemo(() => flattenFeedPages(data), [data]);
  const refreshing = isRefetching && !loadingMore;

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

  const {
    handleLike,
    handleComment,
    handleShare,
    handleDeletePost,
    handleCommentAdded,
    handleSourcePostShared,
  } = useFeedInteractions({
    queryKey,
    signedIn,
    authMemberId: member?.id,
    onCommentOpen: setCommentPostId,
    onShareOpen: (postId) => {
      const post = posts.find((p) => p.id === postId);
      if (post) setShareOpen(post);
    },
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

      {isLoading ? (
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
            <RefreshControl refreshing={refreshing} onRefresh={() => refetch()} colors={[theme.colors.primary]} />
          }
          onEndReached={() => {
            if (hasNextPage && !loadingMore) fetchNextPage();
          }}
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
              onComment={handleComment}
              onShare={handleShare}
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
          onCommentAdded={() => handleCommentAdded(commentPostId)}
        />
      )}

      {shareOpen && (
        <ShareToChatModal
          visible
          onClose={() => setShareOpen(null)}
          sharedContent={{ type: "post", id: shareOpen.id }}
          defaultFeedGroupId={shareOpen.sourceGroup?.id ?? shareOpen.groupId ?? null}
          onSourcePostShared={handleSourcePostShared}
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
