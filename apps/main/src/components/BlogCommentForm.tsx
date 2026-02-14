"use client";

import { useState } from "react";
import { getErrorMessage } from "@/lib/api-error";

interface BlogCommentFormProps {
  blogId: string;
  onCommentAdded: (comment: {
    id: string;
    content: string;
    createdAt: Date;
    member: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null };
  }) => void;
}

export function BlogCommentForm({ blogId, onCommentAdded }: BlogCommentFormProps) {
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch(`/api/blogs/${blogId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(getErrorMessage(data.error, "Failed to post comment"));
        return;
      }
      onCommentAdded(data);
      setContent("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mb-6">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        required
        rows={3}
        className="w-full border rounded px-3 py-2 mb-2"
        placeholder="Add a comment…"
      />
      {error && <p className="text-red-600 text-sm mb-2">{error}</p>}
      <button type="submit" className="btn text-sm" disabled={submitting}>
        {submitting ? "Posting…" : "Post comment"}
      </button>
    </form>
  );
}
