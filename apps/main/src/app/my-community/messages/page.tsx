"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";

type Tab = "resale" | "direct";

interface ResaleConversation {
  id: string;
  storeItem: { id: string; title: string; slug: string; photos: string[] };
  buyer: { id: string; firstName: string; lastName: string };
  seller: { id: string; firstName: string; lastName: string };
  messages: { content: string; createdAt: string; senderId: string }[];
}

interface DirectConversation {
  id: string;
  memberA: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null };
  memberB: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null };
  messages: Array<{
    id: string;
    content: string;
    createdAt: string;
    senderId: string;
    sharedContentType?: string | null;
    sharedContentId?: string | null;
    sharedContentSlug?: string | null;
    sender?: { id: string; firstName: string; lastName: string };
  }>;
}

interface Friend {
  id: string;
  firstName: string;
  lastName: string;
  profilePhotoUrl: string | null;
  city?: string | null;
}

function sharedContentLink(msg: { sharedContentType?: string | null; sharedContentId?: string | null; sharedContentSlug?: string | null }) {
  if (!msg.sharedContentType) return null;
  const base = typeof window !== "undefined" ? window.location.origin : "";
  switch (msg.sharedContentType) {
    case "coupon":
      return `${base}/coupons/${msg.sharedContentId}`;
    case "business":
      return `${base}/support-local/${msg.sharedContentSlug || msg.sharedContentId}`;
    case "blog":
      return `${base}/blog/${msg.sharedContentSlug || msg.sharedContentId}`;
    case "store_item":
      return msg.sharedContentSlug ? `${base}/resale/${msg.sharedContentSlug}` : `${base}/storefront`;
    case "reward":
      return `${base}/rewards`;
    case "post":
      return `${base}/my-community`;
    default:
      return null;
  }
}

export default function MyCommunityMessagesPage() {
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const router = useRouter();
  const resaleId = searchParams.get("conversation");
  const directId = searchParams.get("direct");
  const tabParam = searchParams.get("tab");
  const tab: Tab = tabParam === "resale" || resaleId ? "resale" : "direct";
  function setTab(t: Tab) {
    router.replace(`/my-community/messages?tab=${t}`, { scroll: false });
  }
  const [resaleConversations, setResaleConversations] = useState<ResaleConversation[]>([]);
  const [directConversations, setDirectConversations] = useState<DirectConversation[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);
  const [openResale, setOpenResale] = useState<{
    id: string;
    storeItem: { title: string; slug: string };
    buyer: { firstName: string; lastName: string };
    seller: { firstName: string; lastName: string };
    messages: Array<{ content: string; createdAt: string; senderId?: string; sender?: { id: string; firstName: string; lastName: string } }>;
  } | null>(null);
  const [openDirect, setOpenDirect] = useState<DirectConversation | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [showFriendPicker, setShowFriendPicker] = useState(false);
  const [newMessageFriend, setNewMessageFriend] = useState<Friend | null>(null);
  const [newMessageContent, setNewMessageContent] = useState("");
  const [sendingNew, setSendingNew] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/resale-conversations").then((r) => r.json()).then((d) => (Array.isArray(d) ? d : [])),
      fetch("/api/direct-conversations").then((r) => r.json()).then((d) => (Array.isArray(d) ? d : [])),
      fetch("/api/me/friends").then((r) => r.json()).then((d) => d.friends ?? []),
    ])
      .then(([resale, direct, fr]) => {
        setResaleConversations(resale);
        setDirectConversations(direct);
        setFriends(fr);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!resaleId) {
      setOpenResale(null);
      return;
    }
    fetch(`/api/resale-conversations/${resaleId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.id) setOpenResale(data);
        else setOpenResale(null);
      })
      .catch(() => setOpenResale(null));
  }, [resaleId]);

  useEffect(() => {
    if (!directId) {
      setOpenDirect(null);
      return;
    }
    fetch(`/api/direct-conversations/${directId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.id) setOpenDirect(data);
        else setOpenDirect(null);
      })
      .catch(() => setOpenDirect(null));
  }, [directId]);

  async function sendResaleReply() {
    if (!openResale || !reply.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`/api/resale-conversations/${openResale.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: reply.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.id) {
        setReply("");
        setOpenResale((prev) =>
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
      }
    } finally {
      setSending(false);
    }
  }

  async function sendDirectReply() {
    if (!openDirect || !reply.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`/api/direct-conversations/${openDirect.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: reply.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.id) {
        setReply("");
        setOpenDirect((prev) =>
          prev
            ? {
                ...prev,
                messages: [
                  ...prev.messages,
                  {
                    id: data.id,
                    content: data.content,
                    createdAt: data.createdAt ?? new Date().toISOString(),
                    senderId: session?.user?.id ?? "",
                    sender: { id: session?.user?.id ?? "", firstName: "You", lastName: "" },
                  },
                ],
              }
            : null
        );
      }
    } finally {
      setSending(false);
    }
  }

  async function startDirectMessage() {
    if (!newMessageFriend || !newMessageContent.trim()) return;
    setSendingNew(true);
    try {
      const res = await fetch("/api/direct-conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addresseeId: newMessageFriend.id, content: newMessageContent.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.id) {
        setNewMessageFriend(null);
        setShowFriendPicker(false);
        setNewMessageContent("");
        setDirectConversations((prev) => {
          const exists = prev.some((c) => c.id === data.id);
          if (exists) return prev.map((c) => (c.id === data.id ? data : c));
          return [data, ...prev];
        });
        setOpenDirect(data);
        if (typeof window !== "undefined") {
          window.history.replaceState(null, "", `/my-community/messages?direct=${data.id}`);
        }
      } else {
        alert(data.error ?? "Failed to send");
      }
    } finally {
      setSendingNew(false);
    }
  }

  function otherMember(conv: DirectConversation) {
    if (!session?.user?.id) return conv.memberA;
    return conv.memberA.id === session.user.id ? conv.memberB : conv.memberA;
  }

  if (loading) {
    return <p className="text-gray-500">Loading…</p>;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">My Messages</h1>
      <div className="flex gap-2 border-b border-gray-200 mb-6">
        <button
          type="button"
          onClick={() => setTab("direct")}
          className={`px-4 py-2 font-medium border-b-2 -mb-px ${tab === "direct" ? "border-[var(--color-primary)] text-[var(--color-primary)]" : "border-transparent text-gray-600"}`}
        >
          Messages
        </button>
        <button
          type="button"
          onClick={() => setTab("resale")}
          className={`px-4 py-2 font-medium border-b-2 -mb-px ${tab === "resale" ? "border-[var(--color-primary)] text-[var(--color-primary)]" : "border-transparent text-gray-600"}`}
        >
          Resale
        </button>
      </div>

      {tab === "direct" && (
        <>
          <p className="text-gray-600 mb-4">Message friends and share posts, blogs, items, and more.</p>
          {!openDirect ? (
            <>
              {newMessageFriend ? (
                <div className="border rounded-lg p-4 mb-6 bg-gray-50">
                  <p className="text-sm font-medium mb-2">
                    Message {newMessageFriend.firstName} {newMessageFriend.lastName}
                  </p>
                  <textarea
                    value={newMessageContent}
                    onChange={(e) => setNewMessageContent(e.target.value)}
                    className="w-full border rounded px-3 py-2 text-sm mb-2"
                    rows={3}
                    placeholder="Type your message..."
                  />
                  <div className="flex gap-2">
                    <button type="button" onClick={() => { setNewMessageFriend(null); setNewMessageContent(""); }} className="btn border">
                      Cancel
                    </button>
                    <button type="button" onClick={startDirectMessage} disabled={sendingNew || !newMessageContent.trim()} className="btn">
                      {sendingNew ? "Sending…" : "Send"}
                    </button>
                  </div>
                </div>
              ) : null}
              {showFriendPicker && !newMessageFriend && friends.length > 0 && (
                <div className="mb-6">
                  <p className="text-sm font-medium mb-2">Choose a friend to message</p>
                  <ul className="space-y-2">
                    {friends.map((f) => (
                      <li key={f.id}>
                        <button
                          type="button"
                          onClick={() => setNewMessageFriend(f)}
                          className="w-full flex items-center gap-3 p-3 border rounded-lg hover:bg-gray-50 text-left"
                        >
                          {f.profilePhotoUrl ? (
                            <img src={f.profilePhotoUrl} alt="" className="w-10 h-10 rounded-full object-cover" />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-gray-300 flex items-center justify-center text-sm font-medium text-gray-600">
                              {f.firstName?.[0]}
                              {f.lastName?.[0]}
                            </div>
                          )}
                          <span className="font-medium">{f.firstName} {f.lastName}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button type="button" onClick={() => setShowFriendPicker(false)} className="btn border mt-2">Cancel</button>
                </div>
              )}
              {!showFriendPicker && !newMessageFriend && (
                <button type="button" onClick={() => setShowFriendPicker(true)} className="btn mb-6">
                  Message a friend
                </button>
              )}
              {directConversations.length === 0 && !newMessageFriend && !showFriendPicker ? (
                <p className="text-gray-500">No direct messages yet. Message a friend to start.</p>
              ) : !newMessageFriend && !showFriendPicker ? (
                <ul className="space-y-2">
                  {directConversations.map((c) => {
                    const other = otherMember(c);
                    const last = c.messages[0];
                    return (
                      <li key={c.id}>
                        <Link
                          href={`/my-community/messages?direct=${c.id}`}
                          className="block border rounded-lg p-4 hover:bg-gray-50"
                        >
                          <div className="flex items-center gap-3">
                            {other.profilePhotoUrl ? (
                              <img src={other.profilePhotoUrl} alt="" className="w-10 h-10 rounded-full object-cover" />
                            ) : (
                              <div className="w-10 h-10 rounded-full bg-gray-300 flex items-center justify-center text-sm font-medium text-gray-600">
                                {other.firstName?.[0]}
                                {other.lastName?.[0]}
                              </div>
                            )}
                            <div>
                              <span className="font-medium">{other.firstName} {other.lastName}</span>
                              {last && (
                                <p className="text-sm text-gray-600 truncate mt-0.5">{last.content}</p>
                              )}
                            </div>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <div className="p-4 border-b bg-gray-50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {(() => {
                    const other = otherMember(openDirect);
                    return (
                      <>
                        {other.profilePhotoUrl ? (
                          <img src={other.profilePhotoUrl} alt="" className="w-10 h-10 rounded-full object-cover" />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-gray-300 flex items-center justify-center text-sm font-medium text-gray-600">
                            {other.firstName?.[0]}
                            {other.lastName?.[0]}
                          </div>
                        )}
                        <div>
                          <h2 className="font-semibold">{other.firstName} {other.lastName}</h2>
                        </div>
                      </>
                    );
                  })()}
                </div>
                <Link href="/my-community/messages" className="text-sm text-[var(--color-link)] hover:underline">Back to list</Link>
              </div>
              <div className="p-4 space-y-3 max-h-96 overflow-y-auto">
                {openDirect.messages.map((m) => {
                  const isMe = session?.user?.id && m.senderId === session.user.id;
                  const name = isMe ? "You" : m.sender ? `${m.sender.firstName} ${m.sender.lastName}` : "—";
                  const link = sharedContentLink(m);
                  return (
                    <div key={m.id} className="text-sm">
                      <span className="font-medium">{name}:</span>{" "}
                      <span className="whitespace-pre-wrap">{m.content}</span>
                      {link && (
                        <p className="mt-1">
                          <a href={link} target="_blank" rel="noopener noreferrer" className="text-[var(--color-link)] hover:underline">
                            View shared content →
                          </a>
                        </p>
                      )}
                      <span className="text-gray-400 text-xs ml-2">{new Date(m.createdAt).toLocaleString()}</span>
                    </div>
                  );
                })}
              </div>
              <div className="p-4 border-t flex gap-2">
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  className="flex-1 border rounded px-3 py-2 text-sm"
                  rows={2}
                  placeholder="Type a message..."
                />
                <button type="button" onClick={sendDirectReply} disabled={sending || !reply.trim()} className="btn">
                  {sending ? "Sending…" : "Send"}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {tab === "resale" && (
        <>
          <p className="text-gray-600 mb-6">Conversations about resale items you’re buying or selling.</p>
          {resaleConversations.length === 0 ? (
            <p className="text-gray-500">No resale conversations yet.</p>
          ) : openResale ? (
            <div className="border rounded-lg overflow-hidden">
              <div className="p-4 border-b bg-gray-50 flex items-center justify-between">
                <div>
                  <h2 className="font-semibold">{openResale.storeItem.title}</h2>
                  <p className="text-sm text-gray-600">
                    With {openResale.buyer.firstName} {openResale.buyer.lastName} / {openResale.seller.firstName} {openResale.seller.lastName}
                  </p>
                </div>
                <Link href="/my-community/messages?tab=resale" className="text-sm text-[var(--color-link)] hover:underline">Back to list</Link>
              </div>
              <div className="p-4 space-y-3 max-h-96 overflow-y-auto">
                {openResale.messages.map((m, i) => {
                  const msg = m as { senderId?: string; sender?: { id: string; firstName: string; lastName: string } };
                  const isMe = session?.user?.id && msg.senderId === session.user.id;
                  const name = isMe ? "You" : msg.sender ? `${msg.sender.firstName} ${msg.sender.lastName}` : "—";
                  return (
                    <div key={i} className="text-sm">
                      <span className="font-medium">{name}:</span> <span className="whitespace-pre-wrap">{m.content}</span>
                      <span className="text-gray-400 text-xs ml-2">{new Date(m.createdAt).toLocaleString()}</span>
                    </div>
                  );
                })}
              </div>
              <div className="p-4 border-t flex gap-2">
                <textarea value={reply} onChange={(e) => setReply(e.target.value)} className="flex-1 border rounded px-3 py-2 text-sm" rows={2} placeholder="Type a reply..." />
                <button type="button" onClick={sendResaleReply} disabled={sending || !reply.trim()} className="btn">
                  {sending ? "Sending…" : "Send"}
                </button>
              </div>
            </div>
          ) : (
            <ul className="space-y-2">
              {resaleConversations.map((c) => (
                <li key={c.id}>
                  <Link href={`/my-community/messages?conversation=${c.id}`} className="block border rounded-lg p-4 hover:bg-gray-50">
                    <span className="font-medium">{c.storeItem.title}</span>
                    {c.messages[0] && <p className="text-sm text-gray-600 truncate mt-1">{c.messages[0].content}</p>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
