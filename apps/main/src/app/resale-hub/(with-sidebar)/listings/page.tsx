"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";

interface StoreItem {
  id: string;
  title: string;
  slug: string;
  photos: string[];
  priceCents: number;
  quantity: number;
  status: string;
  category: string | null;
  createdAt: string;
}

export default function ResaleHubListingsPage() {
  const [items, setItems] = useState<StoreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);

  function load() {
    setLoading(true);
    fetch("/api/store-items?mine=1&listingType=resale")
      .then((r) => r.json())
      .then((data) => setItems(Array.isArray(data) ? data : []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  async function markAsSold(id: string) {
    setActingId(id);
    try {
      const res = await fetch(`/api/store-items/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "sold_out" }),
      });
      if (res.ok) {
        setItems((prev) => prev.filter((i) => i.id !== id));
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "Failed to mark as sold");
      }
    } finally {
      setActingId(null);
    }
  }

  async function deleteItem(id: string) {
    if (!confirm("Remove this listing? This cannot be undone.")) return;
    setActingId(id);
    try {
      const res = await fetch(`/api/store-items/${id}`, { method: "DELETE" });
      if (res.ok) {
        setItems((prev) => prev.filter((i) => i.id !== id));
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "Failed to delete");
      }
    } finally {
      setActingId(null);
    }
  }

  if (loading) return <p className="text-gray-500">Loading your listings…</p>;

  return (
    <div className="w-full max-md:mx-auto max-md:max-w-[var(--max-width)]">
      <h1 className="text-2xl font-bold mb-6 max-md:text-center">My Listings</h1>
      {items.length === 0 ? (
        <p className="text-gray-600 mb-6 max-md:text-center">
          You don&apos;t have any resale listings yet.{" "}
          <Link href="/resale-hub/list" className="text-primary-600 hover:underline font-medium">
            List an item
          </Link>
          .
        </p>
      ) : (
        <ul className="space-y-4 w-full">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center gap-4 p-4 border border-gray-200 rounded-lg bg-white w-full min-w-0"
            >
              <div className="h-20 w-20 shrink-0 rounded overflow-hidden bg-gray-100">
                {item.photos?.length > 0 ? (
                  <Image
                    src={item.photos[0]}
                    alt=""
                    width={80}
                    height={80}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="h-full w-full flex items-center justify-center text-gray-400 text-xs">
                    No photo
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1 overflow-hidden">
                <p className="font-medium text-gray-900 truncate">{item.title}</p>
                <p className="text-sm text-gray-500">
                  ${(item.priceCents / 100).toFixed(2)}
                  {item.category ? ` · ${item.category}` : ""}
                </p>
                <p className="text-xs text-gray-400 capitalize">{item.status.replace("_", " ")}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/resale-hub/list?edit=${item.id}`}
                  className="inline-block px-3 py-1.5 text-sm font-medium rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                >
                  Edit
                </Link>
                {item.status === "active" && (
                  <button
                    type="button"
                    onClick={() => markAsSold(item.id)}
                    disabled={actingId === item.id}
                    className="px-3 py-1.5 text-sm font-medium rounded border border-green-600 text-green-700 hover:bg-green-50 disabled:opacity-50"
                  >
                    {actingId === item.id ? "Updating…" : "Mark as sold"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => deleteItem(item.id)}
                  disabled={actingId === item.id}
                  className="px-3 py-1.5 text-sm font-medium rounded border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Link
        href="/resale-hub"
        className="text-[var(--color-link)] hover:underline mt-6 inline-block max-md:block max-md:text-center"
      >
        ← Back to Resale Hub
      </Link>
    </div>
  );
}
