import { useCallback } from "react";
import { Alert } from "react-native";
import { useRouter } from "expo-router";
import type { QueryKey } from "@tanstack/react-query";
import { apiPost, apiDelete } from "@/lib/api";
import type { FeedPost } from "@/lib/feed-api";
import {
  useLikeMutation,
  useCommentCountIncrement,
  useShareCountUpdate,
  useDeletePostMutation,
  useRemovePostsByAuthor,
} from "./use-feed";

interface UseFeedInteractionsOpts {
  queryKey: QueryKey;
  signedIn: boolean | null;
  authMemberId?: string;
  onCommentOpen?: (postId: string) => void;
  onShareOpen?: (postId: string) => void;
}

export function useFeedInteractions({
  queryKey,
  signedIn,
  authMemberId,
  onCommentOpen,
  onShareOpen,
}: UseFeedInteractionsOpts) {
  const router = useRouter();
  const likeMutation = useLikeMutation(queryKey);
  const incrementCommentCount = useCommentCountIncrement(queryKey);
  const updateShareCount = useShareCountUpdate(queryKey);
  const deletePostMutation = useDeletePostMutation(queryKey);
  const removePostsByAuthor = useRemovePostsByAuthor(queryKey);

  const requireAuth = useCallback(
    (action: string): boolean => {
      if (signedIn) return true;
      Alert.alert("Sign in", `Sign in to ${action}.`, [
        { text: "OK" },
        { text: "Sign in", onPress: () => router.push("/(auth)/login") },
      ]);
      return false;
    },
    [signedIn, router]
  );

  const handleLike = useCallback(
    (postId: string, reaction?: string) => {
      if (!requireAuth("like posts")) return;
      likeMutation.mutate({ postId, reaction });
    },
    [requireAuth, likeMutation]
  );

  const handleComment = useCallback(
    (postId: string) => {
      if (!requireAuth("comment on posts")) return;
      onCommentOpen?.(postId);
    },
    [requireAuth, onCommentOpen]
  );

  const handleShare = useCallback(
    (postId: string) => {
      if (!requireAuth("share posts")) return;
      onShareOpen?.(postId);
    },
    [requireAuth, onShareOpen]
  );

  const handleSave = useCallback(
    async (postId: string) => {
      if (!requireAuth("save posts")) return;
      try {
        await apiPost("/api/saved", { type: "post", referenceId: postId });
        Alert.alert("Saved", "Post saved! View it in your Saved Posts.");
      } catch {
        Alert.alert("Error", "Could not save post. Try again.");
      }
    },
    [requireAuth]
  );

  const handleReport = useCallback((postId: string) => {
    Alert.alert("Report post", "Why are you reporting this post?", [
      {
        text: "Political content",
        onPress: () => doReport(postId, "political"),
      },
      { text: "Nudity / explicit", onPress: () => doReport(postId, "nudity") },
      { text: "Spam", onPress: () => doReport(postId, "spam") },
      { text: "Other", onPress: () => doReport(postId, "other") },
      { text: "Cancel", style: "cancel" },
    ]);
  }, []);

  const doReport = async (
    postId: string,
    reason: "political" | "hate" | "nudity" | "spam" | "other"
  ) => {
    try {
      await apiPost("/api/reports", {
        contentType: "post",
        contentId: postId,
        reason,
      });
      Alert.alert("Report submitted", "Thank you. We will review this post.");
    } catch (e) {
      Alert.alert(
        "Couldn't submit",
        (e as { error?: string }).error ?? "Try again."
      );
    }
  };

  const handleBlockUser = useCallback(
    (memberId: string, postId: string) => {
      if (authMemberId === memberId) {
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
                await apiPost("/api/members/block", { memberId });
                await apiPost("/api/reports", {
                  contentType: "post",
                  contentId: postId,
                  reason: "other",
                  details: "User blocked by viewer",
                }).catch(() => {});
                removePostsByAuthor(memberId);
                Alert.alert(
                  "User blocked",
                  "They have been blocked and their posts removed from your feed."
                );
              } catch (e) {
                Alert.alert(
                  "Error",
                  (e as { error?: string }).error ?? "Could not block user."
                );
              }
            },
          },
        ]
      );
    },
    [authMemberId, removePostsByAuthor]
  );

  const handleDeletePost = useCallback(
    (postId: string) => {
      Alert.alert("Delete post", "Delete this post? This cannot be undone.", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            deletePostMutation.mutate(postId, {
              onError: (e) =>
                Alert.alert(
                  "Error",
                  (e as unknown as { error?: string }).error ??
                    "Could not delete post."
                ),
            });
          },
        },
      ]);
    },
    [deletePostMutation]
  );

  const handleCommentAdded = useCallback(
    (postId: string) => {
      incrementCommentCount(postId);
    },
    [incrementCommentCount]
  );

  const handleSourcePostShared = useCallback(
    (
      sourcePostId: string,
      opts?: { recorded?: boolean; shareCount?: number }
    ) => {
      updateShareCount(sourcePostId, opts);
    },
    [updateShareCount]
  );

  return {
    handleLike,
    handleComment,
    handleShare,
    handleSave,
    handleReport,
    handleBlockUser,
    handleDeletePost,
    handleCommentAdded,
    handleSourcePostShared,
  };
}
