"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";

interface Todo {
  id: string;
  text: string;
  completed: boolean;
  order: number;
}

type QueueItem = {
  key: string;
  label: string;
  count: number;
  hrefSuffix: string;
};

export function DashboardTodoList() {
  const router = useRouter();
  const pathname = usePathname();
  const dashboardBase = pathname?.startsWith("/admin/dashboard") ? "/admin/dashboard" : "/dashboard";

  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [newText, setNewText] = useState("");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [dismissing, setDismissing] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    const [qRes, tRes] = await Promise.all([
      fetch("/api/admin/todo-queue", { credentials: "include" }),
      fetch("/api/admin/todos", { credentials: "include" }),
    ]);
    const qData = qRes.ok ? await qRes.json() : [];
    const tData = tRes.ok ? await tRes.json() : [];
    setQueueItems(Array.isArray(qData) ? qData : []);
    setTodos(Array.isArray(tData) ? tData : []);
  }, []);

  useEffect(() => {
    loadAll().finally(() => setLoading(false));
  }, [loadAll]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const text = newText.trim();
    if (!text || adding) return;
    setAdding(true);
    try {
      const res = await fetch("/api/admin/todos", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ text }),
      });
      const todo = await res.json();
      if (res.ok && todo?.id) {
        setTodos((prev) => [...prev, todo]);
        setNewText("");
        router.refresh();
      }
    } finally {
      setAdding(false);
    }
  }

  async function dismissQueueItem(key: string) {
    if (dismissing) return;
    setDismissing(key);
    try {
      const res = await fetch("/api/admin/todo-queue/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ key }),
      });
      if (res.ok) {
        setQueueItems((prev) => prev.filter((i) => i.key !== key));
        router.refresh();
      }
    } finally {
      setDismissing(null);
    }
  }

  async function toggleComplete(id: string, completed: boolean) {
    try {
      const res = await fetch(`/api/admin/todos/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ completed }),
      });
      if (res.ok) {
        setTodos((prev) =>
          prev.map((t) => (t.id === id ? { ...t, completed } : t))
        );
        router.refresh();
      }
    } catch {
      /* ignore */
    }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/admin/todos/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        setTodos((prev) => prev.filter((t) => t.id !== id));
        router.refresh();
      }
    } catch {
      /* ignore */
    }
  }

  if (loading) return <p className="text-gray-500 text-sm">Loading…</p>;

  return (
    <div className="space-y-4">
      {queueItems.length > 0 ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
            Needs review
          </p>
          <ul className="space-y-1">
            {queueItems.map((item) => (
              <li
                key={item.key}
                className="flex flex-wrap items-center gap-2 py-2 border-b border-amber-100 last:border-0 bg-amber-50/50 -mx-1 px-1 rounded"
              >
                <input
                  type="checkbox"
                  checked={false}
                  disabled={dismissing === item.key}
                  onChange={() => dismissQueueItem(item.key)}
                  className="rounded shrink-0"
                  title="Mark as done for now (shows again if new items arrive)"
                  aria-label={`Mark done: ${item.label}`}
                />
                <span className="flex-1 min-w-[12rem] text-sm font-medium text-gray-900">
                  {item.label}
                  <span className="text-gray-600 font-normal"> ({item.count})</span>
                </span>
                <Link
                  href={`${dashboardBase}${item.hrefSuffix}`}
                  className="text-sm font-semibold hover:underline shrink-0"
                  style={{ color: "#505542" }}
                >
                  Review →
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
          Your list
        </p>
        <form onSubmit={handleAdd} className="flex gap-2 mb-2">
          <input
            type="text"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            placeholder="Add to do…"
            className="flex-1 border rounded px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={adding || !newText.trim()}
            className="rounded px-4 py-2 text-sm disabled:opacity-50"
            style={{ backgroundColor: "#505542", color: "#fff" }}
          >
            Add
          </button>
        </form>
        <ul className="space-y-1">
          {todos.map((t) => (
            <li
              key={t.id}
              className="flex items-center gap-2 py-1.5 border-b border-gray-100 last:border-0"
            >
              <input
                type="checkbox"
                checked={t.completed}
                onChange={() => toggleComplete(t.id, !t.completed)}
                className="rounded"
              />
              <span
                className={`flex-1 text-sm ${t.completed ? "line-through text-gray-500" : ""}`}
              >
                {t.text}
              </span>
              <button
                type="button"
                onClick={() => handleDelete(t.id)}
                className="text-red-600 hover:underline text-xs"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
