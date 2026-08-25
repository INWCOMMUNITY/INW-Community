"use client";

import { useState } from "react";
import { LISTING_FEED_COLLECTION_MIN } from "@/lib/listing-feed-collection-constants";

type ShareListingsToFeedPromptProps = {
  open: boolean;
  storeItemIds: string[];
  onClose: () => void;
};

export function shareFeedPromptCopy(count: number): { title: string; body: string } {
  if (count >= LISTING_FEED_COLLECTION_MIN) {
    return {
      title: "Share collection on community feed?",
      body: "This import will appear as one collection on the Community Feed instead of a post for every listing.",
    };
  }
  if (count === 1) {
    return {
      title: "Share your item on the Community Feed?",
      body: "Neighbors who follow you will see this listing in the feed.",
    };
  }
  return {
    title: "Share your items on the Community Feed?",
    body: "Each listing will appear as its own post on the Community Feed.",
  };
}

export function ShareListingsToFeedPrompt({
  open,
  storeItemIds,
  onClose,
}: ShareListingsToFeedPromptProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = shareFeedPromptCopy(storeItemIds.length);

  if (!open || storeItemIds.length === 0) return null;

  async function share() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/store-items/share-to-feed", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeItemIds }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not share to the feed.");
        return;
      }
      onClose();
    } catch {
      setError("Connection failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/50">
      <div
        className="bg-white rounded-xl shadow-xl max-w-md w-full p-6"
        role="dialog"
        aria-labelledby="share-feed-title"
      >
        <h2
          id="share-feed-title"
          className="text-lg font-bold mb-2"
          style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
        >
          {copy.title}
        </h2>
        <p className="text-sm mb-5" style={{ color: "var(--color-text)" }}>
          {copy.body}
        </p>
        {error ? <p className="text-sm text-red-700 mb-3">{error}</p> : null}
        <button
          type="button"
          disabled={busy}
          className="btn w-full mb-3 disabled:opacity-50"
          onClick={() => void share()}
        >
          {busy ? "Sharing…" : "Share"}
        </button>
        <button
          type="button"
          disabled={busy}
          className="w-full py-3 px-4 rounded-lg border-2 font-semibold hover:bg-[var(--color-section-alt)] disabled:opacity-50"
          style={{ borderColor: "var(--color-earth)", color: "var(--color-earth)" }}
          onClick={onClose}
        >
          Not now
        </button>
      </div>
    </div>
  );
}
