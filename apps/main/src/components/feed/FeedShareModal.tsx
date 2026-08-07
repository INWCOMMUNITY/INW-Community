"use client";

import { useCallback, useEffect, useState } from "react";
import { IonIcon } from "@/components/IonIcon";
import { useLockBodyScroll } from "@/lib/scroll-lock";
import {
  buildShareUrl,
  recordPostShareEvent,
  shareToFeed,
  shareToGroup,
  type ShareContent,
  nextShareCountAfterShare,
} from "@/lib/share-utils";

type Friend = {
  id: string;
  firstName: string;
  lastName: string;
  profilePhotoUrl: string | null;
};

type Group = { id: string; name: string; slug?: string };

export type FeedShareTarget = { type: "post"; id: string; slug?: string };

type FeedShareModalProps = {
  open: boolean;
  target: FeedShareTarget | null;
  onClose: () => void;
  onToast?: (message: string) => void;
  onSourcePostShared?: (postId: string, shareCount: number | null) => void;
  onShareToFeedComplete?: () => void;
};

export function FeedShareModal({
  open,
  target,
  onClose,
  onToast,
  onSourcePostShared,
  onShareToFeedComplete,
}: FeedShareModalProps) {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<"main" | "feed" | "dm" | "group">("main");
  const [feedText, setFeedText] = useState("");
  const [busy, setBusy] = useState(false);
  const [sendingDm, setSendingDm] = useState<string | null>(null);

  useLockBodyScroll(open);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const content: ShareContent | null = target
    ? { type: target.type, id: target.id, slug: target.slug }
    : null;
  const shareUrl = content ? buildShareUrl(content) : "";

  useEffect(() => {
    if (!open) {
      setView("main");
      setFeedText("");
      return;
    }
    setLoading(true);
    Promise.all([
      fetch("/api/me/friends", { credentials: "include" })
        .then((r) => r.json())
        .then((d) => (Array.isArray(d.friends) ? d.friends : []))
        .catch(() => []),
      fetch("/api/me/groups?scope=member", { credentials: "include" })
        .then((r) => r.json())
        .then((d) => (Array.isArray(d.groups) ? d.groups : []))
        .catch(() => []),
    ])
      .then(([f, g]) => {
        setFriends(f);
        setGroups(g);
      })
      .finally(() => setLoading(false));
  }, [open]);

  const notifyShare = useCallback(
    (opts?: { shareRecorded?: boolean; shareCount?: number }) => {
      if (!target) return;
      const next = nextShareCountAfterShare(undefined, {
        recorded: opts?.shareRecorded,
        shareCount: opts?.shareCount,
      });
      onSourcePostShared?.(target.id, next);
    },
    [target, onSourcePostShared]
  );

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      if (target) {
        try {
          const res = await recordPostShareEvent(target.id, "link_copy");
          notifyShare({ shareRecorded: res.recorded, shareCount: res.shareCount });
        } catch {
          /* optional */
        }
      }
      onToast?.("Link copied!");
      onClose();
    } catch {
      onToast?.("Could not copy link");
    }
  }

  async function nativeShare() {
    if (!navigator.share) {
      void copyLink();
      return;
    }
    try {
      await navigator.share({ title: "Check this out", url: shareUrl });
      if (target) {
        try {
          const res = await recordPostShareEvent(target.id, "external");
          notifyShare({ shareRecorded: res.recorded, shareCount: res.shareCount });
        } catch {
          /* optional */
        }
      }
      onClose();
    } catch {
      /* user cancelled */
    }
  }

  async function submitShareToFeed() {
    if (!content) return;
    setBusy(true);
    try {
      const res = await shareToFeed(content, feedText);
      notifyShare({ shareRecorded: res.shareRecorded, shareCount: res.shareCount });
      onShareToFeedComplete?.();
      onToast?.("Shared to your feed!");
      onClose();
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : "Could not share to feed");
    } finally {
      setBusy(false);
    }
  }

  async function shareGroup(groupId: string) {
    if (!content) return;
    setBusy(true);
    try {
      const res = await shareToGroup(content, groupId);
      notifyShare({ shareRecorded: res.shareRecorded, shareCount: res.shareCount });
      onToast?.("Shared to group!");
      onClose();
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : "Could not share to group");
    } finally {
      setBusy(false);
    }
  }

  async function sendDm(friendId: string) {
    if (!target) return;
    setSendingDm(friendId);
    try {
      const res = await fetch("/api/direct-conversations", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          addresseeId: friendId,
          content: "Check this out",
          sharedContentType: "post",
          sharedContentId: target.id,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Send failed");
      notifyShare({
        shareRecorded: (data as { shareRecorded?: boolean }).shareRecorded,
        shareCount: (data as { shareCount?: number }).shareCount,
      });
      onToast?.("Sent in message!");
      onClose();
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : "Could not send message");
    } finally {
      setSendingDm(null);
    }
  }

  if (!open || !target) return null;

  return (
    <div className="fixed inset-0 z-[125] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4" onClick={onClose}>
      <div
        className="w-full sm:max-w-md rounded-t-xl sm:rounded-xl bg-white shadow-xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Share post"
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="font-bold text-lg">Share</h2>
          <button type="button" onClick={onClose} className="p-2 rounded-full hover:bg-gray-100" aria-label="Close">
            <IonIcon name="close" size={22} />
          </button>
        </div>

        {view === "main" && (
          <div className="p-4 space-y-2 overflow-y-auto">
            <button
              type="button"
              onClick={() => setView("feed")}
              className="w-full flex items-center gap-3 rounded-lg border px-4 py-3 text-left hover:bg-gray-50"
            >
              <IonIcon name="newspaper-outline" size={22} className="text-[var(--color-primary)]" />
              <span className="font-medium">Share to feed</span>
            </button>
            <button
              type="button"
              onClick={() => setView("group")}
              className="w-full flex items-center gap-3 rounded-lg border px-4 py-3 text-left hover:bg-gray-50"
            >
              <IonIcon name="people-circle-outline" size={22} className="text-[var(--color-primary)]" />
              <span className="font-medium">Share to group</span>
            </button>
            <button
              type="button"
              onClick={() => setView("dm")}
              className="w-full flex items-center gap-3 rounded-lg border px-4 py-3 text-left hover:bg-gray-50"
            >
              <IonIcon name="chatbubble-outline" size={22} className="text-[var(--color-primary)]" />
              <span className="font-medium">Send in message</span>
            </button>
            <button
              type="button"
              onClick={() => void copyLink()}
              className="w-full flex items-center gap-3 rounded-lg border px-4 py-3 text-left hover:bg-gray-50"
            >
              <IonIcon name="link-outline" size={22} className="text-[var(--color-primary)]" />
              <span className="font-medium">Copy link</span>
            </button>
            {typeof navigator !== "undefined" && "share" in navigator && (
              <button
                type="button"
                onClick={() => void nativeShare()}
                className="w-full flex items-center gap-3 rounded-lg border px-4 py-3 text-left hover:bg-gray-50"
              >
                <IonIcon name="share-outline" size={22} className="text-[var(--color-primary)]" />
                <span className="font-medium">Share externally</span>
              </button>
            )}
          </div>
        )}

        {view === "feed" && (
          <div className="p-4 flex flex-col gap-3">
            <button type="button" onClick={() => setView("main")} className="text-sm text-[var(--color-primary)] self-start">
              ← Back
            </button>
            <textarea
              value={feedText}
              onChange={(e) => setFeedText(e.target.value)}
              placeholder="Add a comment (optional)"
              className="w-full rounded-lg border px-3 py-2 text-sm min-h-[80px]"
              maxLength={2000}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void submitShareToFeed()}
              className="rounded-lg py-2.5 text-white font-semibold bg-[var(--color-primary)] disabled:opacity-50"
            >
              {busy ? "Sharing…" : "Share to feed"}
            </button>
          </div>
        )}

        {view === "group" && (
          <div className="p-4 overflow-y-auto flex-1">
            <button type="button" onClick={() => setView("main")} className="text-sm text-[var(--color-primary)] mb-3">
              ← Back
            </button>
            {loading ? (
              <p className="text-sm text-gray-500">Loading groups…</p>
            ) : groups.length === 0 ? (
              <p className="text-sm text-gray-500">You are not in any groups yet.</p>
            ) : (
              <ul className="space-y-2">
                {groups.map((g) => (
                  <li key={g.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void shareGroup(g.id)}
                      className="w-full text-left rounded-lg border px-4 py-2.5 hover:bg-gray-50 disabled:opacity-50"
                    >
                      {g.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {view === "dm" && (
          <div className="p-4 overflow-y-auto flex-1 max-h-[50vh]">
            <button type="button" onClick={() => setView("main")} className="text-sm text-[var(--color-primary)] mb-3">
              ← Back
            </button>
            {loading ? (
              <p className="text-sm text-gray-500">Loading friends…</p>
            ) : friends.length === 0 ? (
              <p className="text-sm text-gray-500">No friends to message yet.</p>
            ) : (
              <ul className="space-y-2">
                {friends.map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      disabled={!!sendingDm}
                      onClick={() => void sendDm(f.id)}
                      className="w-full text-left rounded-lg border px-4 py-2.5 hover:bg-gray-50 disabled:opacity-50"
                    >
                      {f.firstName} {f.lastName}
                      {sendingDm === f.id ? " …" : ""}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
