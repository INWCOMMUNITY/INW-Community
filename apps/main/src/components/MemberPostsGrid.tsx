"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type PostRow = {
  id: string;
  photos: string[];
};

export function MemberPostsGrid({ memberId }: { memberId: string }) {
  const [cells, setCells] = useState<{ key: string; postId: string; url: string }[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/members/${memberId}/posts?limit=30`, { credentials: "include" })
      .then((r) => r.json())
      .then((d: { posts?: PostRow[] }) => {
        if (cancelled) return;
        const posts = Array.isArray(d.posts) ? d.posts : [];
        const next: { key: string; postId: string; url: string }[] = [];
        for (const p of posts) {
          const photos = p.photos ?? [];
          photos.forEach((url, i) => {
            if (url) next.push({ key: `${p.id}-${i}`, postId: p.id, url });
          });
        }
        setCells(next);
      })
      .catch(() => setCells([]));
    return () => {
      cancelled = true;
    };
  }, [memberId]);

  if (cells.length === 0) return null;

  return (
    <div className="mt-10 max-w-4xl">
      <h2 className="text-xl font-bold mb-4" style={{ color: "var(--color-heading)" }}>
        Photos from posts
      </h2>
      <div className="grid grid-cols-3 gap-1 sm:gap-2">
        {cells.map((c) => (
          <Link
            key={c.key}
            href="/my-community/feed"
            className="aspect-square overflow-hidden rounded-md bg-gray-100 block focus:ring-2 focus:ring-offset-1 focus:outline-none"
            style={{ outlineColor: "var(--color-section-alt)" }}
            title="View community feed"
          >
            <img src={c.url} alt="" className="w-full h-full object-cover" />
          </Link>
        ))}
      </div>
    </div>
  );
}
