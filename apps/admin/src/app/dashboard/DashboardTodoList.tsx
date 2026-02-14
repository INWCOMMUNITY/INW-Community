"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const ADMIN_CODE = process.env.NEXT_PUBLIC_ADMIN_CODE ?? "NWC36481";
const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_SITE_URL || "http://localhost:3000";

interface Todo {
  id: string;
  text: string;
  completed: boolean;
  order: number;
}

export function DashboardTodoList() {
  const router = useRouter();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [newText, setNewText] = useState("");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    fetch(`${MAIN_URL}/api/admin/todos`, {
      headers: { "x-admin-code": ADMIN_CODE },
    })
      .then((r) => r.json())
      .then((data) => setTodos(Array.isArray(data) ? data : []))
      .catch(() => setTodos([]))
      .finally(() => setLoading(false));
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const text = newText.trim();
    if (!text || adding) return;
    setAdding(true);
    try {
      const res = await fetch(`${MAIN_URL}/api/admin/todos`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-code": ADMIN_CODE,
        },
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

  async function toggleComplete(id: string, completed: boolean) {
    try {
      const res = await fetch(`${MAIN_URL}/api/admin/todos/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-admin-code": ADMIN_CODE,
        },
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
      const res = await fetch(`${MAIN_URL}/api/admin/todos/${id}`, {
        method: "DELETE",
        headers: { "x-admin-code": ADMIN_CODE },
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
    <div className="space-y-2">
      <form onSubmit={handleAdd} className="flex gap-2">
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
  );
}
