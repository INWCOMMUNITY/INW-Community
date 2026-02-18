import { useEffect, useState, useRef } from "react";
import {
  Modal,
  StyleSheet,
  View,
  Text,
  Pressable,
  ScrollView,
  Image,
  ActivityIndicator,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Dimensions,
  Alert,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { fetchComments, createComment, likeComment, type FeedComment } from "@/lib/feed-api";
import type { FeedPost } from "@/lib/feed-api";
import { apiPost, apiUploadFile, getToken } from "@/lib/api";
import { GifPickerModal } from "@/components/GifPickerModal";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");
const resolveUri = (u: string) =>
  u.startsWith("http") ? u : `${siteBase}${u.startsWith("/") ? "" : "/"}${u}`;

function toFullUrl(url: string): string {
  return url.startsWith("http") ? url : `${siteBase}${url.startsWith("/") ? "" : "/"}${url}`;
}

const { height: SCREEN_HEIGHT } = Dimensions.get("window");
const SHEET_HEIGHT = Math.min(SCREEN_HEIGHT * 0.85, 600);

interface FeedCommentsModalProps {
  visible: boolean;
  postId: string;
  post?: FeedPost | null;
  initialCommentCount?: number;
  onClose: () => void;
  onCommentAdded?: () => void;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

function PostPreview({ post }: { post: FeedPost }) {
  const authorName = `${post.author.firstName ?? ""} ${post.author.lastName ?? ""}`.trim() || "Someone";
  const initials = [post.author.firstName?.[0], post.author.lastName?.[0]]
    .filter(Boolean)
    .join("")
    .toUpperCase() || "?";

  const previewText =
    post.type === "shared_blog" && post.sourceBlog
      ? post.sourceBlog.title ?? stripHtml(post.sourceBlog.body ?? "").slice(0, 80)
      : post.type === "shared_business" && post.sourceBusiness
        ? post.sourceBusiness.name
        : post.type === "shared_coupon" && post.sourceCoupon
          ? post.sourceCoupon.name
          : post.type === "shared_reward" && post.sourceReward
            ? post.sourceReward.title
            : post.type === "shared_store_item" && post.sourceStoreItem
              ? post.sourceStoreItem.title
              : post.content?.trim() ?? "Shared a post";
  const previewImg =
    post.photos?.[0] ??
    (post.type === "shared_blog" && post.sourceBlog?.photos?.[0]) ??
    (post.type === "shared_business" && post.sourceBusiness?.logoUrl) ??
    (post.type === "shared_store_item" && post.sourceStoreItem?.photos?.[0]);

  return (
    <View style={styles.postPreview}>
      {post.author.profilePhotoUrl ? (
        <Image
          source={{ uri: resolveUri(post.author.profilePhotoUrl) }}
          style={styles.previewAvatar}
        />
      ) : (
        <View style={styles.previewAvatarPlaceholder}>
          <Text style={styles.previewAvatarInitials}>{initials}</Text>
        </View>
      )}
      <View style={styles.previewContent}>
        <Text style={styles.previewAuthor}>{authorName}</Text>
        <Text style={styles.previewText} numberOfLines={2}>
          {stripHtml(previewText).slice(0, 100)}
          {previewText.length > 100 ? "…" : ""}
        </Text>
      </View>
      {previewImg ? (
        <Image
          source={{ uri: resolveUri(previewImg) }}
          style={styles.previewThumb}
          resizeMode="cover"
        />
      ) : null}
    </View>
  );
}

interface CommentRowProps {
  comment: FeedComment;
  isReply?: boolean;
  postId: string;
  onLike: (commentId: string) => void;
  onReply: (comment: FeedComment) => void;
  onReportComment?: (commentId: string) => void;
}

function CommentRow({ comment, isReply, postId, onLike, onReply, onReportComment }: CommentRowProps) {
  const name = `${comment.member.firstName ?? ""} ${comment.member.lastName ?? ""}`.trim() || "Member";
  const initials = [comment.member.firstName?.[0], comment.member.lastName?.[0]]
    .filter(Boolean)
    .join("")
    .toUpperCase() || "?";
  const photos = comment.photos ?? [];
  const likeCount = comment.likeCount ?? 0;
  const liked = comment.liked ?? false;

  return (
    <View style={[styles.commentRow, isReply && styles.commentRowReply]}>
      {comment.member.profilePhotoUrl ? (
        <Image
          source={{ uri: resolveUri(comment.member.profilePhotoUrl) }}
          style={styles.commentAvatar}
        />
      ) : (
        <View style={styles.commentAvatarPlaceholder}>
          <Text style={styles.commentAvatarInitials}>{initials}</Text>
        </View>
      )}
      <View style={styles.commentContent}>
        <View style={styles.commentMain}>
          <Text style={styles.commentAuthor}>
            {name}
            {comment.parentAuthorName ? (
              <Text style={styles.commentReplyTo}> replying to {comment.parentAuthorName}</Text>
            ) : null}
          </Text>
          {comment.content.trim() ? (
            <Text style={styles.commentBody}>{comment.content}</Text>
          ) : null}
          {photos.length > 0 ? (
            <View style={styles.commentPhotos}>
              {photos.map((url, i) => (
                <Image
                  key={i}
                  source={{ uri: resolveUri(url) }}
                  style={styles.commentPhoto}
                  resizeMode="cover"
                />
              ))}
            </View>
          ) : null}
          <View style={styles.commentActions}>
            <Text style={styles.commentDate}>
              {new Date(comment.createdAt).toLocaleDateString()}
            </Text>
            <Pressable
              onPress={() => onReply(comment)}
              style={({ pressed }) => [styles.commentActionBtn, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.commentActionText}>Reply</Text>
            </Pressable>
            {onReportComment && (
              <Pressable
                onPress={() => onReportComment(comment.id)}
                style={({ pressed }) => [styles.commentActionBtn, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.commentActionText}>Report</Text>
              </Pressable>
            )}
          </View>
        </View>
        <View style={styles.commentLikeWrap}>
          <Pressable
            onPress={() => onLike(comment.id)}
            style={({ pressed }) => [styles.commentActionBtn, pressed && { opacity: 0.7 }]}
          >
            <Ionicons
              name={liked ? "heart" : "heart-outline"}
              size={14}
              color={liked ? theme.colors.primary : "#666"}
            />
            {likeCount > 0 && (
              <Text style={[styles.commentActionText, liked && styles.commentActionTextActive]}>
                {" "}{likeCount}
              </Text>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export function FeedCommentsModal({
  visible,
  postId,
  post,
  onClose,
  onCommentAdded,
}: FeedCommentsModalProps) {
  const [comments, setComments] = useState<FeedComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  const [replyingTo, setReplyingTo] = useState<{ id: string; authorName: string } | null>(null);
  const [isDemoPost, setIsDemoPost] = useState(false);
  const slideAnim = useRef(new Animated.Value(SHEET_HEIGHT)).current;

  useEffect(() => {
    if (!visible || !postId) return;
    setComments([]);
    setInput("");
    setPhotos([]);
    setReplyingTo(null);
    const demo = postId.startsWith("example-");
    setIsDemoPost(demo);
    setLoading(true);
    slideAnim.setValue(SHEET_HEIGHT);
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 65,
      friction: 11,
    }).start();
    if (demo) {
      setLoading(false);
      return;
    }
    fetchComments(postId)
      .then(({ comments: c }) => setComments(c ?? []))
      .catch(() => setComments([]))
      .finally(() => setLoading(false));
  }, [visible, postId]);

  const handleClose = () => {
    Animated.timing(slideAnim, {
      toValue: SHEET_HEIGHT,
      duration: 200,
      useNativeDriver: true,
    }).start(() => onClose());
  };

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow access to photos and GIFs.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      quality: 0.8,
    });
    if (result.canceled) return;
    if (photos.length + result.assets.length > 6) {
      Alert.alert("Limit", "You can add up to 6 photos or GIFs per comment.");
      return;
    }
    setUploadingPhoto(true);
    try {
      const token = await getToken();
      if (!token) {
        Alert.alert("Sign in required", "Sign in to share photos.");
        return;
      }
      for (const asset of result.assets) {
        const formData = new FormData();
        formData.append("file", {
          uri: asset.uri,
          type: asset.mimeType ?? "image/jpeg",
          name: asset.uri.endsWith(".gif") ? "photo.gif" : "photo.jpg",
        } as unknown as Blob);
        formData.append("type", "image");
        const { url } = await apiUploadFile("/api/upload/post", formData);
        const fullUrl = toFullUrl(url);
        if (!photos.includes(fullUrl)) {
          setPhotos((p) => (p.length >= 6 ? p : [...p, fullUrl]));
        }
      }
    } catch {
      Alert.alert("Error", "Photo upload failed. Try again.");
    } finally {
      setUploadingPhoto(false);
    }
  };

  const removePhoto = (index: number) => {
    setPhotos((p) => p.filter((_, i) => i !== index));
  };

  const handleGifSelect = (gifUrl: string) => {
    if (photos.length >= 6) return;
    setPhotos((p) => [...p, gifUrl]);
  };

  const handleSubmit = async () => {
    if (isDemoPost) {
      Alert.alert(
        "Demo post",
        "This is a sample post. Sign in and refresh to see real posts you can comment on."
      );
      return;
    }
    const text = input.trim();
    const hasContent = text.length > 0 || photos.length > 0;
    if (!hasContent || submitting) return;
    setSubmitting(true);
    const parentId = replyingTo?.id ?? undefined;
    try {
      const newComment = await createComment(postId, text || " ", photos, parentId);
      setComments((prev) => [...prev, newComment]);
      setInput("");
      setPhotos([]);
      setReplyingTo(null);
      onCommentAdded?.();
    } catch (e) {
      const err = e as { error?: string; status?: number };
      Alert.alert("Couldn't post comment", err?.error ?? "Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleLike = async (commentId: string) => {
    try {
      const { liked } = await likeComment(postId, commentId);
      setComments((prev) =>
        prev.map((c) =>
          c.id === commentId
            ? {
                ...c,
                liked,
                likeCount: (c.likeCount ?? 0) + (liked ? 1 : -1),
              }
            : c
        )
      );
    } catch {
      // Toggle failed, leave UI as-is
    }
  };

  const handleReply = (comment: FeedComment) => {
    const authorName =
      `${comment.member.firstName ?? ""} ${comment.member.lastName ?? ""}`.trim() || "Member";
    setReplyingTo({ id: comment.id, authorName });
  };

  const reportOptions = [
    { text: "Political content", reason: "political" as const },
    { text: "Hate speech", reason: "hate" as const },
    { text: "Nudity / explicit", reason: "nudity" as const },
    { text: "Other", reason: "other" as const },
  ];
  const handleReportComment = (commentId: string) => {
    Alert.alert(
      "Report comment",
      "Why are you reporting this comment?",
      [
        ...reportOptions.map((o) => ({
          text: o.text,
          onPress: () =>
            apiPost("/api/reports", {
              contentType: "comment",
              contentId: commentId,
              reason: o.reason,
            }).then(() => Alert.alert("Report submitted", "Thank you.")).catch((e) =>
              Alert.alert("Couldn't submit", (e as { error?: string }).error ?? "Try again.")
            ),
        })),
        { text: "Cancel", style: "cancel" },
      ]
    );
  };
  const handleReportPost = () => {
    Alert.alert(
      "Report post",
      "Why are you reporting this post?",
      [
        ...reportOptions.map((o) => ({
          text: o.text,
          onPress: () =>
            apiPost("/api/reports", {
              contentType: "post",
              contentId: postId,
              reason: o.reason,
            }).then(() => Alert.alert("Report submitted", "Thank you.")).catch((e) =>
              Alert.alert("Couldn't submit", (e as { error?: string }).error ?? "Try again.")
            ),
        })),
        { text: "Cancel", style: "cancel" },
      ]
    );
  };

  const canSubmit = (input.trim().length > 0 || photos.length > 0) && !submitting;

  // Build tree: top-level comments + nested replies
  const topLevel = comments.filter((c) => !c.parentId);
  const getReplies = (id: string) => comments.filter((c) => c.parentId === id);

  if (!visible) return null;

  return (
    <>
    <Modal
      visible={visible && !gifPickerOpen}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
        <Pressable style={styles.backdrop} onPress={handleClose} />
        <Animated.View
          style={[
            styles.sheet,
            { height: SHEET_HEIGHT, transform: [{ translateY: slideAnim }] },
          ]}
        >
          <View style={styles.header}>
            <Text style={styles.headerTitle}>
              Comments {comments.length > 0 ? `(${comments.length})` : ""}
            </Text>
            <View style={styles.headerActions}>
              {!isDemoPost && (
                <Pressable
                  onPress={handleReportPost}
                  style={({ pressed }) => [styles.reportBtn, pressed && { opacity: 0.7 }]}
                >
                  <Text style={styles.reportBtnText}>Report post</Text>
                </Pressable>
              )}
              <Pressable
                onPress={handleClose}
                style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.7 }]}
              >
                <Ionicons name="close" size={24} color={theme.colors.heading} />
              </Pressable>
            </View>
          </View>
          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator size="large" color={theme.colors.primary} />
            </View>
          ) : (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
            >
              {post && <PostPreview post={post} />}
              {isDemoPost && (
                <View style={styles.demoBanner}>
                  <Ionicons name="information-circle" size={20} color={theme.colors.primary} />
                  <Text style={styles.demoBannerText}>
                    This is a sample post. Sign in and refresh to see real posts you can comment on.
                  </Text>
                </View>
              )}
              <View style={styles.commentsSection}>
                <Text style={styles.commentsLabel}>
                  {isDemoPost
                    ? "Demo comments"
                    : comments.length === 0
                      ? "No comments yet. Be the first!"
                      : "Comments"}
                </Text>
                {topLevel.map((c) => (
                  <View key={c.id}>
                    <CommentRow
                      comment={c}
                      postId={postId}
                      onLike={handleLike}
                      onReply={handleReply}
                      onReportComment={isDemoPost ? undefined : handleReportComment}
                    />
                    {getReplies(c.id).map((r) => (
                      <CommentRow
                        key={r.id}
                        comment={r}
                        isReply
                        postId={postId}
                        onLike={handleLike}
                        onReply={handleReply}
                        onReportComment={isDemoPost ? undefined : handleReportComment}
                      />
                    ))}
                  </View>
                ))}
              </View>
            </ScrollView>
          )}
          <View style={[styles.inputSection, isDemoPost && styles.inputSectionDisabled]}>
            {replyingTo && (
              <View style={styles.replyingToBar}>
                <Text style={styles.replyingToText}>
                  Replying to {replyingTo.authorName}
                </Text>
                <Pressable
                  onPress={() => setReplyingTo(null)}
                  style={({ pressed }) => [styles.replyingToCancel, pressed && { opacity: 0.7 }]}
                >
                  <Ionicons name="close" size={16} color="#666" />
                </Pressable>
              </View>
            )}
            {photos.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.photosScroll}
                contentContainerStyle={styles.photosScrollContent}
              >
                {photos.map((url, i) => (
                  <View key={i} style={styles.photoThumbWrap}>
                    <Image
                      source={{ uri: resolveUri(url) }}
                      style={styles.photoThumb}
                      resizeMode="cover"
                    />
                    <Pressable
                      style={styles.photoRemove}
                      onPress={() => removePhoto(i)}
                    >
                      <Ionicons name="close-circle" size={22} color="#fff" />
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            )}
            <View style={styles.inputRow}>
              <Pressable
                onPress={pickImage}
                disabled={uploadingPhoto || photos.length >= 6}
                style={({ pressed }) => [
                  styles.attachBtn,
                  (uploadingPhoto || photos.length >= 6 || pressed) && styles.attachBtnDisabled,
                ]}
              >
                {uploadingPhoto ? (
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                ) : (
                  <Ionicons name="image-outline" size={22} color={theme.colors.primary} />
                )}
              </Pressable>
              <Pressable
                onPress={() => setGifPickerOpen(true)}
                disabled={photos.length >= 6}
                style={({ pressed }) => [
                  styles.attachBtn,
                  (photos.length >= 6 || pressed) && styles.attachBtnDisabled,
                ]}
              >
                <Text style={styles.gifBtnText}>GIF</Text>
              </Pressable>
              <TextInput
                style={styles.input}
                placeholder={
                  isDemoPost
                    ? "Demo post – sign in for real posts"
                    : replyingTo
                      ? `Reply to ${replyingTo.authorName}… (text optional)`
                      : "Add a comment, or just a photo or GIF…"
                }
                placeholderTextColor={theme.colors.placeholder}
                value={input}
                onChangeText={setInput}
                multiline
                maxLength={2000}
                editable={!submitting && !isDemoPost}
              />
              <Pressable
                onPress={handleSubmit}
                disabled={!canSubmit}
                style={({ pressed }) => [
                  styles.sendBtn,
                  (!canSubmit || pressed) && styles.sendBtnDisabled,
                ]}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="send" size={20} color="#fff" />
                )}
              </Pressable>
            </View>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
    <GifPickerModal
      visible={gifPickerOpen}
      onClose={() => setGifPickerOpen(false)}
      onSelect={handleGifSelect}
    />
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: theme.colors.heading,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  reportBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  reportBtnText: {
    fontSize: 14,
    color: "#666",
  },
  closeBtn: { padding: 4 },
  loading: {
    padding: 32,
    alignItems: "center",
  },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 8 },
  postPreview: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 8,
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: theme.colors.primary,
    gap: 12,
  },
  previewAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  previewAvatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#e5e5e5",
    alignItems: "center",
    justifyContent: "center",
  },
  previewAvatarInitials: {
    fontSize: 14,
    fontWeight: "600",
    color: "#666",
  },
  previewContent: { flex: 1, minWidth: 0 },
  previewAuthor: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.heading,
  },
  previewText: {
    fontSize: 13,
    color: "#666",
    marginTop: 2,
  },
  previewThumb: {
    width: 44,
    height: 44,
    borderRadius: 6,
    backgroundColor: "#e0e0e0",
  },
  commentsSection: { paddingHorizontal: 16, paddingTop: 4 },
  commentsLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.heading,
    marginBottom: 12,
  },
  empty: {
    fontSize: 15,
    color: theme.colors.placeholder,
  },
  commentRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 16,
  },
  commentAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  commentAvatarPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#e5e5e5",
    alignItems: "center",
    justifyContent: "center",
  },
  commentAvatarInitials: {
    fontSize: 12,
    fontWeight: "600",
    color: "#666",
  },
  commentContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "stretch",
  },
  commentMain: { flex: 1, minWidth: 0 },
  commentLikeWrap: {
    justifyContent: "center",
    paddingLeft: 8,
  },
  commentAuthor: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.heading,
  },
  commentBody: {
    fontSize: 14,
    color: "#333",
    marginTop: 2,
    lineHeight: 20,
  },
  commentPhotos: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
  },
  commentPhoto: {
    width: 140,
    height: 140,
    borderRadius: 8,
  },
  commentDate: {
    fontSize: 11,
    color: "#999",
  },
  commentRowReply: {
    marginLeft: 36,
  },
  commentReplyTo: {
    fontSize: 12,
    color: "#666",
    fontStyle: "italic",
  },
  commentActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 4,
  },
  commentActionBtn: {
    flexDirection: "row",
    alignItems: "center",
  },
  commentActionText: {
    fontSize: 12,
    color: "#666",
  },
  commentActionTextActive: {
    color: theme.colors.primary,
  },
  replyingToBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#f0f0f0",
  },
  replyingToText: {
    fontSize: 13,
    color: "#666",
  },
  replyingToCancel: { padding: 4 },
  demoBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    marginHorizontal: 16,
    marginTop: 8,
    backgroundColor: "#e8f4ff",
    borderRadius: 8,
  },
  demoBannerText: {
    flex: 1,
    fontSize: 13,
    color: "#555",
  },
  inputSectionDisabled: { opacity: 0.7 },
  inputSection: {
    borderTopWidth: 1,
    borderTopColor: "#eee",
    backgroundColor: "#f9f9f9",
    paddingBottom: Platform.OS === "ios" ? 24 : 12,
  },
  photosScroll: {
    maxHeight: 72,
  },
  photosScrollContent: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  photoThumbWrap: { position: "relative" },
  photoThumb: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: "#e0e0e0",
  },
  photoRemove: {
    position: "absolute",
    top: -6,
    right: -6,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    padding: 12,
  },
  attachBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e0e0e0",
    alignItems: "center",
    justifyContent: "center",
  },
  attachBtnDisabled: { opacity: 0.5 },
  gifBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: theme.colors.primary,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#fff",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    fontSize: 15,
    color: theme.colors.heading,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnDisabled: {
    opacity: 0.5,
  },
});
