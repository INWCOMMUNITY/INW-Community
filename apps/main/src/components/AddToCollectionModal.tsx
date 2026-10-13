"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { createPortal } from "react-dom";
import { IonIcon } from "@/components/IonIcon";

type CollectionSummary = {
  id: string;
  name: string;
  itemCount: number;
};

type Props = {
  open: boolean;
  onClose: () => void;
  storeItemId: string;
  storeItemTitle: string;
};

/**
 * Pick or create a buyer collection and add a store listing to it.
 */
export function AddToCollectionModal({ open, onClose, storeItemId, storeItemTitle }: Props) {
  const { status } = useSession();
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/collections", { credentials: "include" });
      if (!res.ok) {
        setCollections([]);
        return;
      }
      const data = (await res.json()) as CollectionSummary[];
      setCollections(Array.isArray(data) ? data : []);
    } catch {
      setCollections([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setShowCreate(false);
    setNewName("");
    setSuccess(null);
    setError(null);
    if (status === "authenticated") void load();
    else setLoading(false);
  }, [open, status, load]);

  async function handleAdd(collectionId: string) {
    setAddingId(collectionId);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/collections/${collectionId}/items`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeItemId }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.status === 409) {
        setError("This item is already in that collection.");
        return;
      }
      if (!res.ok) {
        setError(body.error ?? "Could not add to collection.");
        return;
      }
      setCollections((prev) =>
        prev.map((c) =>
          c.id === collectionId ? { ...c, itemCount: c.itemCount + 1 } : c
        )
      );
      setSuccess(`Added to collection.`);
      window.setTimeout(() => onClose(), 700);
    } catch {
      setError("Could not add to collection.");
    } finally {
      setAddingId(null);
    }
  }

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/collections", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as CollectionSummary & { error?: string };
      if (!res.ok) {
        setError(typeof body.error === "string" ? body.error : "Could not create collection.");
        return;
      }
      setCollections((prev) => [
        { id: body.id, name: body.name, itemCount: body.itemCount ?? 0 },
        ...prev,
      ]);
      setShowCreate(false);
      setNewName("");
      await handleAdd(body.id);
    } catch {
      setError("Could not create collection.");
    } finally {
      setCreating(false);
    }
  }

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[10050] flex items-center justify-center p-4 bg-black/50"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="relative w-full max-w-md min-w-0 overflow-hidden rounded-[12px] bg-white p-5 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-to-collection-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <h3
              id="add-to-collection-title"
              className="text-lg font-semibold"
              style={{ color: "var(--color-heading)" }}
            >
              Save to collection
            </h3>
            <p className="mt-0.5 text-sm text-neutral-600 line-clamp-2">{storeItemTitle}</p>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-full p-1 text-neutral-500 hover:bg-neutral-100"
            aria-label="Close"
            onClick={onClose}
          >
            <IonIcon name="close-outline" size={22} />
          </button>
        </div>

        {status !== "authenticated" ? (
          <div className="py-4 text-center">
            <p className="text-sm text-neutral-600 mb-4">Sign in to save items to your collections.</p>
            <Link
              href={`/login?callbackUrl=/my-community/collections`}
              className="btn inline-block"
              onClick={onClose}
            >
              Sign in
            </Link>
          </div>
        ) : loading ? (
          <p className="py-6 text-sm text-neutral-500 text-center">Loading…</p>
        ) : (
          <>
            {error ? <p className="mb-3 text-sm text-red-700">{error}</p> : null}
            {success ? <p className="mb-3 text-sm text-emerald-700">{success}</p> : null}

            {!showCreate ? (
              <button
                type="button"
                className="mb-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border-2 px-3 py-2 text-sm font-semibold"
                style={{ borderColor: "var(--color-primary)", color: "var(--color-primary)" }}
                onClick={() => setShowCreate(true)}
              >
                <IonIcon name="add-outline" size={18} />
                New collection
              </button>
            ) : (
              <div className="mb-3 rounded-lg border border-neutral-200 p-3 space-y-2">
                <input
                  className="w-full border rounded px-3 py-2 text-sm"
                  placeholder="Collection name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  autoFocus
                  maxLength={100}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn text-sm px-3 py-1.5"
                    disabled={creating || !newName.trim()}
                    onClick={() => void handleCreate()}
                  >
                    {creating ? "Creating…" : "Create & add"}
                  </button>
                  <button
                    type="button"
                    className="text-sm underline text-neutral-600"
                    onClick={() => {
                      setShowCreate(false);
                      setNewName("");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {collections.length === 0 ? (
              <p className="text-sm text-neutral-500 py-2">
                No collections yet. Create one to start saving items.
              </p>
            ) : (
              <ul className="max-h-64 overflow-y-auto divide-y divide-neutral-100 border rounded-lg">
                {collections.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-[var(--color-section-alt)] disabled:opacity-60"
                      disabled={addingId === c.id}
                      onClick={() => void handleAdd(c.id)}
                    >
                      <span className="min-w-0">
                        <span className="block font-medium text-sm truncate">{c.name}</span>
                        <span className="block text-xs text-neutral-500">
                          {c.itemCount} {c.itemCount === 1 ? "item" : "items"}
                        </span>
                      </span>
                      <span className="text-xs font-semibold shrink-0" style={{ color: "var(--color-primary)" }}>
                        {addingId === c.id ? "Adding…" : "Add"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <p className="mt-3 text-center">
              <Link
                href="/my-community/collections"
                className="text-xs font-semibold underline"
                style={{ color: "var(--color-link)" }}
                onClick={onClose}
              >
                Manage collections
              </Link>
            </p>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
