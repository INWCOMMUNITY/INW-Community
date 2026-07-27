import { useCallback, useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Alert,
  RefreshControl,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { theme } from "@/lib/theme";
import { apiGet } from "@/lib/api";
import {
  fetchPostById,
  toggleLike,
  deletePost,
  nextShareCountAfterShare,
  type FeedPost,
} from "@/lib/feed-api";
import { FeedPostCard } from "@/components/FeedPostCard";
import { FeedCommentsModal } from "@/components/FeedCommentsModal";
import { ShareToChatModal } from "@/components/ShareToChatModal";
import { useAuth } from "@/contexts/AuthContext";
import { useCreatePost } from "@/contexts/CreatePostContext";

export default function SinglePostScreen() {
  const { id: rawId, commentId: rawCommentId } = useLocalSearchParams<{
    id: string;
    commentId?: string;
  }>();
  const id = typeof rawId === "string" ? rawId : rawId?.[0];
  const commentIdFromUrl =
    typeof rawCommentId === "string" ? rawCommentId : rawCommentId?.[0];
  const router = useRouter();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const { member } = useAuth();
  const createPostMenu = useCreatePost();
  const openEditPost = createPostMenu?.openEditPost;
  const signedIn = !!member;

  const queryKey = ["post", id] as const;

  const {
    data: post,
    isLoading,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey,
    queryFn: () => fetchPostById(id!),
    enabled: !!id,
  });

  const [commentPostId, setCommentPostId] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [viewerManagedBusinessIds, setViewerManagedBusinessIds] = useState<string[]>([]);

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

  useEffect(() => {
    if (post?.author) {
      const name = `${post.author.firstName ?? ""} ${post.author.lastName ?? ""}`.trim();
      navigation.setOptions({ title: name || "Post" });
    }
  }, [post?.author, navigation]);

  useEffect(() => {
    if (post?.id && id && post.id === id && commentIdFromUrl) {
      setCommentPostId(post.id);
    }
  }, [post?.id, id, commentIdFromUrl]);

  const likeMutation = useMutation({
    mutationFn: (postId: string) => toggleLike(postId),
    onMutate: async (postId: string) => {
      await queryClient.cancelQueries({ queryKey });
      const prev = queryClient.getQueryData<FeedPost>(queryKey);
      if (prev && prev.id === postId) {
        queryClient.setQueryData<FeedPost>(queryKey, {
          ...prev,
          liked: !prev.liked,
          likeCount: prev.likeCount + (prev.liked ? -1 : 1),
        });
      }
      return { prev };
    },
    onError: (_err, _postId, context) => {
      if (context?.prev) {
        queryClient.setQueryData(queryKey, context.prev);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const handleLike = useCallback(
    (postId: string) => {
      if (!signedIn) {
        Alert.alert("Sign in", "Sign in to like posts.", [
          { text: "OK" },
          { text: "Sign in", onPress: () => router.push("/(auth)/login") },
        ]);
        return;
      }
      likeMutation.mutate(postId);
    },
    [signedIn, router, likeMutation]
  );

  const deleteMutation = useMutation({
    mutationFn: (postId: string) => deletePost(postId),
    onSuccess: () => router.back(),
    onError: (e) =>
      Alert.alert("Error", (e as unknown as { error?: string }).error ?? "Could not delete post."),
  });

  const handleDeletePost = useCallback((postId: string) => {
    Alert.alert("Delete post", "Delete this post? This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => deleteMutation.mutate(postId),
      },
    ]);
  }, [deleteMutation]);

  const handleSourcePostShared = useCallback(
    (sourcePostId: string, opts?: { recorded?: boolean; shareCount?: number }) => {
      const prev = queryClient.getQueryData<FeedPost>(queryKey);
      if (!prev || prev.id !== sourcePostId) return;
      const next = nextShareCountAfterShare(prev.shareCount, opts);
      if (next == null) return;
      queryClient.setQueryData<FeedPost>(queryKey, { ...prev, shareCount: next });
    },
    [queryClient, queryKey]
  );

  const handleCommentAdded = useCallback(
    (postId: string) => {
      const prev = queryClient.getQueryData<FeedPost>(queryKey);
      if (prev && prev.id === postId) {
        queryClient.setQueryData<FeedPost>(queryKey, {
          ...prev,
          commentCount: prev.commentCount + 1,
        });
      }
    },
    [queryClient, queryKey]
  );

  if (isLoading || !id) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (!post) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>This post is not available.</Text>
      </View>
    );
  }

  return (
    <>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => refetch()}
            colors={[theme.colors.primary]}
          />
        }
      >
        <FeedPostCard
          post={post}
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
          onShare={() => setShareOpen(true)}
          onEditPost={openEditPost}
          onDeletePost={handleDeletePost}
          viewerManagedBusinessIds={
            viewerManagedBusinessIds.length ? viewerManagedBusinessIds : undefined
          }
        />
      </ScrollView>

      {commentPostId === post.id && (
        <FeedCommentsModal
          visible
          postId={commentPostId}
          post={post}
          initialCommentCount={post.commentCount}
          highlightCommentId={commentIdFromUrl ?? null}
          onHighlightConsumed={() => {
            router.setParams({ commentId: undefined } as never);
          }}
          onClose={() => {
            setCommentPostId(null);
            if (commentIdFromUrl) {
              router.setParams({ commentId: undefined } as never);
            }
          }}
          onCommentAdded={() => handleCommentAdded(post.id)}
        />
      )}

      {shareOpen && (
        <ShareToChatModal
          visible={shareOpen}
          onClose={() => setShareOpen(false)}
          sharedContent={{ type: "post", id: post.id }}
          defaultFeedGroupId={post.sourceGroup?.id ?? post.groupId ?? null}
          onSourcePostShared={handleSourcePostShared}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  errorText: { fontSize: 16, color: theme.colors.placeholder, textAlign: "center" },
});
