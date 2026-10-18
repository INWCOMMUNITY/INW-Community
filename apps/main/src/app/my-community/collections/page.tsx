"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { BackToProfileLink } from "@/components/BackToProfileLink";
import { CollectionShareButton } from "@/components/CollectionShareButton";
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

function CollectionMosaic({
  previewItems,
  large,
}: {
  previewItems: PreviewItem[];
  large?: boolean;
}) {
  const iconSize = large ? 36 : 28;
  return (
    <div className="grid grid-cols-2 gap-1 aspect-[5/4] bg-[var(--color-section-alt)]">
      {[0, 1, 2, 3].map((i) => {
        const preview = previewItems[i];
        const photo = preview
          ? listingDisplayPhoto(preview.photo, "card") ?? preview.photo
          : null;
        return (
          <div
            key={i}
            className="relative overflow-hidden bg-[#F8F4EA]"
          >
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[var(--color-primary)]/25">
                <IonIcon name="bookmark-outline" size={iconSize} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

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
      <div className="rounded-2xl px-4 py-8 sm:px-6" style={{ background: "linear-gradient(180deg, #FDEDCC 0%, #F8F4EA 45%, #ffffff 100%)" }}>
        <h1
          className="text-3xl font-bold mb-3"
          style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
        >
          My Collections
        </h1>
        <p className="text-[var(--color-text)]/70">Loading your finds…</p>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return (
      <div className="rounded-2xl px-4 py-6 sm:px-6" style={{ background: "linear-gradient(180deg, #FDEDCC 0%, #F8F4EA 40%, #ffffff 100%)" }}>
        <BackToProfileLink />
        <h1
          className="text-3xl font-bold mb-3 mt-2"
          style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
        >
          My Collections
        </h1>
        <p className="text-[var(--color-text)] mb-5 max-w-md">
          Sign in to group storefront finds into collections you can revisit anytime.
        </p>
        <Link href="/login?callbackUrl=/my-community/collections" className="btn">
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl px-3 py-5 sm:px-5 sm:py-6"
      style={{ background: "linear-gradient(165deg, #FDEDCC 0%, #F8F4EA 38%, #ffffff 78%)" }}
    >
      <BackToProfileLink />

      <div className="mt-3 mb-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-primary)]/70 mb-1">
            Saved finds
          </p>
          <h1
            className="text-3xl sm:text-4xl font-bold leading-tight"
            style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
          >
            My Collections
          </h1>
        </div>
        <button
          type="button"
          className="btn text-sm px-5 py-2.5 shrink-0 !inline-flex items-center justify-center gap-2 leading-none"
          style={{ display: "inline-flex", alignItems: "center" }}
          onClick={() => setCreateOpen((v) => !v)}
        >
          {createOpen ? (
            <>
              <IonIcon name="close-outline" size={18} className="text-current shrink-0" />
              <span>Cancel</span>
            </>
          ) : (
            <>
              <IonIcon name="book-outline" size={18} className="text-current shrink-0" />
              <span>New Collection</span>
            </>
          )}
        </button>
      </div>
      <p className="text-[var(--color-text)]/80 mb-7 max-w-xl text-[15px] leading-relaxed">
        Gather storefront favorites into named boards. Tap the bookmark on any listing to add it here.
      </p>

      {error ? (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {createOpen ? (
        <form
          onSubmit={(e) => void handleCreate(e)}
          className="mb-8 rounded-2xl border-2 bg-white/90 p-5 space-y-3 max-w-lg shadow-sm"
          style={{ borderColor: "var(--color-primary)" }}
        >
          <p
            className="text-lg font-semibold"
            style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
          >
            Start a collection
          </p>
          <label className="block">
            <span className="text-sm font-medium">Name</span>
            <input
              className="mt-1 w-full border rounded-lg px-3 py-2.5 bg-[#FFFcf7]"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
              placeholder="e.g. Christmas gifts"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Description (optional)</span>
            <textarea
              className="mt-1 w-full border rounded-lg px-3 py-2.5 bg-[#FFFcf7]"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="What are you collecting?"
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
        <div
          className="rounded-2xl border-2 border-dashed px-6 py-12 text-center bg-white/60"
          style={{ borderColor: "color-mix(in srgb, var(--color-primary) 35%, transparent)" }}
        >
          <div
            className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full"
            style={{ background: "var(--color-section-alt)", color: "var(--color-primary)" }}
          >
            <IonIcon name="albums-outline" size={28} />
          </div>
          <p
            className="text-xl font-semibold mb-2"
            style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
          >
            No collections yet
          </p>
          <p className="text-[var(--color-text)]/75 max-w-sm mx-auto mb-5 text-sm leading-relaxed">
            Create one above, or browse the storefront and tap the bookmark on a listing card.
          </p>
          <Link href="/storefront" className="btn-outline text-sm px-4 py-2 inline-block">
            Browse storefront
          </Link>
        </div>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-5 lg:gap-6">
          {collections.map((c) => (
            <li
              key={c.id}
              className="group relative h-full rounded-2xl border-2 bg-white overflow-hidden shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md"
              style={{ borderColor: "var(--color-primary)" }}
            >
              <Link href={`/my-community/collections/${c.id}`} className="block">
                <CollectionMosaic previewItems={c.previewItems} large />
                <div className="p-4 sm:p-5 pb-14">
                  <div className="flex items-start gap-3">
                    <h2
                      className="text-xl sm:text-2xl font-semibold leading-snug flex-1 group-hover:underline decoration-2 underline-offset-4"
                      style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
                    >
                      {c.name}
                    </h2>
                    {c.isPublic ? (
                      <span
                        className="shrink-0 mt-1 rounded-full px-2.5 py-0.5 text-[10px] uppercase font-bold tracking-wide"
                        style={{
                          background: "var(--color-section-alt)",
                          color: "var(--color-primary)",
                        }}
                      >
                        Public
                      </span>
                    ) : (
                      <span className="shrink-0 mt-1 rounded-full bg-neutral-100 px-2.5 py-0.5 text-[10px] uppercase font-bold tracking-wide text-neutral-500">
                        Private
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-medium mt-2" style={{ color: "var(--color-primary)" }}>
                    {c.itemCount} {c.itemCount === 1 ? "item" : "items"}
                  </p>
                  {c.description ? (
                    <p className="text-sm text-[var(--color-text)]/75 mt-1.5 line-clamp-2 leading-relaxed">
                      {c.description}
                    </p>
                  ) : null}
                </div>
              </Link>
              <div className="absolute bottom-3 right-3 z-10">
                <CollectionShareButton
                  collectionId={c.id}
                  name={c.name}
                  isPublic={c.isPublic}
                  onBecamePublic={() =>
                    setCollections((prev) =>
                      prev.map((row) => (row.id === c.id ? { ...row, isPublic: true } : row))
                    )
                  }
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
