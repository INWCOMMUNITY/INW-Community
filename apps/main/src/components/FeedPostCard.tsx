"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useLockBodyScroll } from "@/lib/scroll-lock";
import { IonIcon } from "@/components/IonIcon";
const TRUNCATE_LENGTH = 200;

/** NWC-style leaf for post likes (outline stroke). */
function LeafLikeIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <path
        d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4 19 2c1 2 2 4.2 2 6.5 0 5.7-4.5 10.3-10.1 11.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M2 21c0-3 1.5-5.5 4-7 3-2 6.5-3 10-3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type SourcePostAuthor = { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null };
type SourceBlog = {
  id: string;
  slug: string;
  title: string;
  body: string;
  photos: string[];
  member: SourcePostAuthor;
  category: { name: string; slug: string };
  blogTags?: { tag: { id: string; name: string; slug: string } }[];
};
type SourcePost = {
  id: string;
  type: string;
  content: string | null;
  photos: string[];
  videos?: string[];
  tags?: { id: string; name: string; slug: string }[];
  createdAt: string;
  author: SourcePostAuthor;
  sourceBlog?: SourceBlog | null;
  sourceBusiness?: { id: string; name: string; slug: string; shortDescription: string | null; logoUrl: string | null } | null;
  sourceCoupon?: { id: string; name: string; discount: string; code: string; business: { name: string; slug: string } } | null;
  sourceReward?: { id: string; title: string; pointsRequired: number; business: { name: string; slug: string } } | null;
  sourceStoreItem?: { id: string; title: string; slug: string; photos: string[]; priceCents: number } | null;
};

interface FeedPostCardProps {
  post: {
    id: string;
    type: string;
    content: string | null;
    photos: string[];
    videos?: string[];
    tags?: { id: string; name: string; slug: string }[];
    createdAt: string;
    groupId?: string | null;
    author: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null };
    sourceBlog?: SourceBlog | null;
    sourceBusiness?: { id: string; name: string; slug: string; shortDescription: string | null; logoUrl: string | null } | null;
    sourceCoupon?: { id: string; name: string; discount: string; code: string; business: { name: string; slug: string } } | null;
    sourceReward?: { id: string; title: string; pointsRequired: number; business: { name: string; slug: string } } | null;
    sourceStoreItem?: { id: string; title: string; slug: string; photos: string[]; priceCents: number } | null;
    sourcePost?: SourcePost | null;
    liked: boolean;
    likeCount: number;
    commentCount: number;
  };
  onLike: (postId: string) => void;
  onShare?: (postId: string) => void;
  onCommentAdded?: (postId: string) => void;
  /** Current user id (for author actions). */
  viewerUserId?: string | null;
  onEditPost?: (post: FeedPostCardProps["post"]) => void;
  onDeletePost?: (postId: string) => void;
  /** Signed-out feed: show content and comment thread read-only; no like/share/post comment. */
  readOnlyInteractions?: boolean;
  /** Open comments and scroll to this comment id (e.g. `?comment=` on single post URL). */
  initialCommentId?: string | null;
}

function isVideoUrl(url: string) {
  return /\.(mp4|webm|mov)$/i.test(url);
}

type CommentItem = {
  id: string;
  parentId?: string | null;
  content: string;
  createdAt: string;
  member: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null };
  likeCount: number;
  liked: boolean;
  parentAuthorName?: string | null;
};

export function FeedPostCard({
  post,
  onLike,
  onShare,
  onCommentAdded,
  viewerUserId,
  onEditPost,
  onDeletePost,
  readOnlyInteractions = false,
  initialCommentId = null,
}: FeedPostCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [postMenuOpen, setPostMenuOpen] = useState(false);
  const [showAllPhotos, setShowAllPhotos] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryMedia, setGalleryMedia] = useState<string[]>([]);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [commentsOpen, setCommentsOpen] = useState(() => Boolean(initialCommentId));
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const content = post.content ?? "";
  const isLong = content.length > TRUNCATE_LENGTH;
  const displayContent = isLong && !expanded ? content.slice(0, TRUNCATE_LENGTH) + "…" : content;
  const allMedia = [...(post.photos ?? []), ...(post.videos ?? [])];
  const mediaPreviewCount = 4;
  const hasMoreMedia = allMedia.length > mediaPreviewCount;
  const displayMedia = showAllPhotos ? allMedia : allMedia.slice(0, mediaPreviewCount);

  function openGallery(media: string[], index: number) {
    setGalleryMedia(media);
    setGalleryIndex(index);
    setGalleryOpen(true);
  }

  useEffect(() => {
    if (!commentsOpen || !post.id) return;
    setCommentsLoading(true);
    fetch(`/api/posts/${post.id}/comments`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => setComments(Array.isArray(data?.comments) ? data.comments : []))
      .catch(() => setComments([]))
      .finally(() => setCommentsLoading(false));
  }, [commentsOpen, post.id]);

  useEffect(() => {
    if (initialCommentId) setCommentsOpen(true);
  }, [initialCommentId]);

  useEffect(() => {
    if (!initialCommentId || !commentsOpen || commentsLoading) return;
    const t = window.setTimeout(() => {
      document.getElementById(`post-comment-${initialCommentId}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 80);
    return () => window.clearTimeout(t);
  }, [initialCommentId, commentsOpen, commentsLoading, comments]);

  async function submitComment(e: React.FormEvent) {
    e.preventDefault();
    const text = commentText.trim();
    if (!text || submittingComment) return;
    setSubmittingComment(true);
    try {
      const res = await fetch(`/api/posts/${post.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ content: text }),
      });
      const data = await res.json();
      if (data?.id) {
        setComments((prev) => [...prev, { ...data, likeCount: 0, liked: false }]);
        setCommentText("");
        onCommentAdded?.(post.id);
      }
    } finally {
      setSubmittingComment(false);
    }
  }

  const galleryItem = galleryMedia[galleryIndex];
  const hasPrev = galleryIndex > 0;
  const hasNext = galleryIndex < galleryMedia.length - 1;

  useLockBodyScroll(galleryOpen);

  return (
    <article className="border rounded-lg bg-white shadow-sm overflow-hidden max-w-2xl w-full">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          {post.type === "shared_business" && post.sourceBusiness ? (
            <Link href={`/support-local/${post.sourceBusiness.slug}`} className="flex items-center gap-3 hover:opacity-90 flex-1 min-w-0">
              {post.sourceBusiness.logoUrl ? (
                <Image
                  src={post.sourceBusiness.logoUrl}
                  alt=""
                  width={48}
                  height={48}
                  className="w-12 h-12 rounded-full object-cover shrink-0"
                  quality={95}
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-gray-300 flex items-center justify-center text-lg font-medium text-gray-600 shrink-0">
                  {post.sourceBusiness.name?.[0] ?? "?"}
                </div>
              )}
              <div className="min-w-0">
                <span className="font-semibold text-gray-900 block truncate">
                  {post.sourceBusiness.name}
                </span>
                <span className="text-gray-500 text-sm">
                  {new Date(post.createdAt).toLocaleDateString()}
                </span>
              </div>
            </Link>
          ) : (
            <Link href={`/members/${post.author.id}`} className="flex items-center gap-3 hover:opacity-90 flex-1 min-w-0">
              {post.author.profilePhotoUrl ? (
                <Image
                  src={post.author.profilePhotoUrl}
                  alt=""
                  width={48}
                  height={48}
                  className="w-12 h-12 rounded-full object-cover shrink-0"
                  quality={95}
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-gray-300 flex items-center justify-center text-lg font-medium text-gray-600 shrink-0">
                  {post.author.firstName?.[0]}{post.author.lastName?.[0]}
                </div>
              )}
              <div className="min-w-0">
                <span className="font-semibold text-gray-900 block truncate">
                  {post.author.firstName} {post.author.lastName}
                </span>
                <span className="text-gray-500 text-sm">
                  {new Date(post.createdAt).toLocaleDateString()}
                </span>
              </div>
            </Link>
          )}
          <div className="shrink-0 flex items-center gap-1">
            {viewerUserId &&
              (onEditPost || onDeletePost) &&
              viewerUserId === post.author.id &&
              !post.id.startsWith("example-") && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setPostMenuOpen((o) => !o)}
                    className="w-9 h-9 rounded-full flex items-center justify-center text-gray-600 hover:bg-gray-100"
                    aria-label="Post options"
                    aria-expanded={postMenuOpen}
                  >
                    <span className="text-xl leading-none">⋯</span>
                  </button>
                  {postMenuOpen && (
                    <>
                      <button
                        type="button"
                        aria-label="Close menu"
                        className="fixed inset-0 z-30 cursor-default"
                        onClick={() => setPostMenuOpen(false)}
                      />
                      <div className="absolute right-0 top-full mt-1 z-40 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[160px]">
                        {onEditPost && (
                          <button
                            type="button"
                            className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50"
                            onClick={() => {
                              setPostMenuOpen(false);
                              onEditPost(post);
                            }}
                          >
                            Edit post
                          </button>
                        )}
                        {onDeletePost && (
                          <button
                            type="button"
                            className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-gray-50"
                            onClick={() => {
                              setPostMenuOpen(false);
                              onDeletePost(post.id);
                            }}
                          >
                            Delete post
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
          </div>
        </div>

        {post.type === "shared_blog" && post.sourceBlog && (
          <div className="border rounded p-4 bg-gray-50 mb-3">
            <Link href={`/blog/${post.sourceBlog.slug}`} className="block hover:opacity-90">
              <h3 className="font-bold text-lg">{post.sourceBlog.title}</h3>
              <span className="text-xs text-gray-500">{post.sourceBlog.category.name}</span>
              {post.sourceBlog.blogTags && post.sourceBlog.blogTags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {post.sourceBlog.blogTags.map((bt) => (
                    <span key={bt.tag.id} className="text-xs bg-gray-200 rounded px-1.5 py-0.5">#{bt.tag.name}</span>
                  ))}
                </div>
              )}
              <p className="text-gray-700 text-sm mt-2 line-clamp-3">
                {post.sourceBlog.body.replace(/<[^>]*>/g, "").slice(0, 200)}…
              </p>
              {post.sourceBlog.photos.length > 0 && (
                <div className="relative mt-2 w-full h-48">
                  <Image
                    src={post.sourceBlog.photos[0]}
                    alt=""
                    fill
                    className="object-cover rounded"
                    sizes="(max-width: 768px) 100vw, 500px"
                    quality={95}
                  />
                </div>
              )}
            </Link>
          </div>
        )}
        {post.type === "shared_coupon" && post.sourceCoupon && (
          <div className="border rounded p-4 bg-gray-50 mb-3">
            <Link href={`/coupons`} className="block hover:opacity-90">
              <h3 className="font-bold">{post.sourceCoupon.name}</h3>
              <p className="text-sm text-gray-600">{post.sourceCoupon.discount} · {post.sourceCoupon.business.name}</p>
            </Link>
          </div>
        )}
        {post.type === "shared_reward" && post.sourceReward && (
          <div className="border rounded p-4 bg-gray-50 mb-3">
            <Link href={`/rewards`} className="block hover:opacity-90">
              <h3 className="font-bold">{post.sourceReward.title}</h3>
              <p className="text-sm text-gray-600">{post.sourceReward.pointsRequired} points · {post.sourceReward.business.name}</p>
            </Link>
          </div>
        )}
        {post.type === "shared_store_item" && post.sourceStoreItem && (
          <div className="border rounded p-4 bg-gray-50 mb-3">
            <Link href={`/storefront/${post.sourceStoreItem.slug}`} className="block hover:opacity-90">
              <div className="flex gap-3">
                {post.sourceStoreItem.photos[0] && (
                  <Image src={post.sourceStoreItem.photos[0]} alt="" width={64} height={64} className="w-16 h-16 object-cover rounded" quality={95} />
                )}
                <div>
                  <h3 className="font-bold">{post.sourceStoreItem.title}</h3>
                  <p className="text-sm text-gray-600">${(post.sourceStoreItem.priceCents / 100).toFixed(2)}</p>
                </div>
              </div>
            </Link>
          </div>
        )}
        {post.type === "shared_post" && post.sourcePost && (
          <div className="border rounded p-4 bg-gray-50 mb-3">
            <Link
              href={`/my-community/posts/${post.sourcePost.id}`}
              className="text-sm font-semibold mb-3 inline-block hover:underline"
              style={{ color: "var(--color-primary)" }}
            >
              View original post
            </Link>
            {post.sourcePost.type === "shared_business" && post.sourcePost.sourceBusiness ? (
              <div className="flex items-center gap-2 mb-2">
                {post.sourcePost.sourceBusiness.logoUrl ? (
                  <Image
                    src={post.sourcePost.sourceBusiness.logoUrl}
                    alt=""
                    width={32}
                    height={32}
                    className="w-8 h-8 rounded-full object-cover shrink-0"
                    quality={95}
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center text-xs font-medium text-gray-600 shrink-0">
                    {post.sourcePost.sourceBusiness.name?.[0] ?? "?"}
                  </div>
                )}
                <Link
                  href={`/support-local/${post.sourcePost.sourceBusiness.slug}`}
                  className="font-semibold text-gray-900 hover:underline min-w-0 truncate"
                >
                  {post.sourcePost.sourceBusiness.name}
                </Link>
                <span className="text-gray-500 text-sm shrink-0">
                  {new Date(post.sourcePost.createdAt).toLocaleDateString()}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 mb-2">
                {post.sourcePost.author.profilePhotoUrl ? (
                  <Image
                    src={post.sourcePost.author.profilePhotoUrl}
                    alt=""
                    width={32}
                    height={32}
                    className="w-8 h-8 rounded-full object-cover"
                    quality={95}
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center text-xs font-medium text-gray-600">
                    {post.sourcePost.author.firstName?.[0]}{post.sourcePost.author.lastName?.[0]}
                  </div>
                )}
                <Link href={`/members/${post.sourcePost.author.id}`} className="font-semibold text-gray-900 hover:underline">
                  {post.sourcePost.author.firstName} {post.sourcePost.author.lastName}
                </Link>
                <span className="text-gray-500 text-sm">
                  {new Date(post.sourcePost.createdAt).toLocaleDateString()}
                </span>
              </div>
            )}
            {post.sourcePost.type === "shared_blog" && post.sourcePost.sourceBlog && (
              <div className="border rounded p-3 bg-white mb-2">
                <Link href={`/blog/${post.sourcePost.sourceBlog.slug}`} className="block hover:opacity-90">
                  <h3 className="font-bold">{post.sourcePost.sourceBlog.title}</h3>
                  <span className="text-xs text-gray-500">{post.sourcePost.sourceBlog.category.name}</span>
                  <p className="text-gray-700 text-sm mt-1 line-clamp-2">
                    {post.sourcePost.sourceBlog.body.replace(/<[^>]*>/g, "").slice(0, 150)}…
                  </p>
                  {post.sourcePost.sourceBlog.photos?.[0] && (
                    <div className="relative mt-2 w-full h-32">
                      <Image src={post.sourcePost.sourceBlog.photos[0]} alt="" fill className="object-cover rounded" sizes="(max-width: 768px) 100vw, 768px" quality={95} />
                    </div>
                  )}
                </Link>
              </div>
            )}
            {post.sourcePost.type === "shared_coupon" && post.sourcePost.sourceCoupon && (
              <div className="border rounded p-3 bg-white mb-2">
                <Link href="/coupons" className="block hover:opacity-90">
                  <h3 className="font-bold text-sm">{post.sourcePost.sourceCoupon.name}</h3>
                  <p className="text-xs text-gray-600">{post.sourcePost.sourceCoupon.discount} · {post.sourcePost.sourceCoupon.business.name}</p>
                </Link>
              </div>
            )}
            {post.sourcePost.type === "shared_reward" && post.sourcePost.sourceReward && (
              <div className="border rounded p-3 bg-white mb-2">
                <Link href="/rewards" className="block hover:opacity-90">
                  <h3 className="font-bold text-sm">{post.sourcePost.sourceReward.title}</h3>
                  <p className="text-xs text-gray-600">{post.sourcePost.sourceReward.pointsRequired} pts · {post.sourcePost.sourceReward.business.name}</p>
                </Link>
              </div>
            )}
            {post.sourcePost.type === "shared_store_item" && post.sourcePost.sourceStoreItem && (
              <div className="border rounded p-3 bg-white mb-2">
                <Link href={`/storefront/${post.sourcePost.sourceStoreItem.slug}`} className="block hover:opacity-90">
                  <div className="flex gap-2">
                    {post.sourcePost.sourceStoreItem.photos?.[0] && (
                      <Image src={post.sourcePost.sourceStoreItem.photos[0]} alt="" width={48} height={48} className="w-12 h-12 object-cover rounded" quality={95} />
                    )}
                    <div>
                      <h3 className="font-bold text-sm">{post.sourcePost.sourceStoreItem.title}</h3>
                      <p className="text-xs text-gray-600">${(post.sourcePost.sourceStoreItem.priceCents / 100).toFixed(2)}</p>
                    </div>
                  </div>
                </Link>
              </div>
            )}
            {post.sourcePost.content && (
              <p className="text-gray-800 text-sm whitespace-pre-wrap mb-2">{post.sourcePost.content.slice(0, 300)}{post.sourcePost.content.length > 300 ? "…" : ""}</p>
            )}
            {post.sourcePost.tags && post.sourcePost.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {post.sourcePost.tags.map((t) => (
                  <span key={t.id} className="text-xs" style={{ color: "var(--color-primary)" }}>
                    #{t.name}
                  </span>
                ))}
              </div>
            )}
            {(post.sourcePost.photos?.length ?? 0) + (post.sourcePost.videos?.length ?? 0) > 0 && (() => {
              const sourcePostMedia = [...(post.sourcePost!.photos ?? []), ...(post.sourcePost!.videos ?? [])];
              const originalHref = `/my-community/posts/${post.sourcePost!.id}`;
              return (
                <div className="mt-2 flex overflow-x-auto snap-x snap-mandatory gap-0 rounded border border-gray-200 bg-black/5 scroll-smooth max-w-full">
                  {sourcePostMedia.map((url, i) => (
                    <Link
                      key={i}
                      href={originalHref}
                      className="snap-center shrink-0 w-full min-w-full aspect-square relative block focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                      aria-label={`Photo ${i + 1} — view original post`}
                    >
                      {isVideoUrl(url) ? (
                        <video src={url} className="w-full h-full object-cover pointer-events-none" />
                      ) : (
                        <Image src={url} alt="" fill className="object-cover" sizes="100vw" quality={95} />
                      )}
                    </Link>
                  ))}
                </div>
              );
            })()}
          </div>
        )}

        {content && (
          <p className="text-gray-800 whitespace-pre-wrap mb-2">
            {displayContent}
            {isLong && !expanded && (
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="hover:underline ml-1 font-medium"
                style={{ color: "var(--color-primary)" }}
              >
                See More
              </button>
            )}
          </p>
        )}
        {post.tags && post.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {post.tags.map((t) => (
              <span key={t.id} className="text-sm" style={{ color: "var(--color-primary)" }}>
                #{t.name}
              </span>
            ))}
          </div>
        )}
        {allMedia.length > 0 && (
          <div className="mb-3">
            <div
              className={`grid gap-1 ${
                displayMedia.length === 1
                  ? "grid-cols-1"
                  : displayMedia.length === 2
                  ? "grid-cols-2"
                  : displayMedia.length === 3
                  ? "grid-cols-3"
                  : "grid-cols-2"
              }`}
            >
              {displayMedia.map((url, i) =>
                isVideoUrl(url) ? (
                  <button
                    key={i}
                    type="button"
                    onClick={() => openGallery(allMedia, i)}
                    className="relative aspect-square w-full text-left rounded overflow-hidden focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-gray-400"
                  >
                    <video src={url} className="w-full h-full object-cover pointer-events-none" />
                  </button>
                ) : (
                  <div
                    key={i}
                    className="relative aspect-square w-full rounded overflow-hidden bg-neutral-100 touch-manipulation"
                    role="img"
                    aria-label={`Photo ${i + 1} of ${displayMedia.length}.`}
                  >
                    <div className="relative w-full h-full min-h-[80px]">
                      <Image
                        src={url}
                        alt=""
                        fill
                        className="object-cover select-none"
                        sizes="(max-width: 640px) 50vw, 600px"
                        quality={95}
                        draggable={false}
                      />
                    </div>
                  </div>
                )
              )}
            </div>
            {hasMoreMedia && !showAllPhotos && (
              <button
                type="button"
                onClick={() => setShowAllPhotos(true)}
                className="hover:underline text-sm mt-1 font-medium"
                style={{ color: "var(--color-primary)" }}
              >
                See All Photos ({allMedia.length})
              </button>
            )}
          </div>
        )}

        {galleryOpen && galleryMedia.length > 0 && galleryItem && (
          <div
            className="fixed inset-0 z-[110] flex items-center justify-center bg-black/90 p-4 overflow-hidden"
            aria-modal="true"
            role="dialog"
            aria-label="Media gallery"
            onClick={() => setGalleryOpen(false)}
          >
            <button
              type="button"
              onClick={() => setGalleryOpen(false)}
              className="absolute top-4 right-4 z-20 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white text-2xl"
              aria-label="Close gallery"
            >
              ×
            </button>
            {galleryMedia.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); if (hasPrev) setGalleryIndex(galleryIndex - 1); }}
                  disabled={!hasPrev}
                  className="absolute left-4 top-1/2 -translate-y-1/2 z-20 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center text-white text-2xl"
                  aria-label="Previous"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); if (hasNext) setGalleryIndex(galleryIndex + 1); }}
                  disabled={!hasNext}
                  className="absolute right-4 top-1/2 -translate-y-1/2 z-20 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center text-white text-2xl"
                  aria-label="Next"
                >
                  ›
                </button>
              </>
            )}
            <div
              className="relative max-w-4xl max-h-[85vh] w-full flex items-center justify-center"
              onClick={(e) => e.stopPropagation()}
            >
              {isVideoUrl(galleryItem) ? (
                <video src={galleryItem} className="max-w-full max-h-[85vh] rounded" controls autoPlay />
              ) : (
                <img
                  key={`${galleryIndex}-${galleryItem}`}
                  src={galleryItem}
                  alt=""
                  className="max-w-full max-h-[85vh] w-auto h-auto object-contain rounded select-none"
                  draggable={false}
                />
              )}
            </div>
            {galleryMedia.length > 1 && (
              <span className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 text-white/80 text-sm">
                {galleryIndex + 1} / {galleryMedia.length}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="border-t flex divide-x">
        {readOnlyInteractions ? (
          <>
            <span className="flex-1 py-2 text-sm font-medium text-gray-500 text-center inline-flex items-center justify-center gap-1.5">
              <LeafLikeIcon className="w-5 h-5 shrink-0 text-gray-400" />
              <span>
                {post.likeCount} like{post.likeCount === 1 ? "" : "s"}
              </span>
            </span>
            <button
              type="button"
              onClick={() => setCommentsOpen((open) => !open)}
              className="flex-1 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 inline-flex items-center justify-center gap-1.5"
              aria-label={
                post.commentCount > 0
                  ? `View comments, ${post.commentCount} comments`
                  : "View comments"
              }
            >
              <IonIcon name="chatbubble-outline" size={20} className="text-gray-500" />
              {post.commentCount > 0 ? (
                <span className="tabular-nums text-gray-600">{post.commentCount}</span>
              ) : null}
            </button>
            <span className="flex-1 py-2 text-sm text-gray-400 text-center">—</span>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onLike(post.id)}
              className={`flex-1 py-2 text-sm font-medium inline-flex items-center justify-center gap-1.5 ${
                post.liked ? "" : "text-gray-600 hover:bg-gray-50"
              }`}
              style={post.liked ? { color: "var(--color-primary)" } : undefined}
              aria-label={
                post.liked
                  ? `Unlike post${post.likeCount > 0 ? `, ${post.likeCount} likes` : ""}`
                  : `Like post${post.likeCount > 0 ? `, ${post.likeCount} likes` : ""}`
              }
            >
              <LeafLikeIcon className="w-5 h-5 shrink-0" />
              {post.likeCount > 0 ? (
                <span className="tabular-nums">{post.likeCount}</span>
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => setCommentsOpen((open) => !open)}
              className="flex-1 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 inline-flex items-center justify-center gap-1.5"
              aria-label={
                post.commentCount > 0
                  ? `Comment, ${post.commentCount} comments`
                  : "Comment"
              }
            >
              <IonIcon name="chatbubble-outline" size={20} className="text-gray-500" />
              {post.commentCount > 0 ? (
                <span className="tabular-nums">{post.commentCount}</span>
              ) : null}
            </button>
            {onShare && (
              <button
                type="button"
                onClick={() => onShare(post.id)}
                className="flex-1 py-2 text-sm text-gray-600 hover:bg-gray-50 inline-flex items-center justify-center gap-1.5"
                aria-label="Share post"
              >
                <IonIcon name="share-outline" size={20} className="text-gray-500" />
              </button>
            )}
          </>
        )}
      </div>
      {readOnlyInteractions && (
        <p className="text-xs text-gray-500 px-3 py-2 border-t bg-gray-50">
          <Link href="/login?callbackUrl=/my-community/feed" className="underline font-medium" style={{ color: "var(--color-link)" }}>
            Sign in
          </Link>{" "}
          to like, comment, or share.
        </p>
      )}
      {commentsOpen && (
        <div className="border-t bg-gray-50 px-4 py-3 space-y-3">
          {commentsLoading ? (
            <p className="text-sm text-gray-500">Loading comments…</p>
          ) : (
            <ul className="space-y-2">
              {comments.map((c) => (
                <li
                  key={c.id}
                  id={`post-comment-${c.id}`}
                  className={`flex gap-2 scroll-mt-24 rounded-lg p-1 -m-1 ${
                    initialCommentId === c.id
                      ? "ring-2 ring-emerald-600/40 bg-emerald-50/80"
                      : ""
                  }`}
                >
                  {c.member.profilePhotoUrl ? (
                    <Image src={c.member.profilePhotoUrl} alt="" width={28} height={28} className="w-7 h-7 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-gray-300 shrink-0 flex items-center justify-center text-xs font-medium text-gray-600">
                      {c.member.firstName?.[0]}{c.member.lastName?.[0]}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <Link
                        href={`/members/${c.member.id}`}
                        className="font-semibold text-gray-900 hover:underline"
                      >
                        {c.member.firstName} {c.member.lastName}
                      </Link>
                      {" "}
                      <span className="text-gray-700">{c.content}</span>
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">{new Date(c.createdAt).toLocaleString()}</p>
                  </div>
                </li>
              ))}
              {comments.length === 0 && <p className="text-sm text-gray-500">No comments yet.</p>}
            </ul>
          )}
          {!readOnlyInteractions && (
            <form onSubmit={submitComment} className="flex gap-2 pt-1">
              <input
                type="text"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Add a comment..."
                className="flex-1 min-w-0 rounded-full border border-gray-300 px-4 py-2 text-sm"
                maxLength={2000}
              />
              <button
                type="submit"
                disabled={submittingComment || !commentText.trim()}
                className="shrink-0 px-4 py-2 rounded-full text-sm font-medium text-white disabled:opacity-50"
                style={{ backgroundColor: "var(--color-primary)" }}
              >
                {submittingComment ? "…" : "Post"}
              </button>
            </form>
          )}
        </div>
      )}
    </article>
  );
}
