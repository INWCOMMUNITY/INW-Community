import { useState, useEffect } from "react";
import { Alert, Modal } from "react-native";
import {
  StyleSheet,
  View,
  Text,
  Image,
  Pressable,
  Linking,
  Dimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPost, apiDelete, getToken } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { ShareToChatModal } from "@/components/ShareToChatModal";
import type { FeedPost } from "@/lib/feed-api";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");
const resolveUri = (u: string) =>
  u.startsWith("http") ? u : `${siteBase}${u.startsWith("/") ? "" : "/"}${u}`;
const { width } = Dimensions.get("window");
const CARD_PADDING = 16;
const IMAGE_SIZE = Math.min((width - CARD_PADDING * 2 - 32) / 2, 120);

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

interface FeedPostCardProps {
  post: FeedPost;
  onLike: (postId: string) => void;
  onComment?: (postId: string) => void;
  onShare?: (postId: string) => void;
  onReport?: (postId: string) => void;
  onSave?: (postId: string) => void;
  onDeleteComment?: (commentId: string) => void;
  onOpenCoupon?: (couponId: string) => void;
}

export function FeedPostCard({ post, onLike, onComment, onShare, onReport, onSave, onOpenCoupon }: FeedPostCardProps) {
  const router = useRouter();
  const { member } = useAuth();
  const [blogSaved, setBlogSaved] = useState(false);
  const [blogSaving, setBlogSaving] = useState(false);
  const [blogShareOpen, setBlogShareOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const blog = post.type === "shared_blog" ? post.sourceBlog : null;
  useEffect(() => {
    if (!member || !blog) return;
    apiGet<{ referenceId: string }[]>(`/api/saved?type=blog`)
      .then((items) => setBlogSaved(items.some((i) => i.referenceId === blog.id)))
      .catch(() => setBlogSaved(false));
  }, [member, blog?.id]);

  const handleBlogSaveToggle = async () => {
    if (!member || !blog) return;
    const token = await getToken();
    if (!token) return;
    setBlogSaving(true);
    try {
      if (blogSaved) {
        await apiDelete(`/api/saved?type=blog&referenceId=${encodeURIComponent(blog.id)}`);
        setBlogSaved(false);
      } else {
        await apiPost("/api/saved", { type: "blog", referenceId: blog.id });
        setBlogSaved(true);
      }
    } catch {
      // ignore
    } finally {
      setBlogSaving(false);
    }
  };

  const authorName = `${post.author.firstName ?? ""} ${post.author.lastName ?? ""}`.trim();
  const initials = [
    post.author.firstName?.[0],
    post.author.lastName?.[0],
  ]
    .filter(Boolean)
    .join("")
    .toUpperCase() || "?";

  const openUrl = (path: string) => {
    Linking.openURL(`${siteBase}${path}`).catch(() => {});
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Pressable onPress={() => openUrl(`/members/${post.author.id}`)}>
          {post.author.profilePhotoUrl ? (
            <Image
              source={{ uri: resolveUri(post.author.profilePhotoUrl) }}
              style={styles.avatar}
            />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarInitials}>{initials}</Text>
            </View>
          )}
        </Pressable>
        <View style={styles.headerText}>
          <Pressable onPress={() => openUrl(`/members/${post.author.id}`)}>
            <Text style={styles.authorName} numberOfLines={1}>
              {authorName}
            </Text>
          </Pressable>
          <Text style={styles.date}>
            {new Date(post.createdAt).toLocaleDateString()}
          </Text>
        </View>
        {member && !post.id.startsWith("example-") && (
          <Pressable
            style={styles.menuBtn}
            onPress={() => setMenuOpen(true)}
          >
            <Ionicons name="ellipsis-vertical" size={20} color="#666" />
          </Pressable>
        )}
      </View>

      {menuOpen && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
          <Pressable style={styles.menuOverlay} onPress={() => setMenuOpen(false)}>
            <View style={styles.menuSheet}>
              {onSave && (
                <Pressable
                  style={styles.menuItem}
                  onPress={() => { setMenuOpen(false); onSave(post.id); }}
                >
                  <Ionicons name="bookmark-outline" size={20} color={theme.colors.heading} />
                  <Text style={styles.menuItemText}>Save Post</Text>
                </Pressable>
              )}
              {onReport && (
                <Pressable
                  style={styles.menuItem}
                  onPress={() => { setMenuOpen(false); onReport(post.id); }}
                >
                  <Ionicons name="flag-outline" size={20} color="#c00" />
                  <Text style={[styles.menuItemText, { color: "#c00" }]}>Report Post</Text>
                </Pressable>
              )}
              <Pressable style={styles.menuItem} onPress={() => setMenuOpen(false)}>
                <Ionicons name="close" size={20} color="#666" />
                <Text style={styles.menuItemText}>Cancel</Text>
              </Pressable>
            </View>
          </Pressable>
        </Modal>
      )}

      {post.type === "shared_blog" && post.sourceBlog && (
        <View style={styles.blogCardWrap}>
          <Pressable
            style={styles.sourceCard}
            onPress={() =>
              router.push(
                `/web?url=${encodeURIComponent(`${siteBase}/blog/${post.sourceBlog!.slug}`)}&title=${encodeURIComponent(post.sourceBlog!.title ?? "Blog")}`
              )
            }
          >
            {member && (
              <View style={styles.blogActions}>
                <Pressable
                  onPress={handleBlogSaveToggle}
                  disabled={blogSaving}
                  style={({ pressed }) => [styles.blogActionBtn, pressed && { opacity: 0.7 }]}
                >
                  <Ionicons
                    name={blogSaved ? "heart" : "heart-outline"}
                    size={24}
                    color={theme.colors.primary}
                  />
                </Pressable>
                <Pressable
                  onPress={() => setBlogShareOpen(true)}
                  style={({ pressed }) => [styles.blogActionBtn, pressed && { opacity: 0.7 }]}
                >
                  <Ionicons name="share-outline" size={24} color={theme.colors.primary} />
                </Pressable>
              </View>
            )}
            <Text style={styles.sourceTitle}>{post.sourceBlog.title}</Text>
            <Text style={styles.sourceMeta}>{post.sourceBlog.category.name}</Text>
            <Text style={styles.sourceBody} numberOfLines={3}>
              {stripHtml(post.sourceBlog.body).slice(0, 150)}…
            </Text>
            {post.sourceBlog.photos?.[0] && (
              <Image
                source={{ uri: resolveUri(post.sourceBlog.photos[0]) }}
                style={[styles.sourceImage, { height: IMAGE_SIZE }]}
                resizeMode="cover"
              />
            )}
          </Pressable>
          {member && (
            <ShareToChatModal
              visible={blogShareOpen}
              onClose={() => setBlogShareOpen(false)}
              sharedContent={{
                type: "blog",
                id: post.sourceBlog!.id,
                slug: post.sourceBlog!.slug,
              }}
            />
          )}
        </View>
      )}

      {post.type === "shared_business" && post.sourceBusiness && (
        <Pressable
          style={styles.sourceCard}
          onPress={() => router.push(`/business/${post.sourceBusiness!.slug}`)}
        >
          <View style={styles.sourceRow}>
            {post.sourceBusiness.logoUrl && (
              <Image
                source={{ uri: resolveUri(post.sourceBusiness.logoUrl) }}
                style={styles.sourceLogo}
              />
            )}
            <View style={styles.sourceContent}>
              <Text style={styles.sourceTitle}>{post.sourceBusiness.name}</Text>
              {post.sourceBusiness.shortDescription && (
                <Text style={styles.sourceBody} numberOfLines={2}>
                  {post.sourceBusiness.shortDescription}
                </Text>
              )}
            </View>
          </View>
        </Pressable>
      )}

      {post.type === "shared_coupon" && post.sourceCoupon && (
        <Pressable
          style={styles.sourceCard}
          onPress={() =>
            onOpenCoupon
              ? onOpenCoupon(post.sourceCoupon!.id)
              : (router.push as (href: string) => void)("/coupons")
          }
        >
          <Text style={styles.sourceTitle}>{post.sourceCoupon.name}</Text>
          <Text style={styles.sourceBody}>
            {post.sourceCoupon.discount} · {post.sourceCoupon.business.name}
          </Text>
        </Pressable>
      )}

      {post.type === "shared_reward" && post.sourceReward && (
        <Pressable
          style={styles.sourceCard}
          onPress={() => openUrl("/rewards")}
        >
          <Text style={styles.sourceTitle}>{post.sourceReward.title}</Text>
          <Text style={styles.sourceBody}>
            {post.sourceReward.pointsRequired} points ·{" "}
            {post.sourceReward.business.name}
          </Text>
        </Pressable>
      )}

      {post.type === "shared_store_item" && post.sourceStoreItem && (
        <Pressable
          style={styles.sourceCard}
          onPress={() =>
            (router.push as (href: string) => void)(`/product/${post.sourceStoreItem!.slug}`)
          }
        >
          <View style={styles.sourceRow}>
            {post.sourceStoreItem.photos?.[0] && (
              <Image
                source={{ uri: resolveUri(post.sourceStoreItem.photos[0]) }}
                style={styles.sourceLogo}
              />
            )}
            <View style={styles.sourceContent}>
              <Text style={styles.sourceTitle}>
                {post.sourceStoreItem.title}
              </Text>
              <Text style={styles.sourceBody}>
                ${(post.sourceStoreItem.priceCents / 100).toFixed(2)}
              </Text>
            </View>
          </View>
        </Pressable>
      )}

      {post.type === "shared_post" && post.sourcePost ? (
        <View style={styles.sourceCard}>
          <Text style={styles.sourceBody}>
            Shared a post
          </Text>
        </View>
      ) : null}

      {post.content ? (
        <Text style={styles.content}>{post.content}</Text>
      ) : null}

      {post.tags && post.tags.length > 0 ? (
        <View style={styles.tags}>
          {post.tags.map((t) => (
            <Text key={t.id} style={styles.tag}>
              #{t.name}
            </Text>
          ))}
        </View>
      ) : null}

      {(post.photos?.length ?? 0) + (post.videos?.length ?? 0) > 0 ? (
        <View style={styles.mediaGrid}>
          {[...(post.photos ?? []), ...(post.videos ?? [])]
            .slice(0, 4)
            .map((url, i) => (
              <Image
                key={i}
                source={{ uri: resolveUri(url) }}
                style={styles.mediaImage}
                resizeMode="cover"
              />
            ))}
        </View>
      ) : null}

      <View style={styles.actions}>
        <Pressable
          style={styles.actionBtn}
          onPress={() => onLike(post.id)}
        >
          <Text
            style={[
              styles.actionText,
              post.liked && styles.actionTextActive,
            ]}
          >
            Like {post.likeCount > 0 ? `(${post.likeCount})` : ""}
          </Text>
        </Pressable>
        <Pressable
          style={styles.actionBtn}
          onPress={() => onComment?.(post.id)}
        >
          <Text style={styles.actionText}>
            Comment {post.commentCount > 0 ? `(${post.commentCount})` : ""}
          </Text>
        </Pressable>
        {onShare ? (
          <Pressable
            style={styles.actionBtn}
            onPress={() => onShare(post.id)}
          >
            <Text style={styles.actionText}>Share</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    overflow: "hidden",
    marginBottom: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    gap: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  avatarPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#e5e5e5",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitials: {
    fontSize: 16,
    fontWeight: "600",
    color: "#666",
  },
  headerText: { flex: 1, minWidth: 0 },
  authorName: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.heading,
    fontFamily: theme.fonts.heading,
  },
  date: {
    fontSize: 12,
    color: "#666",
    marginTop: 2,
  },
  blogCardWrap: {},
  blogActions: {
    position: "absolute",
    top: 8,
    right: 8,
    flexDirection: "row",
    gap: 0,
    zIndex: 1,
  },
  blogActionBtn: {
    paddingVertical: 10,
    paddingHorizontal: 4,
    backgroundColor: "rgba(255,255,255,0.9)",
    borderRadius: 8,
  },
  sourceCard: {
    marginHorizontal: 12,
    marginBottom: 12,
    padding: 12,
    backgroundColor: "#f5f5f5",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#e5e5e5",
  },
  sourceTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: theme.colors.heading,
    fontFamily: theme.fonts.heading,
  },
  sourceMeta: {
    fontSize: 12,
    color: "#666",
    marginTop: 2,
  },
  sourceBody: {
    fontSize: 14,
    color: "#333",
    marginTop: 6,
  },
  sourceRow: {
    flexDirection: "row",
    gap: 12,
  },
  sourceContent: { flex: 1, minWidth: 0 },
  sourceLogo: {
    width: 64,
    height: 64,
    borderRadius: 6,
  },
  sourceImage: {
    width: "100%",
    borderRadius: 6,
    marginTop: 8,
  },
  content: {
    fontSize: 15,
    color: "#333",
    paddingHorizontal: 12,
    paddingBottom: 12,
    lineHeight: 22,
  },
  tags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  tag: {
    fontSize: 14,
    color: theme.colors.primary,
    fontWeight: "500",
  },
  mediaGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  mediaImage: {
    width: (width - CARD_PADDING * 2 - 24 - 12) / 2,
    height: (width - CARD_PADDING * 2 - 24 - 12) / 2,
    borderRadius: 6,
  },
  actions: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "#e5e5e5",
    paddingVertical: 8,
    paddingHorizontal: 12,
    justifyContent: "space-around",
  },
  actionBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  actionText: {
    fontSize: 14,
    color: "#666",
    fontWeight: "500",
  },
  actionTextActive: {
    color: theme.colors.primary,
  },
  actionMuted: {
    color: "#999",
  },
  sharedPostLink: {
    marginTop: 8,
  },
  menuBtn: {
    padding: 4,
  },
  menuOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  menuSheet: {
    backgroundColor: "#fff",
    borderRadius: 12,
    width: "100%",
    maxWidth: 300,
    overflow: "hidden",
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  menuItemText: {
    fontSize: 16,
    fontWeight: "500",
    color: theme.colors.heading,
  },
});
