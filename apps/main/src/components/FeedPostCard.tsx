"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useLockBodyScroll } from "@/lib/scroll-lock";

const TRUNCATE_LENGTH = 200;

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
}

function isVideoUrl(url: string) {
  return /\.(mp4|webm|mov)$/i.test(url);
}

type CommentItem = {
  id: string;
  content: string;
  createdAt: string;
  member: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null };
  likeCount: number;
  liked: boolean;
  parentAuthorName?: string | null;
};

export function FeedPostCard({ post, onLike, onShare, onCommentAdded }: FeedPostCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [showAllPhotos, setShowAllPhotos] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryMedia, setGalleryMedia] = useState<string[]>([]);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [commentsOpen, setCommentsOpen] = useState(false);
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
          <div className="shrink-0 flex gap-1">
            {/* Member badges placeholder - can add logic later */}
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
        {post.type === "shared_business" && post.sourceBusiness && (
          <div className="border rounded p-4 bg-gray-50 mb-3">
            <Link href={`/support-local/${post.sourceBusiness.slug}`} className="block hover:opacity-90">
              <div className="flex gap-3">
                {post.sourceBusiness.logoUrl && (
                  <Image src={post.sourceBusiness.logoUrl} alt="" width={64} height={64} className="w-16 h-16 object-cover rounded" quality={95} />
                )}
                <div>
                  <h3 className="font-bold">{post.sourceBusiness.name}</h3>
                  {post.sourceBusiness.shortDescription && (
                    <p className="text-gray-700 text-sm mt-1 line-clamp-2">{post.sourceBusiness.shortDescription}</p>
                  )}
                </div>
              </div>
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
            {post.sourcePost.type === "shared_business" && post.sourcePost.sourceBusiness && (
              <div className="border rounded p-3 bg-white mb-2">
                <Link href={`/support-local/${post.sourcePost.sourceBusiness.slug}`} className="block hover:opacity-90">
                  <div className="flex gap-2">
                    {post.sourcePost.sourceBusiness.logoUrl && (
                      <Image src={post.sourcePost.sourceBusiness.logoUrl} alt="" width={48} height={48} className="w-12 h-12 object-cover rounded" quality={95} />
                    )}
                    <div>
                      <h3 className="font-bold text-sm">{post.sourcePost.sourceBusiness.name}</h3>
                      {post.sourcePost.sourceBusiness.shortDescription && (
                        <p className="text-gray-600 text-xs line-clamp-1">{post.sourcePost.sourceBusiness.shortDescription}</p>
                      )}
                    </div>
                  </div>
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
              const sourcePostDisplay = sourcePostMedia.slice(0, 4);
              return (
                <div className="grid grid-cols-2 gap-1">
                  {sourcePostDisplay.map((url, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => openGallery(sourcePostMedia, i)}
                      className="relative aspect-square w-full text-left rounded overflow-hidden focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-gray-400 cursor-zoom-in"
                    >
                      {isVideoUrl(url) ? (
                        <video src={url} className="w-full h-full object-cover pointer-events-none" />
                      ) : (
                        <Image src={url} alt="" fill className="object-cover" sizes="(max-width: 640px) 50vw, 400px" quality={95} />
                      )}
                    </button>
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
              {displayMedia.map((url, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => openGallery(allMedia, i)}
                  className="relative aspect-square w-full text-left rounded overflow-hidden focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-gray-400 cursor-zoom-in"
                >
                  {isVideoUrl(url) ? (
                    <video src={url} className="w-full h-full object-cover pointer-events-none" />
                  ) : (
                    <Image src={url} alt="" fill className="object-cover" sizes="(max-width: 640px) 50vw, 600px" quality={95} />
                  )}
                </button>
              ))}
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
                <img src={galleryItem} alt="" className="max-w-full max-h-[85vh] object-contain rounded" />
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
        <button
          type="button"
          onClick={() => onLike(post.id)}
          className={`flex-1 py-2 text-sm font-medium ${post.liked ? "" : "text-gray-600 hover:bg-gray-50"}`}
          style={post.liked ? { color: "var(--color-primary)" } : undefined}
        >
          Like {post.likeCount > 0 && `(${post.likeCount})`}
        </button>
        <button
          type="button"
          onClick={() => setCommentsOpen((open) => !open)}
          className="flex-1 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
        >
          Comment {post.commentCount > 0 && `(${post.commentCount})`}
        </button>
        {onShare && (
          <button
            type="button"
            onClick={() => onShare(post.id)}
            className="flex-1 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            Share
          </button>
        )}
      </div>
      {commentsOpen && (
        <div className="border-t bg-gray-50 px-4 py-3 space-y-3">
          {commentsLoading ? (
            <p className="text-sm text-gray-500">Loading comments…</p>
          ) : (
            <ul className="space-y-2">
              {comments.map((c) => (
                <li key={c.id} className="flex gap-2">
                  {c.member.profilePhotoUrl ? (
                    <Image src={c.member.profilePhotoUrl} alt="" width={28} height={28} className="w-7 h-7 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-gray-300 shrink-0 flex items-center justify-center text-xs font-medium text-gray-600">
                      {c.member.firstName?.[0]}{c.member.lastName?.[0]}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <span className="font-semibold text-gray-900">{c.member.firstName} {c.member.lastName}</span>
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
        </div>
      )}
    </article>
  );
}
