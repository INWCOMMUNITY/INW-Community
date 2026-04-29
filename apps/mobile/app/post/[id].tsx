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
import { theme } from "@/lib/theme";
import { apiGet } from "@/lib/api";
import {
  fetchPostById,
  toggleLike,
  deletePost,
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
  const { member } = useAuth();
  const createPostMenu = useCreatePost();
  const openEditPost = createPostMenu?.openEditPost;
  const signedIn = !!member;
  const [post, setPost] = useState<FeedPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
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

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const p = await fetchPostById(id);
      setPost(p);
      if (p?.author) {
        const name = `${p.author.firstName ?? ""} ${p.author.lastName ?? ""}`.trim();
        navigation.setOptions({ title: name || "Post" });
      }
    } catch {
      setPost(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id, navigation]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (post?.id && id && post.id === id && commentIdFromUrl) {
      setCommentPostId(post.id);
    }
  }, [post?.id, id, commentIdFromUrl]);

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
        setPost((prev) =>
          prev && prev.id === postId
            ? { ...prev, liked, likeCount: prev.likeCount + (liked ? 1 : -1) }
            : prev
        );
      } catch (_) {}
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
            .then(() => router.back())
            .catch((e) =>
              Alert.alert("Error", (e as { error?: string }).error ?? "Could not delete post.")
            );
        },
      },
    ]);
  }, [router]);

  if (loading || !id) {
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
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
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
          onCommentAdded={() =>
            setPost((p) =>
              p && p.id === commentPostId
                ? { ...p, commentCount: p.commentCount + 1 }
                : p
            )
          }
        />
      )}

      {shareOpen && (
        <ShareToChatModal
          visible={shareOpen}
          onClose={() => setShareOpen(false)}
          sharedContent={{ type: "post", id: post.id }}
          defaultFeedGroupId={post.sourceGroup?.id ?? post.groupId ?? null}
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
