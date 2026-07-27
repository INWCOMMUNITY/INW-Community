import { useCallback, useEffect, useState } from "react";
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Pressable,
  Alert,
  type ListRenderItemInfo,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiDelete, apiPost } from "@/lib/api";
import { FeedPostCard } from "@/components/FeedPostCard";
import { FeedCommentsModal } from "@/components/FeedCommentsModal";
import { ShareToChatModal } from "@/components/ShareToChatModal";
import { toggleLike, deletePost, type FeedPost } from "@/lib/feed-api";
import { useCreatePost } from "@/contexts/CreatePostContext";
import { useAuth } from "@/contexts/AuthContext";

interface SavedItem {
  id: string;
  type: string;
  referenceId: string;
  createdAt: string;
}

export default function SavedPostsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { member } = useAuth();
  const openEditPost = useCreatePost()?.openEditPost;
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [viewerManagedBusinessIds, setViewerManagedBusinessIds] = useState<string[]>([]);
  const [commentPostId, setCommentPostId] = useState<string | null>(null);
  const [shareToChatPost, setShareToChatPost] = useState<{ id: string; slug?: string } | null>(null);

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

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const saved = await apiGet<SavedItem[]>("/api/saved?type=post");
      if (!saved.length) {
        setPosts([]);
        return;
      }
      const ids = saved.map((s) => s.referenceId);
      const result = await apiGet<{ posts: FeedPost[] }>(`/api/posts/batch?ids=${ids.join(",")}`);
      setPosts(Array.isArray(result?.posts) ? result.posts : []);
    } catch {
      setPosts([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleLike = useCallback(async (postId: string) => {
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
      Alert.alert("Error", "Could not like post.");
    }
  }, []);

  const handleComment = useCallback((postId: string) => {
    setCommentPostId(postId);
  }, []);

  const handleShare = useCallback((postId: string) => {
    setShareToChatPost({ id: postId });
  }, []);

  const handleUnsave = async (postId: string) => {
    await apiDelete(`/api/saved?type=post&referenceId=${encodeURIComponent(postId)}`);
    setPosts((prev) => prev.filter((p) => p.id !== postId));
  };

  const handleReport = (postId: string) => {
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
  };
  const reportPost = async (postId: string, reason: "political" | "hate" | "nudity" | "spam" | "other") => {
    try {
      await apiPost("/api/reports", { contentType: "post", contentId: postId, reason });
      Alert.alert("Report submitted", "Thank you. We will review this post.");
    } catch (e) {
      Alert.alert("Couldn't submit", (e as { error?: string }).error ?? "Try again.");
    }
  };

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
              void apiDelete(`/api/saved?type=post&referenceId=${encodeURIComponent(postId)}`).catch(() => {});
            })
            .catch((e) =>
              Alert.alert("Error", (e as { error?: string }).error ?? "Could not delete post.")
            );
        },
      },
    ]);
  }, []);

  const handleBlockUser = async (memberId: string, postId: string) => {
    Alert.alert(
      "Block user",
      "This user will be blocked. Their posts will be removed from your feed.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Block",
          style: "destructive",
          onPress: async () => {
            try {
              await apiPost("/api/members/block", { memberId });
              await apiPost("/api/reports", { contentType: "post", contentId: postId, reason: "other", details: "User blocked by viewer" }).catch(() => {});
              setPosts((prev) => prev.filter((p) => p.author.id !== memberId));
              Alert.alert("User blocked", "They have been blocked.");
            } catch (e) {
              Alert.alert("Error", (e as { error?: string }).error ?? "Could not block user.");
            }
          },
        },
      ]
    );
  };

  const handleCommentAdded = useCallback((postId: string) => {
    setPosts((prev) =>
      prev.map((p) =>
        p.id === postId ? { ...p, commentCount: p.commentCount + 1 } : p
      )
    );
  }, []);

  const renderPost = useCallback(
    ({ item }: ListRenderItemInfo<FeedPost>) => (
      <FeedPostCard
        post={item}
        onLike={handleLike}
        onComment={handleComment}
        onShare={handleShare}
        onReport={handleReport}
        onBlockUser={handleBlockUser}
        onSave={() => handleUnsave(item.id)}
        onEditPost={openEditPost}
        onDeletePost={handleDeletePost}
        viewerManagedBusinessIds={
          viewerManagedBusinessIds.length ? viewerManagedBusinessIds : undefined
        }
      />
    ),
    [handleLike, handleComment, handleShare, handleDeletePost, openEditPost, viewerManagedBusinessIds]
  );

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <View style={styles.headerTitleRow}>
          <Ionicons name="bookmark" size={18} color="#fff" />
          <Text style={styles.headerTitle}>Saved Posts</Text>
        </View>
        <View style={{ width: 32 }} />
      </View>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : (
        <FlatList
          data={posts}
          keyExtractor={(item) => item.id}
          renderItem={renderPost}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              colors={[theme.colors.primary]}
            />
          }
          ListEmptyComponent={
            <Text style={styles.empty}>No saved posts yet. Use the 3-dot menu on posts to save them.</Text>
          }
          windowSize={7}
          maxToRenderPerBatch={5}
          initialNumToRender={4}
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

      {shareToChatPost && (
        <ShareToChatModal
          visible={!!shareToChatPost}
          onClose={() => setShareToChatPost(null)}
          sharedContent={{ type: "post", id: shareToChatPost.id, slug: shareToChatPost.slug }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: theme.colors.primary,
    borderBottomWidth: 2,
    borderBottomColor: "#000",
  },
  backBtn: { padding: 4 },
  headerTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#fff",
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scrollContent: { padding: 16, paddingBottom: 48 },
  empty: {
    fontSize: 16,
    color: "#999",
    textAlign: "center",
    marginTop: 48,
  },
});
