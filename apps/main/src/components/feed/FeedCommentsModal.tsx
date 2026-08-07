"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { IonIcon } from "@/components/IonIcon";
import { GifPickerModalWeb } from "@/components/GifPickerModalWeb";
import { useLockBodyScroll } from "@/lib/scroll-lock";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { getStandaloneGifImageUrl } from "@/lib/message-gif-url";
import type { CommunityFeedPost } from "@/lib/feed-types";

export type FeedCommentItem = {
  id: string;
  parentId?: string | null;
  content: string;
  photos?: string[];
  createdAt: string;
  member: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null };
  likeCount: number;
  liked: boolean;
  parentAuthorName?: string | null;
};

type FeedCommentsModalProps = {
  open: boolean;
  postId: string | null;
  post?: CommunityFeedPost | null;
  highlightCommentId?: string | null;
  onHighlightConsumed?: () => void;
  onClose: () => void;
  onCommentAdded?: (postId: string) => void;
};

function CommentBody({ comment }: { comment: FeedCommentItem }) {
  const gifUrl = comment.photos?.find((u) => getStandaloneGifImageUrl(u) || /\.gif/i.test(u));
  const photoUrl = comment.photos?.find((u) => u !== gifUrl);
  return (
    <>
      {comment.content ? <span className="text-gray-800">{comment.content}</span> : null}
      {gifUrl ? (
        <div className="relative w-full max-w-[200px] h-32 mt-1 rounded-lg overflow-hidden">
          <Image src={gifUrl} alt="" fill className="object-contain" sizes="200px" unoptimized />
        </div>
      ) : null}
      {photoUrl ? (
        <div className="relative w-full max-w-[200px] h-32 mt-1 rounded-lg overflow-hidden">
          <Image src={photoUrl} alt="" fill className="object-cover" sizes="200px" />
        </div>
      ) : null}
    </>
  );
}

function CommentRow({
  comment,
  postId,
  depth,
  onReply,
  onLikeToggle,
  highlightCommentId,
}: {
  comment: FeedCommentItem;
  postId: string;
  depth: number;
  onReply: (parentId: string, parentAuthorName: string) => void;
  onLikeToggle: (commentId: string) => void;
  highlightCommentId?: string | null;
}) {
  const name = `${comment.member.firstName} ${comment.member.lastName}`.trim();
  return (
    <li
      id={`feed-comment-${comment.id}`}
      className={`${depth > 0 ? "ml-6 border-l-2 border-gray-100 pl-3" : ""} ${
        highlightCommentId === comment.id ? "ring-2 ring-[var(--color-primary)]/40 rounded-lg p-1 -m-1" : ""
      }`}
    >
      <div className="flex gap-2">
        {comment.member.profilePhotoUrl ? (
          <Image
            src={comment.member.profilePhotoUrl}
            alt=""
            width={32}
            height={32}
            className="w-8 h-8 rounded-full object-cover shrink-0"
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-gray-200 shrink-0 flex items-center justify-center text-xs font-medium">
            {comment.member.firstName?.[0]}
            {comment.member.lastName?.[0]}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm">
            <Link href={`/members/${comment.member.id}`} className="font-semibold hover:underline">
              {name}
            </Link>
            {comment.parentAuthorName && depth > 0 ? (
              <span className="text-gray-500 text-xs ml-1">· replying to {comment.parentAuthorName}</span>
            ) : null}
          </p>
          <CommentBody comment={comment} />
          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
            <span>{formatRelativeTime(comment.createdAt)}</span>
            <button
              type="button"
              onClick={() => onLikeToggle(comment.id)}
              className={`font-medium ${comment.liked ? "text-[var(--color-primary)]" : "hover:text-gray-700"}`}
            >
              {comment.liked ? "Liked" : "Like"}
              {comment.likeCount > 0 ? ` · ${comment.likeCount}` : ""}
            </button>
            {depth === 0 ? (
              <button
                type="button"
                onClick={() => onReply(comment.id, name)}
                className="font-medium hover:text-gray-700"
              >
                Reply
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </li>
  );
}

export function FeedCommentsModal({
  open,
  postId,
  post,
  highlightCommentId,
  onHighlightConsumed,
  onClose,
  onCommentAdded,
}: FeedCommentsModalProps) {
  const [comments, setComments] = useState<FeedCommentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(null);
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  const [highlightDone, setHighlightDone] = useState(false);

  useLockBodyScroll(open);

  useEffect(() => {
    if (!open || !postId) return;
    setLoading(true);
    setReplyTo(null);
    setText("");
    fetch(`/api/posts/${postId}/comments`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => setComments(Array.isArray(data?.comments) ? data.comments : []))
      .catch(() => setComments([]))
      .finally(() => setLoading(false));
  }, [open, postId]);

  useEffect(() => {
    if (!highlightCommentId || loading || highlightDone) return;
    const t = window.setTimeout(() => {
      document.getElementById(`feed-comment-${highlightCommentId}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      setHighlightDone(true);
      onHighlightConsumed?.();
    }, 150);
    return () => window.clearTimeout(t);
  }, [highlightCommentId, loading, comments, highlightDone, onHighlightConsumed]);

  useEffect(() => {
    if (!open) setHighlightDone(false);
  }, [open]);

  const threaded = useMemo(() => {
    const tops = comments.filter((c) => !c.parentId);
    const repliesByParent = new Map<string, FeedCommentItem[]>();
    for (const c of comments) {
      if (!c.parentId) continue;
      const list = repliesByParent.get(c.parentId) ?? [];
      list.push(c);
      repliesByParent.set(c.parentId, list);
    }
    return tops.map((top) => ({ top, replies: repliesByParent.get(top.id) ?? [] }));
  }, [comments]);

  async function submitContent(payload: { content: string; photos?: string[]; parentId?: string }) {
    if (!postId || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/posts/${postId}/comments`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data?.id) {
        setComments((prev) => [
          ...prev,
          {
            id: data.id,
            parentId: data.parentId ?? payload.parentId ?? null,
            content: data.content ?? payload.content,
            photos: data.photos ?? payload.photos ?? [],
            createdAt: data.createdAt ?? new Date().toISOString(),
            member: data.member,
            likeCount: 0,
            liked: false,
            parentAuthorName: replyTo?.name ?? null,
          },
        ]);
        setText("");
        setReplyTo(null);
        onCommentAdded?.(postId);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || !postId) return;
    await submitContent({
      content: trimmed,
      parentId: replyTo?.id,
    });
  }

  async function submitGif(url: string) {
    setGifPickerOpen(false);
    await submitContent({
      content: "",
      photos: [url],
      parentId: replyTo?.id,
    });
  }

  async function toggleCommentLike(commentId: string) {
    if (!postId) return;
    const prev = comments.find((c) => c.id === commentId);
    if (!prev) return;
    setComments((list) =>
      list.map((c) =>
        c.id === commentId
          ? {
              ...c,
              liked: !c.liked,
              likeCount: c.likeCount + (c.liked ? -1 : 1),
            }
          : c
      )
    );
    const res = await fetch(
      `/api/posts/${postId}/comments/${encodeURIComponent(commentId)}/like`,
      { method: "POST", credentials: "include" }
    );
    if (res.ok) {
      const data = await res.json();
      setComments((list) =>
        list.map((c) =>
          c.id === commentId
            ? {
                ...c,
                liked: data.liked,
                likeCount: prev.likeCount + (data.liked ? 1 : -1),
              }
            : c
        )
      );
    } else {
      setComments((list) =>
        list.map((c) => (c.id === commentId ? prev : c))
      );
    }
  }

  if (!open || !postId) return null;

  const authorName = post
    ? `${post.author.firstName} ${post.author.lastName}`.trim()
    : "Post";

  return (
    <>
      <div
        className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
        role="presentation"
        onClick={onClose}
      >
        <div
          className="w-full sm:max-w-lg max-h-[85vh] flex flex-col rounded-t-xl sm:rounded-xl bg-white shadow-xl"
          role="dialog"
          aria-modal="true"
          aria-label="Comments"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="font-bold text-lg">Comments</h2>
            <button type="button" onClick={onClose} className="p-2 rounded-full hover:bg-gray-100" aria-label="Close">
              <IonIcon name="close" size={22} />
            </button>
          </div>

          {post && (
            <div className="px-4 py-3 border-b bg-[#faf8f5] text-sm">
              <p className="font-semibold">{authorName}</p>
              {post.content && <p className="text-gray-700 line-clamp-3 mt-1">{post.content}</p>}
              {post.photos[0] && (
                <div className="relative w-full h-32 mt-2 rounded-lg overflow-hidden">
                  <Image src={post.photos[0]} alt="" fill className="object-cover" sizes="400px" />
                </div>
              )}
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-4 py-3 min-h-[120px]">
            {loading ? (
              <p className="text-sm text-gray-500">Loading comments…</p>
            ) : comments.length === 0 ? (
              <p className="text-sm text-gray-500">No comments yet.</p>
            ) : (
              <ul className="space-y-4">
                {threaded.map(({ top, replies }) => (
                  <div key={top.id} className="space-y-3">
                    <CommentRow
                      comment={top}
                      postId={postId}
                      depth={0}
                      onReply={(id, name) => setReplyTo({ id, name })}
                      onLikeToggle={toggleCommentLike}
                      highlightCommentId={highlightCommentId}
                    />
                    {replies.map((r) => (
                      <CommentRow
                        key={r.id}
                        comment={r}
                        postId={postId}
                        depth={1}
                        onReply={() => {}}
                        onLikeToggle={toggleCommentLike}
                        highlightCommentId={highlightCommentId}
                      />
                    ))}
                  </div>
                ))}
              </ul>
            )}
          </div>

          {replyTo && (
            <div className="px-4 py-2 border-t bg-gray-50 text-xs flex items-center justify-between">
              <span>
                Replying to <strong>{replyTo.name}</strong>
              </span>
              <button type="button" className="text-[var(--color-primary)] font-medium" onClick={() => setReplyTo(null)}>
                Cancel
              </button>
            </div>
          )}

          <form onSubmit={submit} className="border-t p-3 flex gap-2 items-center">
            <button
              type="button"
              onClick={() => setGifPickerOpen(true)}
              className="shrink-0 p-2 rounded-full hover:bg-gray-100 text-gray-600"
              aria-label="Add GIF"
            >
              <IonIcon name="images-outline" size={22} />
            </button>
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={replyTo ? "Write a reply…" : "Add a comment…"}
              className="flex-1 min-w-0 rounded-full border border-gray-300 px-4 py-2 text-sm"
              maxLength={2000}
            />
            <button
              type="submit"
              disabled={submitting || !text.trim()}
              className="shrink-0 px-4 py-2 rounded-full text-sm font-medium text-white bg-[var(--color-primary)] disabled:opacity-50"
            >
              Post
            </button>
          </form>
        </div>
      </div>

      <GifPickerModalWeb visible={gifPickerOpen} onClose={() => setGifPickerOpen(false)} onSelect={submitGif} />
    </>
  );
}
