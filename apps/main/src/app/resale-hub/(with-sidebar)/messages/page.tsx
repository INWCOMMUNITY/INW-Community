"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { IonIcon } from "@/components/IonIcon";

interface ResaleConversation {
  id: string;
  buyerId: string;
  sellerId: string;
  storeItem: { id: string; title: string; slug: string; photos: string[] };
  buyer: { id: string; firstName: string; lastName: string };
  seller: { id: string; firstName: string; lastName: string };
  messages: { content: string; createdAt: string; senderId: string }[];
}

interface OpenResale {
  id: string;
  storeItem: { title: string; slug: string };
  buyer: { firstName: string; lastName: string };
  seller: { firstName: string; lastName: string };
  messages: Array<{
    content: string;
    createdAt: string;
    senderId?: string;
    sender?: { id: string; firstName: string; lastName: string };
  }>;
}

const fetchOpts = { credentials: "include" as RequestCredentials };

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return "Just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d`;
  return d.toLocaleDateString();
}

export default function ResaleHubMessagesPage() {
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const conversationId = searchParams.get("conversation");

  const [conversations, setConversations] = useState<ResaleConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [openConversation, setOpenConversation] = useState<OpenResale | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [messageSentOpen, setMessageSentOpen] = useState(false);

  const loadList = useCallback(() => {
    setLoading(true);
    fetch("/api/resale-conversations", fetchOpts)
      .then((r) => r.json())
      .then((d) => setConversations(Array.isArray(d) ? d : []))
      .catch(() => setConversations([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    if (!conversationId) {
      setOpenConversation(null);
      return;
    }
    fetch(`/api/resale-conversations/${conversationId}`, fetchOpts)
      .then((r) => r.json())
      .then((data) => {
        if (data.id) {
          setOpenConversation(data);
          fetch(`/api/resale-conversations/${conversationId}/read`, {
            ...fetchOpts,
            method: "PATCH",
          }).catch(() => {});
        } else setOpenConversation(null);
      })
      .catch(() => setOpenConversation(null));
  }, [conversationId]);

  async function sendReply() {
    if (!openConversation || !reply.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`/api/resale-conversations/${openConversation.id}`, {
        ...fetchOpts,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: reply.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.id) {
        setReply("");
        setOpenConversation((prev) =>
          prev
            ? {
                ...prev,
                messages: [
                  ...prev.messages,
                  {
                    content: reply.trim(),
                    createdAt: data.createdAt ?? new Date().toISOString(),
                    senderId: session?.user?.id,
                    sender: { id: session?.user?.id ?? "", firstName: "You", lastName: "" },
                  },
                ],
              }
            : null
        );
        setMessageSentOpen(true);
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col min-h-[60vh]">
      <h1 className="text-2xl font-bold mb-2">My Messages</h1>
      <p className="text-gray-600 mb-6">
        Conversations with buyers about your resale listings.
      </p>

      {!openConversation ? (
        <>
          {loading ? (
            <p className="text-gray-500">Loading…</p>
          ) : conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-6 rounded-lg border-2 border-dashed border-gray-200 bg-gray-50">
              <IonIcon name="chatbubbles-outline" size={48} className="text-gray-400 mb-3" />
              <p className="text-base text-gray-500 text-center">No resale conversations yet</p>
              <p className="text-sm text-gray-400 text-center mt-1">
                When buyers message you about a listing, conversations will appear here.
              </p>
              <Link href="/resale-hub/listings" className="text-[var(--color-primary)] font-medium mt-4 hover:underline">
                View your listings
              </Link>
            </div>
          ) : (
            <ul className="border border-gray-200 rounded-lg overflow-hidden divide-y divide-gray-200 bg-white">
              {conversations.map((c) => {
                const last = c.messages?.[0];
                const photo = c.storeItem?.photos?.[0];
                const photoUrl = photo
                  ? photo.startsWith("http")
                    ? photo
                    : (typeof window !== "undefined" ? window.location.origin : "") + photo
                  : null;
                const otherPerson =
                  c.sellerId === session?.user?.id ? c.buyer : c.seller;
                return (
                  <li key={c.id} className="border-b border-gray-200 last:border-b-0">
                    <Link
                      href={`/resale-hub/messages?conversation=${c.id}`}
                      className="flex items-center gap-3 p-4 hover:bg-gray-50 transition-colors"
                    >
                      <div className="w-12 h-12 rounded-lg shrink-0 overflow-hidden flex items-center justify-center bg-gray-100">
                        {photoUrl ? (
                          <img src={photoUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <IonIcon name="bag-outline" size={24} className="text-gray-500" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-[var(--color-heading)] truncate">
                          {c.storeItem?.title ?? "Item"}
                        </p>
                        <p className="text-sm text-gray-500 truncate mt-0.5">
                          {session?.user?.id === c.sellerId ? "Buyer" : "Seller"}:{" "}
                          {otherPerson.firstName} {otherPerson.lastName}
                        </p>
                        <p className="text-sm text-gray-500 truncate mt-0.5">
                          {last?.content ?? "No messages yet"}
                        </p>
                      </div>
                      {last && (
                        <span className="text-xs text-gray-500 shrink-0 ml-2">
                          {formatTime(last.createdAt)}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : (
        <div className="flex flex-col border-2 rounded-lg overflow-hidden flex-1 min-h-[400px]" style={{ borderColor: "var(--color-primary)" }}>
          <div
            className="flex items-center gap-3 px-4 py-3 shrink-0"
            style={{ backgroundColor: "var(--color-primary)" }}
          >
            <Link
              href="/resale-hub/messages"
              className="text-white hover:opacity-90 shrink-0 p-1 -m-1 rounded"
              aria-label="Back to messages"
            >
              <IonIcon name="arrow-back" size={24} className="text-white" />
            </Link>
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold text-white truncate">
                {openConversation.storeItem.title}
              </h2>
              <p className="text-xs text-white/80 truncate">
                With {openConversation.buyer.firstName} {openConversation.buyer.lastName}
              </p>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[200px] bg-gray-50">
            {openConversation.messages.map((m, i) => {
              const msg = m as {
                senderId?: string;
                sender?: { id: string; firstName: string; lastName: string };
              };
              const isMe = session?.user?.id && msg.senderId === session.user.id;
              return (
                <div
                  key={i}
                  className={`flex ${isMe ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] px-3 py-2.5 rounded-2xl border-2 ${
                      isMe ? "rounded-br-md" : "rounded-bl-md"
                    }`}
                    style={
                      isMe
                        ? {
                            backgroundColor: "var(--color-primary)",
                            borderColor: "transparent",
                          }
                        : {
                            backgroundColor: "white",
                            borderColor: "var(--color-primary)",
                          }
                    }
                  >
                    <p
                      className={`text-[15px] whitespace-pre-wrap ${
                        isMe ? "text-white" : "text-[var(--color-heading)]"
                      }`}
                    >
                      {m.content}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="p-3 border-t border-gray-200 flex items-end gap-2 shrink-0 bg-white">
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              className="flex-1 min-h-[40px] max-h-[120px] rounded-full border-2 px-4 py-2.5 text-base resize-none"
              style={{ borderColor: "var(--color-primary)" }}
              rows={1}
              placeholder="Message…"
            />
            <button
              type="button"
              onClick={sendReply}
              disabled={sending || !reply.trim()}
              className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 disabled:opacity-50 text-white"
              style={{ backgroundColor: "var(--color-primary)" }}
              aria-label="Send"
            >
              <IonIcon name="send" size={22} className="text-white" />
            </button>
          </div>
        </div>
      )}

      <div className="mt-6">
        <Link
          href="/resale-hub"
          className="text-[var(--color-link)] hover:underline font-medium"
        >
          ← Back to Resale Hub
        </Link>
      </div>

      {messageSentOpen ? (
        <div
          className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4"
          onClick={() => setMessageSentOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="resale-hub-message-sent-title"
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-sm w-full p-6 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="resale-hub-message-sent-title" className="text-xl font-semibold mb-2">
              Message Sent!
            </h2>
            <p className="text-gray-600 text-sm mb-6">Your reply was delivered.</p>
            <button
              type="button"
              onClick={() => setMessageSentOpen(false)}
              className="btn w-full sm:w-auto"
            >
              OK
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
