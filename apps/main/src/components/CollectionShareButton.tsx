"use client";

import { useEffect, useRef, useState } from "react";
import { IonIcon } from "@/components/IonIcon";

type Props = {
  collectionId: string;
  name: string;
  isPublic: boolean;
  onBecamePublic?: () => void;
};

/**
 * Share a buyer wishlist collection with friends (DM) or copy a public link.
 * Private collections are made public when sharing so recipients can open the link.
 */
export function CollectionShareButton({ collectionId, name, isPublic, onBecamePublic }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showFriendPicker, setShowFriendPicker] = useState(false);
  const [friends, setFriends] = useState<{ id: string; firstName: string; lastName: string }[]>([]);
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const [ensuringPublic, setEnsuringPublic] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const url =
    typeof window !== "undefined"
      ? `${window.location.origin}/my-community/collections/${collectionId}`
      : "";
  const shareTitle = name.trim() || "My collection";

  useEffect(() => {
    if (showFriendPicker && friends.length === 0) {
      fetch("/api/me/friends")
        .then((r) => r.json())
        .then((d) => setFriends(d.friends ?? []))
        .catch(() => setFriends([]));
    }
  }, [showFriendPicker, friends.length]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowFriendPicker(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  async function ensurePublic(): Promise<boolean> {
    if (isPublic) return true;
    setEnsuringPublic(true);
    try {
      const res = await fetch(`/api/collections/${encodeURIComponent(collectionId)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublic: true }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        alert(data.error ?? "Could not make this collection public to share");
        return false;
      }
      onBecamePublic?.();
      return true;
    } finally {
      setEnsuringPublic(false);
    }
  }

  async function handleCopyLink() {
    if (!(await ensurePublic())) return;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleSendToFriend(friendId: string) {
    if (!(await ensurePublic())) return;
    setSendingTo(friendId);
    try {
      const res = await fetch("/api/direct-conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          addresseeId: friendId,
          content: `Check out my collection: ${shareTitle}\n${url}`,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) {
        setShowFriendPicker(false);
        setOpen(false);
      } else {
        alert(data.error ?? "Failed to send");
      }
    } finally {
      setSendingTo(null);
    }
  }

  async function handleNativeShare() {
    if (!navigator.share) return false;
    if (!(await ensurePublic())) return false;
    try {
      await navigator.share({ title: shareTitle, url, text: `Check out my collection: ${shareTitle}` });
      setOpen(false);
      return true;
    } catch {
      return false;
    }
  }

  function toggleOpen(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (open) {
      setOpen(false);
      setShowFriendPicker(false);
      return;
    }
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      void handleNativeShare().then((shared) => {
        if (!shared) setOpen(true);
      });
    } else {
      setOpen(true);
    }
  }

  return (
    <div className="relative" ref={menuRef} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={toggleOpen}
        disabled={ensuringPublic}
        className="inline-flex items-center gap-1.5 rounded-full border-2 bg-white px-3 py-1.5 text-sm font-semibold shadow-sm hover:bg-[var(--color-section-alt)] disabled:opacity-60"
        style={{ borderColor: "var(--color-primary)", color: "var(--color-primary)" }}
        title="Share with friends"
        aria-label={`Share ${shareTitle}`}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <IonIcon name="share-social-outline" size={18} className="text-current" />
        Share
      </button>
      {open ? (
        <div
          className="absolute right-0 bottom-full mb-1 py-1 min-w-[200px] bg-white border border-gray-200 rounded-lg shadow-lg z-50"
          role="menu"
        >
          {!isPublic ? (
            <p className="px-4 py-2 text-xs text-neutral-500 border-b border-gray-100">
              Sharing makes this collection public so friends can view it.
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => void handleCopyLink()}
            className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100"
            role="menuitem"
          >
            {copied ? "Copied!" : "Copy link"}
          </button>
          {!showFriendPicker ? (
            <button
              type="button"
              onClick={() => setShowFriendPicker(true)}
              className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 border-t border-gray-100"
              role="menuitem"
            >
              Send to a friend
            </button>
          ) : (
            <div className="border-t border-gray-100 max-h-48 overflow-y-auto">
              <button
                type="button"
                onClick={() => setShowFriendPicker(false)}
                className="w-full text-left px-4 py-1.5 text-xs text-gray-500 hover:bg-gray-100"
              >
                ← Back
              </button>
              {friends.length === 0 ? (
                <p className="px-4 py-2 text-sm text-gray-500">No friends yet</p>
              ) : (
                friends.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => void handleSendToFriend(f.id)}
                    disabled={sendingTo !== null || ensuringPublic}
                    className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 disabled:opacity-60"
                    role="menuitem"
                  >
                    {sendingTo === f.id ? "Sending…" : `${f.firstName} ${f.lastName}`}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
