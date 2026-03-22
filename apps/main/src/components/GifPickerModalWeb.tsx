"use client";

import { useCallback, useEffect, useState } from "react";

interface GiphyGif {
  id: string;
  images: {
    fixed_height?: { url: string };
    downsized?: { url: string };
    original?: { url: string };
  };
}

function getGifUrl(g: GiphyGif): string {
  return (
    g.images?.fixed_height?.url ??
    g.images?.downsized?.url ??
    g.images?.original?.url ??
    ""
  );
}

async function fetchTrending(): Promise<GiphyGif[]> {
  const res = await fetch("/api/giphy/trending?limit=24", { credentials: "include" });
  const data = (await res.json()) as { data?: GiphyGif[]; error?: string };
  if (!res.ok) throw new Error(data.error ?? "Could not load GIFs");
  return data.data ?? [];
}

async function fetchSearch(q: string, offset = 0): Promise<GiphyGif[]> {
  if (!q.trim()) return [];
  const res = await fetch(
    `/api/giphy/search?q=${encodeURIComponent(q)}&limit=24&offset=${offset}`,
    { credentials: "include" }
  );
  const data = (await res.json()) as { data?: GiphyGif[]; error?: string };
  if (!res.ok) throw new Error(data.error ?? "Search failed");
  return data.data ?? [];
}

type GifPickerModalWebProps = {
  visible: boolean;
  onClose: () => void;
  onSelect: (url: string) => void;
};

export function GifPickerModalWeb({ visible, onClose, onSelect }: GifPickerModalWebProps) {
  const [gifs, setGifs] = useState<GiphyGif[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [offset, setOffset] = useState(0);

  const loadGifs = useCallback(async (query?: string, skip = 0, append = false) => {
    if (!append) setLoading(true);
    else setLoadingMore(true);
    setError(null);
    try {
      const data = query?.trim()
        ? await fetchSearch(query, skip)
        : await fetchTrending();
      setGifs((prev) => (append ? [...prev, ...data] : data));
      setOffset(skip + data.length);
    } catch (e) {
      setError((e as Error).message ?? "Could not load GIFs");
      if (!append) setGifs([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    setSearch("");
    setSearchQuery("");
    setOffset(0);
    setError(null);
    void loadGifs();
  }, [visible, loadGifs]);

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, onClose]);

  if (!visible) return null;

  const handleSearch = () => {
    setSearchQuery(search);
    void loadGifs(search, 0, false);
  };

  const loadMore = () => {
    if (loadingMore || !gifs.length || !searchQuery.trim()) return;
    void loadGifs(searchQuery, offset, true);
  };

  const handleSelect = (g: GiphyGif) => {
    const url = getGifUrl(g);
    if (url) {
      onSelect(url);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Choose a GIF">
      <button
        type="button"
        className="absolute inset-0 bg-black/40 border-0 cursor-default"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="relative w-full max-w-lg max-h-[70vh] sm:max-h-[min(70vh,520px)] bg-white rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col overflow-hidden border-2 border-black">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 shrink-0" style={{ backgroundColor: "var(--color-section-alt)" }}>
          <h2 className="text-lg font-bold text-[var(--color-heading)]">Choose a GIF</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full hover:bg-black/5 text-[var(--color-heading)]"
            aria-label="Close"
          >
            <span className="text-2xl leading-none">&times;</span>
          </button>
        </div>
        <div className="px-3 py-2 flex gap-2 shrink-0 border-b border-gray-100">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Search GIFs…"
            className="flex-1 min-w-0 rounded-full border-2 px-4 py-2 text-sm"
            style={{ borderColor: "var(--color-primary)" }}
          />
          <button
            type="button"
            onClick={handleSearch}
            className="shrink-0 px-4 py-2 rounded-full text-white text-sm font-semibold"
            style={{ backgroundColor: "var(--color-primary)" }}
          >
            Search
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-2">
          {error ? (
            <p className="text-sm text-red-600 px-2 py-4">{error}</p>
          ) : loading && !loadingMore ? (
            <div className="flex justify-center py-16">
              <div className="w-10 h-10 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : gifs.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-8">No GIFs found. Try a different search.</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-1.5">
                {gifs.map((item, index) => {
                  const url = getGifUrl(item);
                  if (!url) return null;
                  return (
                    <button
                      key={`${item.id}-${index}`}
                      type="button"
                      onClick={() => handleSelect(item)}
                      className="aspect-square rounded-lg overflow-hidden border border-gray-200 hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] p-0 bg-gray-100"
                    >
                      <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" />
                    </button>
                  );
                })}
              </div>
              {searchQuery.trim() ? (
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="w-full mt-3 py-2 text-sm font-medium text-[var(--color-primary)] disabled:opacity-50"
                >
                  {loadingMore ? "Loading…" : "Load more"}
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
