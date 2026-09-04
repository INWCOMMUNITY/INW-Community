"use client";

import { adminFetch } from "@/lib/admin-fetch";

import { useState, useEffect, useCallback } from "react";

const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_SITE_URL || "http://localhost:3000";

interface Comment {
  id: string;
  content: string;
  createdAt: string;
  author: { id: string; firstName: string; lastName: string };
  post: { id: string; contentPreview: string };
}

export default function CommentsPage() {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [deleting, setDeleting] = useState<string | null>(null);
  const limit = 50;

  const fetchComments = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (search) params.set("search", search);
      const res = await adminFetch(`${MAIN_URL}/api/admin/comments?${params}`);
      const data = await res.json();
      setComments(data.comments ?? []);
      setTotal(data.total ?? 0);
    } catch {
      setComments([]);
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  async function deleteComment(id: string) {
    if (!confirm("Delete this comment permanently?")) return;
    setDeleting(id);
    try {
      const res = await adminFetch(`${MAIN_URL}/api/admin/comments`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commentId: id }),
      });
      if (res.ok) {
        setComments((prev) => prev.filter((c) => c.id !== id));
        setTotal((t) => t - 1);
      }
    } catch {
      // Ignore
    } finally {
      setDeleting(null);
    }
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Comments</h1>
      <p className="text-gray-600 mb-4">
        Browse and moderate community comments.
      </p>

      <div className="mb-4 flex gap-2">
        <input
          type="text"
          placeholder="Search by member name or keyword…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="border rounded px-3 py-2 flex-1 max-w-md"
        />
      </div>

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : comments.length === 0 ? (
        <p className="text-gray-500">No comments found.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 px-3 font-medium text-gray-600">Author</th>
                  <th className="py-2 px-3 font-medium text-gray-600">Content</th>
                  <th className="py-2 px-3 font-medium text-gray-600">Post</th>
                  <th className="py-2 px-3 font-medium text-gray-600">Date</th>
                  <th className="py-2 px-3 font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody>
                {comments.map((c) => (
                  <tr key={c.id} className="border-b hover:bg-gray-50">
                    <td className="py-2 px-3 whitespace-nowrap">
                      {c.author.firstName} {c.author.lastName}
                    </td>
                    <td className="py-2 px-3 max-w-xs truncate" title={c.content}>
                      {c.content.length > 100 ? c.content.slice(0, 100) + "…" : c.content}
                    </td>
                    <td className="py-2 px-3 max-w-[160px] truncate text-gray-500" title={c.post.contentPreview}>
                      {c.post.contentPreview || "—"}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap text-gray-500">
                      {new Date(c.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-2 px-3">
                      <button
                        type="button"
                        onClick={() => deleteComment(c.id)}
                        disabled={deleting === c.id}
                        className="text-red-600 hover:underline disabled:opacity-50 text-sm"
                      >
                        {deleting === c.id ? "Deleting…" : "Delete"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center gap-2 mt-4">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 border rounded text-sm disabled:opacity-50"
              >
                Previous
              </button>
              <span className="text-sm text-gray-600">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 border rounded text-sm disabled:opacity-50"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
