"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { useSession } from "next-auth/react";
import { IonIcon } from "@/components/IonIcon";
import { useLockBodyScroll } from "@/lib/scroll-lock";

interface Friend {
  id: string;
  firstName: string;
  lastName: string;
  profilePhotoUrl: string | null;
}

interface ShareToChatModalProps {
  open: boolean;
  onClose: () => void;
  shareTitle: string;
  shareUrl: string;
  sharedContentType?: string;
  sharedContentId?: string;
  sharedContentSlug?: string;
  onSuccess?: () => void;
}

export function ShareToChatModal({
  open,
  onClose,
  shareTitle,
  shareUrl,
  sharedContentType,
  sharedContentId,
  sharedContentSlug,
  onSuccess,
}: ShareToChatModalProps) {
  const { data: session, status } = useSession();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sending, setSending] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  useLockBodyScroll(open);

  useEffect(() => {
    if (!open || status !== "authenticated") return;
    setLoading(true);
    fetch("/api/friends?status=accepted")
      .then((r) => r.json())
      .then((data) => setFriends(data.friends ?? []))
      .catch(() => setFriends([]))
      .finally(() => setLoading(false));
  }, [open, status]);

  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  const filteredFriends = friends.filter((f) => {
    const fullName = `${f.firstName} ${f.lastName}`.toLowerCase();
    return fullName.includes(search.toLowerCase());
  });

  async function handleSend(friendId: string) {
    if (sending) return;
    setSending(friendId);
    try {
      const res = await fetch("/api/direct-conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          addresseeId: friendId,
          content: `${shareTitle}\n${shareUrl}`,
          ...(sharedContentType &&
            sharedContentId && {
              sharedContentType,
              sharedContentId,
              sharedContentSlug,
            }),
        }),
      });
      if (res.ok) {
        setSentTo((prev) => new Set(prev).add(friendId));
        onSuccess?.();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "Failed to send message");
      }
    } finally {
      setSending(null);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-modal-title"
    >
      {/* Backdrop */}
      <button
        type="button"
        onClick={onClose}
        className="absolute inset-0 bg-black/50 transition"
        aria-label="Close"
      />

      {/* Modal content */}
      <div className="relative w-full max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[85vh] overflow-hidden flex flex-col animate-slideUp">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 id="share-modal-title" className="text-lg font-bold">
            Send to Friend
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 -m-2 rounded-full hover:bg-gray-100 transition"
            aria-label="Close"
          >
            <IonIcon name="close" size={24} />
          </button>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-gray-100">
          <div className="relative">
            <IonIcon
              name="search-outline"
              size={18}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search friends..."
              className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-full text-sm focus:outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/20"
            />
          </div>
        </div>

        {/* Friend list */}
        <div className="flex-1 overflow-y-auto p-2">
          {status !== "authenticated" ? (
            <div className="text-center py-8 text-gray-500">
              <p>Sign in to share with friends</p>
            </div>
          ) : loading ? (
            <div className="space-y-2 p-2">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center gap-3 p-2">
                  <div className="w-12 h-12 rounded-full bg-gray-200 animate-pulse" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-1/3 bg-gray-200 animate-pulse rounded" />
                    <div className="h-3 w-1/4 bg-gray-200 animate-pulse rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredFriends.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <IonIcon name="people-outline" size={40} className="mx-auto mb-2 opacity-50" />
              <p>{search ? "No friends match your search" : "No friends to share with"}</p>
            </div>
          ) : (
            <div className="space-y-1">
              {filteredFriends.map((friend) => {
                const isSent = sentTo.has(friend.id);
                const isSending = sending === friend.id;
                return (
                  <button
                    key={friend.id}
                    type="button"
                    onClick={() => !isSent && handleSend(friend.id)}
                    disabled={isSending || isSent}
                    className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 transition disabled:opacity-70"
                  >
                    <div className="w-12 h-12 rounded-full bg-gray-100 relative overflow-hidden shrink-0">
                      {friend.profilePhotoUrl ? (
                        <Image
                          src={friend.profilePhotoUrl}
                          alt=""
                          fill
                          className="object-cover"
                          sizes="48px"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <IonIcon name="person" size={24} className="text-gray-400" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 text-left">
                      <p className="font-medium text-sm">
                        {friend.firstName} {friend.lastName}
                      </p>
                    </div>
                    {isSent ? (
                      <span className="text-xs font-medium text-green-600 flex items-center gap-1">
                        <IonIcon name="checkmark-circle" size={16} />
                        Sent
                      </span>
                    ) : (
                      <span className="action-pill btn-pill-primary action-pill-sm">
                        {isSending ? (
                          <IonIcon name="sync-outline" size={14} className="animate-spin" />
                        ) : (
                          "Send"
                        )}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Preview of what's being shared */}
        <div className="p-4 border-t border-gray-100 bg-gray-50">
          <p className="text-xs text-gray-500 mb-1">Sharing:</p>
          <p className="text-sm font-medium truncate">{shareTitle}</p>
        </div>
      </div>

      <style jsx>{`
        @keyframes slideUp {
          from {
            transform: translateY(100%);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
        .animate-slideUp {
          animation: slideUp 0.25s ease-out;
        }
      `}</style>
    </div>
  );
}
