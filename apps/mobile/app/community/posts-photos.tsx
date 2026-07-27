import { useState, useCallback, useEffect, useMemo } from "react";
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useRouter } from "expo-router";
import { theme } from "@/lib/theme";
import { getToken, apiGet } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useCreatePost } from "@/contexts/CreatePostContext";
import { fetchMyPosts, type FeedPost } from "@/lib/feed-api";
import { useFeedQuery, flattenFeedPages } from "@/hooks/use-feed";
import { useFeedInteractions } from "@/hooks/use-feed-interactions";
import { FeedPostCard } from "@/components/FeedPostCard";
import { FeedCommentsModal } from "@/components/FeedCommentsModal";
import { CouponPopup } from "@/components/CouponPopup";
import { ShareToChatModal } from "@/components/ShareToChatModal";

export default function PostsAndPhotosScreen() {
  const router = useRouter();
  const { member: authMember } = useAuth();
  const createPostMenu = useCreatePost();
  const openCreatePost = createPostMenu?.openCreatePost ?? (() => {});
  const openEditPost = createPostMenu?.openEditPost;

  const signedIn = !!authMember;
  const queryKey = useMemo(() => ["my-posts"] as const, []);

  const {
    data,
    isLoading,
    isFetchingNextPage: loadingMore,
    isRefetching,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = useFeedQuery(queryKey, fetchMyPosts, { enabled: signedIn });

  const posts = useMemo(() => flattenFeedPages(data), [data]);
  const refreshing = isRefetching && !loadingMore;

  const [couponPopupId, setCouponPopupId] = useState<string | null>(null);
  const [shareToChatPost, setShareToChatPost] = useState<{ id: string; slug?: string } | null>(null);
  const [commentPostId, setCommentPostId] = useState<string | null>(null);
  const [viewerManagedBusinessIds, setViewerManagedBusinessIds] = useState<string[]>([]);

  const {
    handleLike,
    handleComment,
    handleShare,
    handleSave,
    handleDeletePost,
    handleCommentAdded,
    handleSourcePostShared,
  } = useFeedInteractions({
    queryKey,
    signedIn,
    authMemberId: authMember?.id,
    onCommentOpen: setCommentPostId,
    onShareOpen: (postId) => setShareToChatPost({ id: postId }),
  });

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

  if (!signedIn) {
    return (
      <View style={styles.gateWrap}>
        <Text style={styles.gateTitle}>Posted Photos / Posts</Text>
        <Text style={styles.gateText}>Sign in to see and manage your posts.</Text>
        <Pressable
          style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
          onPress={() => router.push("/(auth)/login")}
        >
          <Text style={styles.ctaText}>Sign in</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => refetch()}
            colors={[theme.colors.primary]}
          />
        }
      >
        <View style={styles.header}>
          <Text style={styles.title}>Posted Photos / Posts</Text>
          <Text style={styles.subtitle}>
            Your community posts in one place. Edit or delete from the menu on each card.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.createBtn, pressed && styles.createBtnPressed]}
            onPress={() => openCreatePost()}
          >
            <Text style={styles.createBtnText}>Create post</Text>
          </Pressable>
        </View>

        {isLoading && posts.length === 0 ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
            <Text style={styles.loadingText}>Loading your posts…</Text>
          </View>
        ) : posts.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Text style={styles.empty}>No posts yet. Share an update or photos to see them here.</Text>
            <Pressable
              style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
              onPress={() => openCreatePost()}
            >
              <Text style={styles.ctaText}>Create a post</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {posts.map((post) => (
              <FeedPostCard
                key={post.id}
                post={post}
                onLike={handleLike}
                onComment={handleComment}
                onShare={handleShare}
                onSave={handleSave}
                onEditPost={openEditPost}
                onDeletePost={handleDeletePost}
                viewerManagedBusinessIds={
                  viewerManagedBusinessIds.length ? viewerManagedBusinessIds : undefined
                }
                onOpenCoupon={(id) => setCouponPopupId(id)}
              />
            ))}
            {hasNextPage ? (
              <Pressable
                style={({ pressed }) => [
                  styles.loadMoreBtn,
                  (loadingMore || pressed) && styles.loadMoreBtnPressed,
                ]}
                onPress={() => fetchNextPage()}
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
      </ScrollView>

      {couponPopupId && (
        <CouponPopup couponId={couponPopupId} onClose={() => setCouponPopupId(null)} />
      )}

      {shareToChatPost && (
        <ShareToChatModal
          visible={!!shareToChatPost}
          onClose={() => setShareToChatPost(null)}
          sharedContent={{
            type: "post",
            id: shareToChatPost.id,
            slug: shareToChatPost.slug,
          }}
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
  scroll: { flex: 1, backgroundColor: "#fafafa" },
  scrollContent: { padding: 16, paddingBottom: 40 },
  header: { marginBottom: 16 },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: theme.colors.heading,
    marginBottom: 6,
    fontFamily: theme.fonts.heading,
  },
  subtitle: { fontSize: 14, color: "#666", marginBottom: 12 },
  createBtn: {
    alignSelf: "flex-start",
    backgroundColor: theme.colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 8,
  },
  createBtnPressed: { opacity: 0.88 },
  createBtnText: { fontSize: 15, fontWeight: "600", color: "#fff" },
  center: { paddingVertical: 48, alignItems: "center" },
  loadingText: { marginTop: 12, fontSize: 14, color: "#666" },
  emptyWrap: { paddingVertical: 32, paddingHorizontal: 8, alignItems: "center" },
  empty: { fontSize: 15, color: "#888", textAlign: "center", marginBottom: 20 },
  gateWrap: {
    flex: 1,
    backgroundColor: "#fff",
    padding: 24,
    justifyContent: "center",
    alignItems: "center",
  },
  gateTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: theme.colors.heading,
    marginBottom: 8,
    textAlign: "center",
  },
  gateText: { fontSize: 15, color: "#666", textAlign: "center", marginBottom: 20 },
  cta: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  ctaPressed: { opacity: 0.88 },
  ctaText: { fontSize: 16, fontWeight: "600", color: "#fff" },
  loadMoreBtn: {
    marginTop: 8,
    marginBottom: 16,
    paddingVertical: 14,
    alignItems: "center",
    borderRadius: 8,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  loadMoreBtnPressed: { opacity: 0.85 },
  loadMoreBtnText: { fontSize: 15, fontWeight: "600", color: theme.colors.primary },
});
