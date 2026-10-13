"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { IonIcon } from "@/components/IonIcon";
import { listingDisplayPhoto } from "@/lib/listing-display-photo";
import { buildProductHref } from "@/lib/product-referrer";

type CollectionItem = {
  collectionItemId: string;
  id: string;
  title: string;
  slug: string;
  photos: string[];
  priceCents: number;
  quantity: number;
  status: string;
  business?: { name: string; slug: string } | null;
};

type CollectionDetail = {
  id: string;
  name: string;
  description: string | null;
  isPublic: boolean;
  isOwner: boolean;
  ownerName: string;
  items: CollectionItem[];
};

export default function CollectionDetailPage() {
  const params = useParams();
  const id = typeof params?.id === "string" ? params.id : "";
  const router = useRouter();
  const { status } = useSession();
  const [collection, setCollection] = useState<CollectionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPublic, setEditPublic] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/collections/${encodeURIComponent(id)}`, {
        credentials: "include",
      });
      if (!res.ok) {
        setError(res.status === 404 ? "Collection not found." : "Could not load collection.");
        setCollection(null);
        return;
      }
      const data = (await res.json()) as CollectionDetail;
      setCollection(data);
      setEditName(data.name);
      setEditDescription(data.description ?? "");
      setEditPublic(data.isPublic);
    } catch {
      setError("Could not load collection.");
      setCollection(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function removeItem(collectionItemId: string) {
    if (!collection?.isOwner) return;
    setBusyId(collectionItemId);
    try {
      const res = await fetch(
        `/api/collections/${encodeURIComponent(id)}/items/${encodeURIComponent(collectionItemId)}`,
        { method: "DELETE", credentials: "include" }
      );
      if (!res.ok) {
        setError("Could not remove item.");
        return;
      }
      setCollection((prev) =>
        prev
          ? { ...prev, items: prev.items.filter((i) => i.collectionItemId !== collectionItemId) }
          : prev
      );
    } catch {
      setError("Could not remove item.");
    } finally {
      setBusyId(null);
    }
  }

  async function saveEdits(e: React.FormEvent) {
    e.preventDefault();
    if (!collection?.isOwner) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/collections/${encodeURIComponent(id)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          description: editDescription.trim() || null,
          isPublic: editPublic,
        }),
      });
      if (!res.ok) {
        setError("Could not save changes.");
        return;
      }
      const updated = (await res.json()) as Partial<CollectionDetail>;
      setCollection((prev) =>
        prev
          ? {
              ...prev,
              name: updated.name ?? editName.trim(),
              description: updated.description ?? (editDescription.trim() || null),
              isPublic: updated.isPublic ?? editPublic,
            }
          : prev
      );
      setEditing(false);
    } catch {
      setError("Could not save changes.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteCollection() {
    if (!collection?.isOwner) return;
    if (!window.confirm(`Delete “${collection.name}”? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/collections/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        setError("Could not delete collection.");
        return;
      }
      router.push("/my-community/collections");
    } catch {
      setError("Could not delete collection.");
    }
  }

  if (loading || status === "loading") {
    return (
      <div>
        <p className="text-gray-500">Loading…</p>
      </div>
    );
  }

  if (error && !collection) {
    return (
      <div>
        <Link
          href="/my-community/collections"
          className="inline-flex items-center gap-2 text-sm font-medium mb-4 hover:underline"
          style={{ color: "var(--color-primary)" }}
        >
          <IonIcon name="arrow-back" size={18} />
          My Collections
        </Link>
        <p className="text-red-700">{error}</p>
      </div>
    );
  }

  if (!collection) return null;

  return (
    <div>
      <Link
        href="/my-community/collections"
        className="inline-flex items-center gap-2 text-sm font-medium mb-4 hover:underline"
        style={{ color: "var(--color-primary)" }}
      >
        <IonIcon name="arrow-back" size={18} />
        My Collections
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">{collection.name}</h1>
          <p className="text-sm text-neutral-500 mt-0.5">
            {collection.items.length} {collection.items.length === 1 ? "item" : "items"}
            {collection.isPublic ? " · Public" : " · Private"}
            {!collection.isOwner ? ` · by ${collection.ownerName}` : ""}
          </p>
          {collection.description ? (
            <p className="text-sm text-neutral-600 mt-2">{collection.description}</p>
          ) : null}
        </div>
        {collection.isOwner ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn text-sm px-3 py-1.5" onClick={() => setEditing((v) => !v)}>
              {editing ? "Cancel" : "Edit"}
            </button>
            <button
              type="button"
              className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-semibold text-red-800"
              onClick={() => void deleteCollection()}
            >
              Delete
            </button>
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {editing && collection.isOwner ? (
        <form
          onSubmit={(e) => void saveEdits(e)}
          className="mb-6 rounded-lg border-2 bg-white p-4 space-y-3 max-w-lg"
          style={{ borderColor: "var(--color-primary)" }}
        >
          <label className="block">
            <span className="text-sm font-medium">Name</span>
            <input
              className="mt-1 w-full border rounded px-3 py-2"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              required
              maxLength={100}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Description</span>
            <textarea
              className="mt-1 w-full border rounded px-3 py-2"
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              rows={2}
              maxLength={500}
            />
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="rounded"
              checked={editPublic}
              onChange={(e) => setEditPublic(e.target.checked)}
            />
            <span className="text-sm">Public collection</span>
          </label>
          <button type="submit" className="btn" disabled={saving || !editName.trim()}>
            {saving ? "Saving…" : "Save"}
          </button>
        </form>
      ) : null}

      {collection.items.length === 0 ? (
        <p className="text-gray-600 mt-4">
          No items yet. Browse the{" "}
          <Link href="/storefront" className="text-[var(--color-link)] hover:underline">
            storefront
          </Link>{" "}
          and use the bookmark icon to add listings here.
        </p>
      ) : (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {collection.items.map((item) => {
            const photo =
              listingDisplayPhoto(item.photos[0] ?? null, "card") ?? item.photos[0] ?? null;
            const href = buildProductHref(item.slug, {
              type: "collection",
              collectionId: collection.id,
            });
            return (
              <div
                key={item.collectionItemId}
                className="border rounded-lg overflow-hidden hover:shadow-md transition relative bg-white"
              >
                {collection.isOwner ? (
                  <button
                    type="button"
                    className="absolute top-2 right-2 z-10 rounded-full bg-white/90 border px-2 py-1 text-xs font-semibold text-neutral-700 hover:bg-white disabled:opacity-50"
                    disabled={busyId === item.collectionItemId}
                    onClick={() => void removeItem(item.collectionItemId)}
                  >
                    Remove
                  </button>
                ) : null}
                <Link href={href} className="block aspect-square bg-[#F8F8F3]">
                  {photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photo} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-neutral-300">
                      <IonIcon name="image-outline" size={28} />
                    </div>
                  )}
                </Link>
                <div className="p-3">
                  <Link href={href} className="font-semibold hover:underline line-clamp-2">
                    {item.title}
                  </Link>
                  <p className="text-sm font-medium mt-1">${(item.priceCents / 100).toFixed(2)}</p>
                  {item.business ? (
                    <p className="text-xs text-neutral-500 mt-0.5 truncate">{item.business.name}</p>
                  ) : null}
                  {item.status !== "active" || item.quantity <= 0 ? (
                    <p className="text-xs text-amber-800 mt-1">
                      {item.status !== "active" ? "Unavailable" : "Out of stock"}
                    </p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
