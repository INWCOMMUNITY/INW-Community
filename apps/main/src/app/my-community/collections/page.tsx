"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { BackToProfileLink } from "@/components/BackToProfileLink";
import { IonIcon } from "@/components/IonIcon";
import { listingDisplayPhoto } from "@/lib/listing-display-photo";

type PreviewItem = {
  id: string;
  photo: string | null;
  title: string;
};

type Collection = {
  id: string;
  name: string;
  description: string | null;
  isPublic: boolean;
  itemCount: number;
  previewItems: PreviewItem[];
};

export default function MyCollectionsPage() {
  const { status } = useSession();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/collections", { credentials: "include" });
      if (!res.ok) throw new Error("Could not load collections");
      const data = (await res.json()) as Collection[];
      setCollections(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load collections");
      setCollections([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "unauthenticated") {
      setLoading(false);
      return;
    }
    if (status === "authenticated") void load();
  }, [status, load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/collections", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          isPublic,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as Collection & { error?: string };
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "Could not create");
      setCollections((prev) => [body, ...prev]);
      setCreateOpen(false);
      setName("");
      setDescription("");
      setIsPublic(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create collection");
    } finally {
      setCreating(false);
    }
  }

  if (status === "loading" || loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-4">My Collections</h1>
        <p className="text-gray-500">Loading…</p>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return (
      <div>
        <BackToProfileLink />
        <h1 className="text-2xl font-bold mb-4">My Collections</h1>
        <p className="text-gray-600 mb-4">
          Sign in to group storefront items into collections.
        </p>
        <Link href="/login?callbackUrl=/my-community/collections" className="btn">
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div>
      <BackToProfileLink />
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-bold">My Collections</h1>
        <button
          type="button"
          className="btn text-sm px-4 py-2"
          onClick={() => setCreateOpen((v) => !v)}
        >
          {createOpen ? "Cancel" : "New collection"}
        </button>
      </div>
      <p className="text-gray-600 mb-6">
        Save storefront finds into named collections. Use the bookmark on any listing card to add items.
      </p>

      {error ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {createOpen ? (
        <form
          onSubmit={(e) => void handleCreate(e)}
          className="mb-8 rounded-lg border-2 bg-white p-4 space-y-3 max-w-lg"
          style={{ borderColor: "var(--color-primary)" }}
        >
          <label className="block">
            <span className="text-sm font-medium">Name</span>
            <input
              className="mt-1 w-full border rounded px-3 py-2"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
              placeholder="e.g. Kitchen finds"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Description (optional)</span>
            <textarea
              className="mt-1 w-full border rounded px-3 py-2"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={500}
            />
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="rounded"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
            />
            <span className="text-sm">Public collection</span>
          </label>
          <button type="submit" className="btn" disabled={creating || !name.trim()}>
            {creating ? "Creating…" : "Create"}
          </button>
        </form>
      ) : null}

      {collections.length === 0 ? (
        <p className="text-gray-600">
          No collections yet. Create one above, or browse the{" "}
          <Link href="/storefront" className="text-[var(--color-link)] hover:underline">
            storefront
          </Link>{" "}
          and tap the bookmark icon on a card.
        </p>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {collections.map((c) => (
            <li key={c.id}>
              <Link
                href={`/my-community/collections/${c.id}`}
                className="block h-full rounded-lg border-2 bg-white overflow-hidden hover:shadow-md transition"
                style={{ borderColor: "var(--color-primary)" }}
              >
                <div className="grid grid-cols-2 gap-0.5 aspect-[2/1] bg-[var(--color-section-alt)]">
                  {[0, 1, 2, 3].map((i) => {
                    const preview = c.previewItems[i];
                    const photo = preview
                      ? listingDisplayPhoto(preview.photo, "card") ?? preview.photo
                      : null;
                    return (
                      <div key={i} className="relative bg-[#F8F8F3] overflow-hidden">
                        {photo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={photo} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-neutral-300">
                            <IonIcon name="image-outline" size={22} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="p-3">
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold truncate flex-1" style={{ color: "var(--color-heading)" }}>
                      {c.name}
                    </h2>
                    {c.isPublic ? (
                      <span className="text-[10px] uppercase font-semibold tracking-wide text-neutral-500">
                        Public
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    {c.itemCount} {c.itemCount === 1 ? "item" : "items"}
                  </p>
                  {c.description ? (
                    <p className="text-xs text-neutral-600 mt-1 line-clamp-2">{c.description}</p>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
