import { useState, useEffect, useCallback } from "react";
import { Alert, Modal, ScrollView, NativeSyntheticEvent, NativeScrollEvent } from "react-native";
import {
  StyleSheet,
  View,
  Text,
  Image,
  Pressable,
  Linking,
  Dimensions,
  useWindowDimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPost, apiDelete, getToken } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { ShareToChatModal } from "@/components/ShareToChatModal";
import { postTouchesViewerManagedBusinesses, type FeedPost } from "@/lib/feed-api";
import { ScaledImageFit } from "@/components/ScaledImageFit";
import { Video, ResizeMode } from "expo-av";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");
const resolveUri = (u: string) =>
  u.startsWith("http") ? u : `${siteBase}${u.startsWith("/") ? "" : "/"}${u}`;
const { width } = Dimensions.get("window");
const CARD_PADDING = 16;
const IMAGE_SIZE = Math.min((width - CARD_PADDING * 2 - 32) / 2, 120);
const DESCRIPTION_WORD_LIMIT = 30;

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function firstNWords(text: string, n: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, n).join(" ");
}

function businessInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  }
  const t = name.trim();
  return (t.length >= 2 ? t.slice(0, 2) : t.slice(0, 1) || "?").toUpperCase();
}

interface FeedPostCardProps {
  post: FeedPost;
  onLike: (postId: string) => void;
  onComment?: (postId: string) => void;
  onShare?: (postId: string) => void;
  onReport?: (postId: string) => void;
  onBlockUser?: (memberId: string, postId: string) => void;
  onSave?: (postId: string) => void;
  /** Opens create/edit modal (author only; business owners cannot edit others' captions). */
  onEditPost?: (post: FeedPost) => void;
  /** Deletes this post (author, or business owner when post promotes their listing/coupon/reward). */
  onDeletePost?: (postId: string) => void;
  /** Business IDs the viewer owns — enables delete (not edit) for promotional posts authored by others. */
  viewerManagedBusinessIds?: string[];
  onDeleteComment?: (commentId: string) => void;
  onOpenCoupon?: (couponId: string) => void;
}

export function FeedPostCard({
  post,
  onLike,
  onComment,
  onShare,
  onReport,
  onBlockUser,
  onSave,
  onEditPost,
  onDeletePost,
  viewerManagedBusinessIds,
  onOpenCoupon,
}: FeedPostCardProps) {
  const router = useRouter();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  /** Measured width of the carousel row inside the card (not screen width — using window width clips the right side). */
  const [carouselViewportW, setCarouselViewportW] = useState<number | null>(null);
  const slideW = carouselViewportW && carouselViewportW > 0 ? carouselViewportW : 0;
  const maxCarouselHeightCap = Math.round(windowHeight * 0.62);
  /** Fallback while measuring this post’s images; not shared across posts. */
  const placeholderCarouselH =
    slideW > 0
      ? Math.min(Math.round(slideW * 1.38), maxCarouselHeightCap)
      : Math.min(Math.round(windowWidth * 1.38), maxCarouselHeightCap);
  /** Tallest scaled photo height for this post only (carousel pages share this height). */
  const [perPostCarouselH, setPerPostCarouselH] = useState<number | null>(null);
  const feedMedia = [
    ...(post.photos ?? []).map((url) => ({ url, isVideo: false as const })),
    ...(post.videos ?? []).map((url) => ({ url, isVideo: true as const })),
  ];
  const mediaSig = feedMedia.map((m) => `${m.isVideo ? "v" : "p"}:${m.url}`).join("\u0001");
  const carouselDisplayH =
    perPostCarouselH != null ? perPostCarouselH : placeholderCarouselH;

  const { member } = useAuth();
  const [blogSaved, setBlogSaved] = useState(false);
  const [blogSaving, setBlogSaving] = useState(false);
  const [blogShareOpen, setBlogShareOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [photoCarouselIndex, setPhotoCarouselIndex] = useState(0);
  const [nestedPhotoCarouselIndex, setNestedPhotoCarouselIndex] = useState(0);
  /** Width of the shared_post embed (gray card inner), so nested photo pager matches the box. */
  const [sharedPostCarouselWidth, setSharedPostCarouselWidth] = useState<number | null>(null);

  useEffect(() => {
    setPhotoCarouselIndex(0);
  }, [post.id]);

  useEffect(() => {
    if (slideW <= 0 || feedMedia.length === 0) {
      setPerPostCarouselH(null);
      return;
    }
    setPerPostCarouselH(null);
    let cancelled = false;

    void Promise.all(
      feedMedia.map((item) => {
        if (item.isVideo) {
          return Promise.resolve(
            Math.min(Math.max(1, Math.round((slideW * 9) / 16)), maxCarouselHeightCap)
          );
        }
        const uri = resolveUri(item.url);
        return new Promise<number>((resolve) => {
          Image.getSize(
            uri,
            (nw, nh) => {
              if (nw <= 0 || nh <= 0) {
                resolve(
                  Math.min(Math.round(slideW * 1.38), maxCarouselHeightCap)
                );
                return;
              }
              const scale = Math.min(slideW / nw, maxCarouselHeightCap / nh);
              resolve(Math.max(1, Math.round(nh * scale)));
            },
            () =>
              resolve(
                Math.min(Math.round(slideW * 1.38), maxCarouselHeightCap)
              )
          );
        });
      })
    ).then((heights) => {
      if (cancelled) return;
      const H = Math.min(Math.max(...heights), maxCarouselHeightCap);
      setPerPostCarouselH(H);
    });

    return () => {
      cancelled = true;
    };
  }, [slideW, post.id, mediaSig, maxCarouselHeightCap]);

  const blog = post.type === "shared_blog" ? post.sourceBlog : null;

  const businessAsAuthor =
    post.type === "shared_business" && post.sourceBusiness ? post.sourceBusiness : null;

  const canEditThisPost =
    !!member &&
    !!onEditPost &&
    member.id === post.author.id &&
    !post.id.startsWith("example-");

  const canDeleteThisPost =
    !!member &&
    !!onDeletePost &&
    !post.id.startsWith("example-") &&
    (member.id === post.author.id ||
      (!!viewerManagedBusinessIds?.length &&
        postTouchesViewerManagedBusinesses(post, viewerManagedBusinessIds)));
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

  const authorName = businessAsAuthor
    ? businessAsAuthor.name
    : `${post.author.firstName ?? ""} ${post.author.lastName ?? ""}`.trim();
  const initials = businessAsAuthor
    ? businessInitials(businessAsAuthor.name)
    : [
          post.author.firstName?.[0],
          post.author.lastName?.[0],
        ]
          .filter(Boolean)
          .join("")
          .toUpperCase() || "?";

  const openUrl = (path: string) => {
    Linking.openURL(`${siteBase}${path}`).catch(() => {});
  };

  const openProfile = (memberId: string) => {
    (router.push as (href: string) => void)(`/members/${memberId}`);
  };

  const openBusinessPage = (slug: string) => {
    (router.push as (href: string) => void)(`/business/${slug}`);
  };

  const openOriginalPost = (sourcePostId: string) => {
    (router.push as (href: string) => void)(`/post/${sourcePostId}`);
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Pressable
          onPress={() =>
            businessAsAuthor
              ? openBusinessPage(businessAsAuthor.slug)
              : openProfile(post.author.id)
          }
        >
          {businessAsAuthor ? (
            businessAsAuthor.logoUrl ? (
              <Image
                source={{ uri: resolveUri(businessAsAuthor.logoUrl) }}
                style={styles.avatar}
                resizeMode="cover"
              />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarInitials}>{initials}</Text>
              </View>
            )
          ) : post.author.profilePhotoUrl ? (
            <Image
              source={{ uri: resolveUri(post.author.profilePhotoUrl) }}
              style={styles.avatar}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarInitials}>{initials}</Text>
            </View>
          )}
        </Pressable>
        <View style={styles.headerText}>
          <Pressable
            onPress={() =>
              businessAsAuthor
                ? openBusinessPage(businessAsAuthor.slug)
                : openProfile(post.author.id)
            }
          >
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

      {post.sourceGroup && (
        <Pressable
          style={styles.groupRibbon}
          onPress={() => router.push(`/community/group/${post.sourceGroup!.slug}` as any)}
        >
          <Ionicons name="people" size={14} color={theme.colors.primary} />
          <Text style={styles.groupRibbonText}>From {post.sourceGroup.name}</Text>
        </Pressable>
      )}

      {menuOpen && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
          <Pressable style={styles.menuOverlay} onPress={() => setMenuOpen(false)}>
            <View style={styles.menuSheet}>
              {canEditThisPost && (
                  <Pressable
                    style={styles.menuItem}
                    onPress={() => {
                      setMenuOpen(false);
                      onEditPost!(post);
                    }}
                  >
                    <Ionicons name="create-outline" size={20} color={theme.colors.heading} />
                    <Text style={styles.menuItemText}>Edit post</Text>
                  </Pressable>
                )}
              {canDeleteThisPost && (
                  <Pressable
                    style={styles.menuItem}
                    onPress={() => {
                      setMenuOpen(false);
                      onDeletePost!(post.id);
                    }}
                  >
                    <Ionicons name="trash-outline" size={20} color="#c00" />
                    <Text style={[styles.menuItemText, { color: "#c00" }]}>Delete post</Text>
                  </Pressable>
                )}
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
              {onBlockUser && !post.id.startsWith("example-") && !businessAsAuthor && (
                <Pressable
                  style={styles.menuItem}
                  onPress={() => { setMenuOpen(false); onBlockUser(post.author.id, post.id); }}
                >
                  <Ionicons name="ban-outline" size={20} color="#c00" />
                  <Text style={[styles.menuItemText, { color: "#c00" }]}>Block user</Text>
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

      {post.content && post.type?.startsWith("shared_") ? (
        <View style={styles.contentBlock}>
          <Text style={styles.content}>
            {wordCount(post.content) <= DESCRIPTION_WORD_LIMIT || descriptionExpanded
              ? post.content
              : firstNWords(post.content, DESCRIPTION_WORD_LIMIT)}
          </Text>
          {wordCount(post.content) > DESCRIPTION_WORD_LIMIT && (
            <Pressable
              onPress={() => setDescriptionExpanded((e) => !e)}
              style={({ pressed }) => [styles.seeMoreBtn, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.seeMoreText}>
                {descriptionExpanded ? "See less" : "See full description"}
              </Text>
            </Pressable>
          )}
        </View>
      ) : null}

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
                resizeMode="cover"
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
        (() => {
          const sourcePost = post.sourcePost as any;
          const sourceAuthor = sourcePost?.author;
          const sourceAuthorName = sourceAuthor
            ? `${sourceAuthor.firstName ?? ""} ${sourceAuthor.lastName ?? ""}`.trim()
            : "";
          const nestedBiz =
            sourcePost?.type === "shared_business" && sourcePost?.sourceBusiness
              ? sourcePost.sourceBusiness
              : null;
          const nestedHeaderName = nestedBiz
            ? nestedBiz.name
            : sourceAuthorName || "Unknown";
          const nestedHeaderInitials = nestedBiz
            ? businessInitials(nestedBiz.name)
            : `${sourceAuthor?.firstName?.[0] ?? ""}${sourceAuthor?.lastName?.[0] ?? ""}`.toUpperCase() ||
              "?";

          const showSharedByYou =
            member && post.author?.id && post.author.id === member.id;

          const originalId = typeof sourcePost?.id === "string" ? sourcePost.id : null;

          /** sourceCard: marginHorizontal 12 + padding 12 each side */
          const nestedFallbackW = Math.max(1, windowWidth - 48);
          const nestedSlideW =
            sharedPostCarouselWidth != null && sharedPostCarouselWidth > 0
              ? sharedPostCarouselWidth
              : nestedFallbackW;
          const nestedSlideH = Math.round(Math.min(nestedSlideW * 0.75, 320));

          const nestedMedia = [
            ...(Array.isArray(sourcePost.photos) ? sourcePost.photos : []).map((url: string) => ({
              url,
              isVideo: false as const,
            })),
            ...(Array.isArray(sourcePost.videos) ? sourcePost.videos : []).map((url: string) => ({
              url,
              isVideo: true as const,
            })),
          ];

          return (
            <View style={[styles.sourceCard, { backgroundColor: "#f7f7f7" }]}>
              <Pressable
                onPress={() => originalId && openOriginalPost(originalId)}
                disabled={!originalId}
                accessibilityRole={originalId ? "button" : undefined}
                accessibilityLabel={originalId ? "View original post" : undefined}
              >
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
                    {nestedBiz ? (
                      nestedBiz.logoUrl ? (
                        <Image
                          source={{ uri: resolveUri(nestedBiz.logoUrl) }}
                          style={styles.nestedAvatar}
                          resizeMode="cover"
                        />
                      ) : (
                        <View style={styles.nestedAvatarPlaceholder}>
                          <Text style={styles.avatarInitials}>{nestedHeaderInitials}</Text>
                        </View>
                      )
                    ) : sourceAuthor?.profilePhotoUrl ? (
                      <Image
                        source={{ uri: resolveUri(sourceAuthor.profilePhotoUrl) }}
                        style={styles.nestedAvatar}
                        resizeMode="cover"
                      />
                    ) : (
                      <View style={styles.nestedAvatarPlaceholder}>
                        <Text style={styles.avatarInitials}>{nestedHeaderInitials}</Text>
                      </View>
                    )}

                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Pressable
                        onPress={() =>
                          nestedBiz
                            ? openBusinessPage(nestedBiz.slug)
                            : sourceAuthor?.id && openProfile(sourceAuthor.id)
                        }
                      >
                        <Text style={styles.sourceAuthorName} numberOfLines={1}>
                          {nestedHeaderName}
                        </Text>
                      </Pressable>
                      {sourcePost?.createdAt ? (
                        <Text style={styles.sourceMeta}>
                          {new Date(sourcePost.createdAt).toLocaleDateString()}
                        </Text>
                      ) : null}
                    </View>
                  </View>

                  {showSharedByYou ? (
                    <View style={styles.sharedByYouPill}>
                      <Text style={styles.sharedByYouPillText}>Shared by you</Text>
                    </View>
                  ) : null}
                </View>

                {sourcePost.type === "shared_blog" && sourcePost.sourceBlog ? (
                  <View style={{ marginTop: 10 }}>
                    <Text style={styles.sourceTitle}>{sourcePost.sourceBlog.title}</Text>
                    <Text style={styles.sourceMeta}>{sourcePost.sourceBlog.category.name}</Text>
                    <Text style={styles.sourceBody} numberOfLines={3}>
                      {stripHtml(sourcePost.sourceBlog.body).slice(0, 150)}…
                    </Text>
                    {sourcePost.sourceBlog.photos?.[0] ? (
                      <Image
                        source={{ uri: resolveUri(sourcePost.sourceBlog.photos[0]) }}
                        style={[styles.sourceImage, { height: IMAGE_SIZE }]}
                        resizeMode="cover"
                      />
                    ) : null}
                  </View>
                ) : null}

                {sourcePost.type === "shared_coupon" && sourcePost.sourceCoupon ? (
                  <View style={{ marginTop: 10 }}>
                    <Text style={styles.sourceTitle}>{sourcePost.sourceCoupon.name}</Text>
                    <Text style={styles.sourceBody}>
                      {sourcePost.sourceCoupon.discount} · {sourcePost.sourceCoupon.business.name}
                    </Text>
                  </View>
                ) : null}

                {sourcePost.type === "shared_reward" && sourcePost.sourceReward ? (
                  <View style={{ marginTop: 10 }}>
                    <Text style={styles.sourceTitle}>{sourcePost.sourceReward.title}</Text>
                    <Text style={styles.sourceBody}>
                      {sourcePost.sourceReward.pointsRequired} points · {sourcePost.sourceReward.business.name}
                    </Text>
                  </View>
                ) : null}

                {sourcePost.type === "shared_store_item" && sourcePost.sourceStoreItem ? (
                  <View style={{ marginTop: 10 }}>
                    <View style={styles.sourceRow}>
                      {sourcePost.sourceStoreItem.photos?.[0] ? (
                        <Image
                          source={{ uri: resolveUri(sourcePost.sourceStoreItem.photos[0]) }}
                          style={styles.sourceLogo}
                          resizeMode="cover"
                        />
                      ) : null}
                      <View style={styles.sourceContent}>
                        <Text style={styles.sourceTitle}>{sourcePost.sourceStoreItem.title}</Text>
                        <Text style={styles.sourceBody}>
                          ${(sourcePost.sourceStoreItem.priceCents / 100).toFixed(2)}
                        </Text>
                      </View>
                    </View>
                  </View>
                ) : null}

                {sourcePost.content ? (
                  <View style={{ marginTop: 10 }}>
                    <Text style={styles.sourceBody}>
                      {sourcePost.content.slice(0, 300)}
                      {sourcePost.content.length > 300 ? "…" : ""}
                    </Text>
                  </View>
                ) : null}

                {sourcePost.tags?.length ? (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                    {sourcePost.tags.map((t: any) => (
                      <Text key={t.id} style={styles.tag}>
                        #{t.name}
                      </Text>
                    ))}
                  </View>
                ) : null}
              </Pressable>

              {nestedMedia.length > 0 ? (
                <View
                  style={{ width: "100%" }}
                  onLayout={(e) => {
                    const w = e.nativeEvent.layout.width;
                    if (w > 0) setSharedPostCarouselWidth(w);
                  }}
                >
                  <View style={styles.photoCarouselWrap}>
                    <ScrollView
                      horizontal
                      pagingEnabled
                      showsHorizontalScrollIndicator={false}
                      onMomentumScrollEnd={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
                        const index = Math.round(e.nativeEvent.contentOffset.x / nestedSlideW);
                        setNestedPhotoCarouselIndex(index);
                      }}
                      style={[styles.photoCarousel, { width: nestedSlideW }]}
                    >
                      {nestedMedia.map((item, i) =>
                        item.isVideo ? (
                          <View key={`${item.url}-${i}`} style={{ width: nestedSlideW }}>
                            <Video
                              source={{ uri: resolveUri(item.url) }}
                              style={{ width: nestedSlideW, height: nestedSlideH }}
                              useNativeControls
                              resizeMode={ResizeMode.COVER}
                              isLooping
                            />
                          </View>
                        ) : (
                          <Pressable
                            key={`${item.url}-${i}`}
                            onPress={() => originalId && openOriginalPost(originalId)}
                            accessibilityRole="button"
                            accessibilityLabel="View original post"
                          >
                            <Image
                              source={{ uri: resolveUri(item.url) }}
                              style={[
                                styles.photoCarouselImage,
                                { width: nestedSlideW, height: nestedSlideH },
                              ]}
                              resizeMode="cover"
                            />
                          </Pressable>
                        )
                      )}
                    </ScrollView>
                    {nestedMedia.length > 1 ? (
                      <View style={styles.carouselDots}>
                        {nestedMedia.map((_, i) => (
                          <View
                            key={i}
                            style={[
                              styles.carouselDot,
                              i === nestedPhotoCarouselIndex && styles.carouselDotActive,
                            ]}
                          />
                        ))}
                      </View>
                    ) : null}
                  </View>
                </View>
              ) : null}
            </View>
          );
        })()
      ) : null}

      {post.content && !post.type?.startsWith("shared_") ? (
        <View style={styles.contentBlock}>
          <Text style={styles.content}>
            {(() => {
              const words = wordCount(post.content!);
              if (words <= DESCRIPTION_WORD_LIMIT || descriptionExpanded) {
                return post.content;
              }
              return firstNWords(post.content!, DESCRIPTION_WORD_LIMIT);
            })()}
          </Text>
          {post.content && wordCount(post.content) > DESCRIPTION_WORD_LIMIT && (
            <Pressable
              onPress={() => setDescriptionExpanded((e) => !e)}
              style={({ pressed }) => [styles.seeMoreBtn, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.seeMoreText}>
                {descriptionExpanded ? "See less" : "See full description"}
              </Text>
            </Pressable>
          )}
        </View>
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

      {feedMedia.length > 0 ? (
        <View
          style={styles.photoCarouselWrap}
          onLayout={(e) => {
            const w = Math.round(e.nativeEvent.layout.width);
            if (w > 0 && w !== carouselViewportW) setCarouselViewportW(w);
          }}
        >
          {slideW > 0 ? (
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
                const index = Math.round(e.nativeEvent.contentOffset.x / slideW);
                setPhotoCarouselIndex(index);
              }}
              style={[styles.photoCarousel, { width: slideW }]}
            >
              {feedMedia.map((item, i) => (
                <View key={`${item.url}-${i}`} style={{ width: slideW }}>
                  {item.isVideo ? (
                    <View
                      style={{
                        width: slideW,
                        height: carouselDisplayH,
                        backgroundColor: "#111",
                        justifyContent: "center",
                      }}
                    >
                      <Video
                        source={{ uri: resolveUri(item.url) }}
                        style={{ width: slideW, height: carouselDisplayH }}
                        useNativeControls
                        resizeMode={ResizeMode.CONTAIN}
                        isLooping
                      />
                    </View>
                  ) : (
                    <ScaledImageFit
                      uri={resolveUri(item.url)}
                      maxWidth={slideW}
                      maxHeight={carouselDisplayH}
                    />
                  )}
                </View>
              ))}
            </ScrollView>
          ) : (
            <View style={{ height: placeholderCarouselH, backgroundColor: "#eee" }} />
          )}
          {feedMedia.length > 1 && slideW > 0 ? (
            <View style={styles.carouselDots}>
              {feedMedia.map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.carouselDot,
                    i === photoCarouselIndex && styles.carouselDotActive,
                  ]}
                />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={styles.actions}>
        <Pressable
          style={styles.actionBtn}
          onPress={() => onLike(post.id)}
          accessibilityRole="button"
          accessibilityLabel={
            post.liked
              ? `Unlike${post.likeCount > 0 ? `, ${post.likeCount} likes` : ""}`
              : `Like${post.likeCount > 0 ? `, ${post.likeCount} likes` : ""}`
          }
        >
          <View style={styles.actionRow}>
            <Ionicons name="leaf" size={20} color={post.liked ? theme.colors.primary : "#666"} />
            {post.likeCount > 0 ? (
              <Text style={[styles.actionCount, post.liked && styles.actionTextActive]}>
                {post.likeCount}
              </Text>
            ) : null}
          </View>
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
  groupRibbon: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    marginBottom: 10,
    marginHorizontal: 12,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: theme.colors.cream,
    borderRadius: 8,
    alignSelf: "flex-start",
  },
  groupRibbonText: {
    fontSize: 13,
    color: theme.colors.primary,
    fontWeight: "600",
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
  nestedAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  nestedAvatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#e5e5e5",
    alignItems: "center",
    justifyContent: "center",
  },
  sourceImage: {
    width: "100%",
    borderRadius: 6,
    marginTop: 8,
  },
  sourceAuthorName: {
    fontSize: 14,
    fontWeight: "700",
    color: theme.colors.heading,
    fontFamily: theme.fonts.heading,
  },
  contentBlock: {
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  content: {
    fontSize: 15,
    color: "#333",
    lineHeight: 22,
  },
  seeMoreBtn: {
    marginTop: 4,
  },
  seeMoreText: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.primary,
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
  photoCarouselWrap: {
    marginBottom: 12,
  },
  photoCarousel: {},
  photoCarouselImage: {
    backgroundColor: "#eee",
  },
  carouselDots: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    paddingVertical: 10,
  },
  carouselDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#ccc",
  },
  carouselDotActive: {
    backgroundColor: theme.colors.primary,
    width: 9,
    height: 9,
    borderRadius: 4.5,
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
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  actionCount: {
    fontSize: 14,
    fontWeight: "600",
    color: "#666",
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
  sharedByYouPill: {
    backgroundColor: theme.colors.primary,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignSelf: "flex-start",
  },
  sharedByYouPillText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
});
