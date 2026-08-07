"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { IonIcon } from "@/components/IonIcon";

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

type OGData = { title?: string; description?: string; image?: string };

export function LinkPreviewCard({ url }: { url: string }) {
  const [og, setOg] = useState<OGData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/og-preview?url=${encodeURIComponent(url)}`)
      .then((res) => res.json())
      .then((data: OGData) => {
        if (!cancelled) {
          setOg(data?.title || data?.description || data?.image ? data : null);
        }
      })
      .catch(() => {
        if (!cancelled) setOg(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (loading) {
    return (
      <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 animate-pulse h-20" />
    );
  }

  if (!og) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 block rounded-lg border border-[var(--color-primary)]/30 bg-[#faf8f5] px-3 py-2 text-sm text-[var(--color-primary)] hover:underline truncate"
      >
        {extractDomain(url)}
      </a>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-3 flex gap-3 rounded-lg border border-[var(--color-primary)]/25 bg-white overflow-hidden hover:opacity-95 transition"
    >
      {og.image && (
        <div className="relative w-24 shrink-0 bg-gray-100 min-h-[72px]">
          <Image src={og.image} alt="" fill className="object-cover" sizes="96px" unoptimized />
        </div>
      )}
      <div className="py-2 pr-3 min-w-0 flex-1">
        <p className="text-xs text-gray-500 truncate">{extractDomain(url)}</p>
        {og.title && <p className="font-semibold text-sm line-clamp-2 mt-0.5">{og.title}</p>}
        {og.description && (
          <p className="text-xs text-gray-600 line-clamp-2 mt-1">{og.description}</p>
        )}
        <IonIcon name="open-outline" size={14} className="text-gray-400 mt-1" />
      </div>
    </a>
  );
}
