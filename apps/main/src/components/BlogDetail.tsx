"use client";

import { useState } from "react";
import Link from "next/link";
import { BlogCommentForm } from "./BlogCommentForm";
import { ShareButton } from "./ShareButton";
import { sanitizeHtml } from "@/lib/sanitize";

interface BlogDetailProps {
  blog: {
    id: string;
    slug: string;
    title: string;
    body: string;
    photos: string[];
    status: string;
    createdAt: Date;
    member: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null };
    category: { name: string; slug: string };
    comments: Array<{
      id: string;
      content: string;
      createdAt: Date;
      member: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null };
    }>;
  };
  sessionUserId: string | null;
  initialSaved: boolean;
  initialFollowing?: boolean;
}

export function BlogDetail({ blog, sessionUserId, initialSaved, initialFollowing = false }: BlogDetailProps) {
  const [saved, setSaved] = useState(initialSaved);
  const [following, setFollowing] = useState(initialFollowing);
  const [comments, setComments] = useState(blog.comments);
  const [saving, setSaving] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);

  const date = new Date(blog.createdAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  async function toggleSave() {
    if (!sessionUserId) return;
    setSaving(true);
    try {
      const res = saved
        ? await fetch(`/api/blogs/${blog.id}/save`, { method: "DELETE" })
        : await fetch(`/api/blogs/${blog.id}/save`, { method: "POST" });
      if (res.ok) setSaved(!saved);
    } finally {
      setSaving(false);
    }
  }

  function onCommentAdded(comment: typeof comments[0]) {
    setComments((prev) => [...prev, comment]);
  }

  async function toggleFollow() {
    if (!sessionUserId || followLoading || blog.member.id === sessionUserId) return;
    setFollowLoading(true);
    try {
      const res = await fetch("/api/follow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId: blog.member.id, action: following ? "unfollow" : "follow" }),
      });
      if (res.ok) {
        const data = await res.json();
        setFollowing(data.following);
      }
    } finally {
      setFollowLoading(false);
    }
  }

  return (
    <article className="max-w-3xl">
      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{blog.category.name}</span>
      {((blog as unknown) as { blogTags?: { tag: { id: string; name: string } }[] }).blogTags?.length ? (
        <div className="flex flex-wrap gap-1 mt-2">
          {((blog as unknown) as { blogTags: { tag: { id: string; name: string } }[] }).blogTags.map((bt) => (
            <span key={bt.tag.id} className="text-xs bg-gray-200 rounded px-2 py-0.5">#{bt.tag.name}</span>
          ))}
        </div>
      ) : null}
      <h1 className="text-3xl font-bold mt-1 mb-4">{blog.title}</h1>
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <Link href={`/members/${blog.member.id}`} className="flex items-center gap-2 hover:opacity-80">
          {blog.member.profilePhotoUrl ? (
            <img
              src={blog.member.profilePhotoUrl}
              alt=""
              className="w-10 h-10 rounded-full object-cover"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gray-300 flex items-center justify-center text-sm font-medium text-gray-600">
              {blog.member.firstName?.[0]}{blog.member.lastName?.[0]}
            </div>
          )}
          <span className="font-medium">
            {blog.member.firstName} {blog.member.lastName}
          </span>
        </Link>
        <span className="text-gray-500 text-sm">· {date}</span>
        {sessionUserId && blog.member.id !== sessionUserId && (
          <button
            type="button"
            onClick={toggleFollow}
            disabled={followLoading}
            className="text-sm font-medium border rounded px-3 py-1 hover:bg-gray-100 disabled:opacity-50"
          >
            {followLoading ? "…" : following ? "Following" : "Follow"}
          </button>
        )}
      </div>
      {blog.photos.length > 0 && (
        <div className="space-y-4 mb-6">
          {blog.photos.map((url, i) => (
            <img
              key={i}
              src={url}
              alt=""
              className="w-full rounded-lg object-cover max-h-[400px]"
            />
          ))}
        </div>
      )}
      <div
        className="prose max-w-none mb-8"
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(blog.body.replace(/\n/g, "<br />")) }}
      />
      {sessionUserId && (
        <div className="flex gap-4 items-center mb-8">
          <button
            type="button"
            onClick={toggleSave}
            disabled={saving}
            className="text-sm font-medium hover:underline disabled:opacity-50"
          >
            {saved ? "Saved" : "Save"}
          </button>
          <ShareButton type="blog" id={blog.id} slug={blog.slug} title={blog.title} className="p-2 rounded border border-gray-300 bg-white hover:bg-gray-50" />
        </div>
      )}
      <section className="border-t pt-8">
        <h2 className="text-xl font-bold mb-4">Comments ({comments.length})</h2>
        {sessionUserId && (
          <BlogCommentForm blogId={blog.id} onCommentAdded={onCommentAdded} />
        )}
        <div className="mt-6 space-y-4">
          {comments.map((c) => (
            <div key={c.id} className="flex gap-3">
              {c.member.profilePhotoUrl ? (
                <img
                  src={c.member.profilePhotoUrl}
                  alt=""
                  className="w-8 h-8 rounded-full object-cover shrink-0"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center text-xs font-medium text-gray-600 shrink-0">
                  {c.member.firstName?.[0]}{c.member.lastName?.[0]}
                </div>
              )}
              <div>
                <Link href={`/members/${c.member.id}`} className="font-medium text-sm hover:underline">
                  {c.member.firstName} {c.member.lastName}
                </Link>
                <p className="text-gray-700 text-sm mt-0.5 whitespace-pre-wrap">{c.content}</p>
                <span className="text-xs text-gray-400">
                  {new Date(c.createdAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </article>
  );
}
