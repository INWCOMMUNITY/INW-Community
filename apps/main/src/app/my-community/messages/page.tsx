"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { IonIcon } from "@/components/IonIcon";
import { MessageBubbleBody } from "@/components/MessageBubbleBody";
import { GifPickerModalWeb } from "@/components/GifPickerModalWeb";
import { messageListPreview } from "@/lib/message-gif-url";
import { useMessagesPageRealtime } from "@/lib/use-conversation-realtime-web";
import type { LiveSocketMessagePayload } from "@/lib/chat-live-types";
import { fetchWithRetry } from "@/lib/fetch-with-retry";
import { ChatTypingIndicator, type ChatTypingPeer } from "@/components/ChatTypingIndicator";
import { ChatSeenPresenceRow } from "@/components/ChatSeenPresence";

type Tab = "direct" | "groups" | "resale";

interface ResaleConversation {
  id: string;
  buyerLastReadAt?: string | null;
  sellerLastReadAt?: string | null;
  storeItem: { id: string; title: string; slug: string; photos: string[] };
  buyer: { id: string; firstName: string; lastName: string };
  seller: { id: string; firstName: string; lastName: string };
  messages: { content: string; createdAt: string; senderId: string }[];
}

interface DirectConversation {
  id: string;
  status?: string;
  memberALastReadAt?: string | null;
  memberBLastReadAt?: string | null;
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
    sharedBusiness?: { id: string; name: string; slug: string; logoUrl: string | null; shortDescription: string | null } | null;
    sender?: { id: string; firstName: string; lastName: string };
  }>;
}

interface GroupConversation {
  id: string;
  name: string | null;
  createdBy: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null };
  members: { member: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null } }[];
  messages: { content: string; createdAt: string; senderId: string }[];
}

interface GroupConversationDetail extends GroupConversation {
  messages: Array<{
    id: string;
    content: string;
    createdAt: string;
    senderId: string;
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
    case "event":
      return `${base}/events/${msg.sharedContentSlug || msg.sharedContentId}`;
    default:
      return null;
  }
}

const fetchOpts: RequestInit = { credentials: "include", cache: "no-store" };

export default function MyCommunityMessagesPage() {
  const { data: session, status: sessionStatus } = useSession();
  const searchParams = useSearchParams();
  const router = useRouter();
  const resaleId = searchParams.get("conversation");
  const directId = searchParams.get("direct");
  const groupId = searchParams.get("group");
  const addresseeIdParam = searchParams.get("addresseeId");
  const addresseePrefillDone = useRef<string | null>(null);
  const tabParam = searchParams.get("tab");
  const tab: Tab =
    tabParam === "groups" || groupId ? "groups" : tabParam === "resale" || resaleId ? "resale" : "direct";
  function setTab(t: Tab) {
    router.replace(`/my-community/messages?tab=${t}`, { scroll: false });
  }
  const [resaleConversations, setResaleConversations] = useState<ResaleConversation[]>([]);
  const [directConversations, setDirectConversations] = useState<DirectConversation[]>([]);
  const [messageRequests, setMessageRequests] = useState<DirectConversation[]>([]);
  const [groupConversations, setGroupConversations] = useState<GroupConversation[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);
  const [openResale, setOpenResale] = useState<{
    id: string;
    buyerLastReadAt?: string | null;
    sellerLastReadAt?: string | null;
    storeItem: { title: string; slug: string };
    buyer: { id: string; firstName: string; lastName: string };
    seller: { id: string; firstName: string; lastName: string };
    messages: Array<{ content: string; createdAt: string; senderId?: string; sender?: { id: string; firstName: string; lastName: string } }>;
  } | null>(null);
  const [openDirect, setOpenDirect] = useState<DirectConversation | null>(null);
  const [openGroup, setOpenGroup] = useState<GroupConversationDetail | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [showFriendPicker, setShowFriendPicker] = useState(false);
  const [newMessageFriend, setNewMessageFriend] = useState<Friend | null>(null);
  const [newMessageContent, setNewMessageContent] = useState("");
  const [sendingNew, setSendingNew] = useState(false);
  const [acceptDeclineLoading, setAcceptDeclineLoading] = useState<string | null>(null);
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  const [gifInsertTarget, setGifInsertTarget] = useState<"reply" | "newDm">("reply");

  const refreshOpenDirect = useCallback(() => {
    if (!directId) return;
    fetch(`/api/direct-conversations/${directId}?_=${Date.now()}`, fetchOpts)
      .then((r) => r.json())
      .then((data) => {
        if (data?.id) setOpenDirect(data);
      })
      .catch(() => {});
  }, [directId]);

  const refreshOpenGroup = useCallback(() => {
    if (!groupId) return;
    fetch(`/api/group-conversations/${groupId}?_=${Date.now()}`, fetchOpts)
      .then((r) => r.json())
      .then((data) => {
        if (data?.id) setOpenGroup(data);
      })
      .catch(() => {});
  }, [groupId]);

  const refreshOpenResale = useCallback(() => {
    if (!resaleId) return;
    fetch(`/api/resale-conversations/${resaleId}?_=${Date.now()}`, fetchOpts)
      .then((r) => r.json())
      .then((data) => {
        if (data?.id) setOpenResale(data);
      })
      .catch(() => {});
  }, [resaleId]);

  const applyLiveDirect = useCallback((p: LiveSocketMessagePayload) => {
    setOpenDirect((prev) => {
      if (!prev || prev.id !== p.conversationId) return prev;
      if (prev.messages.some((m) => m.id === p.messageId)) return prev;
      return {
        ...prev,
        messages: [
          ...prev.messages,
          {
            id: p.messageId,
            content: p.content,
            createdAt: p.createdAt,
            senderId: p.senderId,
            sharedContentType: p.sharedContentType ?? null,
            sharedContentId: p.sharedContentId ?? null,
            sharedContentSlug: p.sharedContentSlug ?? null,
            sender: p.sender ?? { id: p.senderId, firstName: "", lastName: "" },
          },
        ],
      };
    });
  }, []);

  const applyLiveGroup = useCallback((p: LiveSocketMessagePayload) => {
    setOpenGroup((prev) => {
      if (!prev || prev.id !== p.conversationId) return prev;
      if (prev.messages.some((m) => m.id === p.messageId)) return prev;
      return {
        ...prev,
        messages: [
          ...prev.messages,
          {
            id: p.messageId,
            content: p.content,
            createdAt: p.createdAt,
            senderId: p.senderId,
            sharedContentType: p.sharedContentType ?? null,
            sharedContentId: p.sharedContentId ?? null,
            sharedContentSlug: p.sharedContentSlug ?? null,
            sender: p.sender
              ? {
                  id: p.sender.id,
                  firstName: p.sender.firstName,
                  lastName: p.sender.lastName,
                }
              : { id: p.senderId, firstName: "", lastName: "" },
          },
        ],
      };
    });
  }, []);

  const applyLiveResale = useCallback((p: LiveSocketMessagePayload) => {
    setOpenResale((prev) => {
      if (!prev || prev.id !== p.conversationId) return prev;
      if (prev.messages.some((m) => (m as { id?: string }).id === p.messageId)) return prev;
      return {
        ...prev,
        messages: [
          ...prev.messages,
          {
            id: p.messageId,
            content: p.content,
            createdAt: p.createdAt,
            senderId: p.senderId,
            sender: p.sender ?? { id: p.senderId, firstName: "", lastName: "" },
          },
        ],
      };
    });
  }, []);

  const load = useCallback(() => {
    Promise.all([
      fetch("/api/resale-conversations", fetchOpts).then((r) => r.json()).then((d) => (Array.isArray(d) ? d : [])),
      fetch("/api/direct-conversations", fetchOpts).then((r) => r.json()).then((d) => ({
        conversations: Array.isArray(d?.conversations) ? d.conversations : [],
        messageRequests: Array.isArray(d?.messageRequests) ? d.messageRequests : [],
      })),
      fetch("/api/group-conversations", fetchOpts).then((r) => r.json()).then((d) => (Array.isArray(d) ? d : [])),
      fetch("/api/me/friends", fetchOpts).then((r) => r.json()).then((d) => d.friends ?? []),
    ])
      .then(([resale, direct, groups, fr]) => {
        setResaleConversations(resale);
        setDirectConversations(direct.conversations);
        setMessageRequests(direct.messageRequests);
        setGroupConversations(groups);
        setFriends(fr);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const { typingPeerIds, peerPresenceIds, onComposerTyping, stopComposerTyping } = useMessagesPageRealtime({
    tab,
    directId,
    groupId,
    resaleId,
    sessionUserId: sessionStatus === "authenticated" ? session?.user?.id : undefined,
    refreshDirect: refreshOpenDirect,
    refreshGroup: refreshOpenGroup,
    refreshResale: refreshOpenResale,
    refreshSidebar: load,
    applyLiveDirect,
    applyLiveGroup,
    applyLiveResale,
  });

  const typingPeersResolved = useMemo((): ChatTypingPeer[] => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const abs = (u: string | null | undefined) => (u ? (u.startsWith("http") ? u : origin + u) : null);

    if (typingPeerIds.length === 0) return [];

    if (tab === "direct" && openDirect && session?.user?.id) {
      const other =
        openDirect.memberA.id === session.user.id ? openDirect.memberB : openDirect.memberA;
      const row = (name: string, photo: string | null, id: string): ChatTypingPeer => ({
        id,
        name,
        photoUrl: photo,
      });
      const otherName = `${other.firstName ?? ""} ${other.lastName ?? ""}`.trim() || "Member";
      const otherPhoto = abs(other.profilePhotoUrl);
      if (typingPeerIds.some((id) => id === other.id)) {
        return [row(otherName, otherPhoto, other.id)];
      }
      const anyPeer = typingPeerIds.find((id) => id && id !== session.user.id);
      if (anyPeer) {
        return [row(otherName, otherPhoto, anyPeer)];
      }
      return [];
    }

    if (tab === "groups" && openGroup?.members) {
      return typingPeerIds.map((id) => {
        const row = openGroup.members.find((m) => m.member.id === id);
        const m = row?.member;
        return {
          id,
          name: m ? `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() || "Someone" : "Someone",
          photoUrl: m ? abs(m.profilePhotoUrl) : null,
        };
      });
    }

    if (tab === "resale" && openResale) {
      return typingPeerIds.map((id) => {
        const buyer = openResale.buyer;
        const seller = openResale.seller;
        const m = id === buyer.id ? buyer : id === seller.id ? seller : null;
        return {
          id,
          name: m ? `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() || "Member" : "Member",
          photoUrl: null,
        };
      });
    }

    return typingPeerIds.map((id) => ({ id, name: "Someone", photoUrl: null }));
  }, [typingPeerIds, tab, openDirect, openGroup, openResale, session?.user?.id]);

  const chatPresencePeers = useMemo((): ChatTypingPeer[] => {
    if (peerPresenceIds.length === 0) return [];
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const abs = (u: string | null | undefined) => (u ? (u.startsWith("http") ? u : origin + u) : null);

    if (tab === "direct" && openDirect) {
      return peerPresenceIds.map((id) => {
        const m =
          openDirect.memberA.id === id
            ? openDirect.memberA
            : openDirect.memberB.id === id
              ? openDirect.memberB
              : null;
        if (!m) return { id, name: "Member", photoUrl: null };
        const name = `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() || "Member";
        return { id, name, photoUrl: abs(m.profilePhotoUrl) };
      });
    }
    if (tab === "groups" && openGroup?.members) {
      return peerPresenceIds.map((id) => {
        const row = openGroup.members.find((x) => x.member.id === id);
        const m = row?.member;
        const name = m ? `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() || "Someone" : "Someone";
        return { id, name, photoUrl: m ? abs(m.profilePhotoUrl) : null };
      });
    }
    if (tab === "resale" && openResale) {
      return peerPresenceIds.map((id) => {
        const m =
          id === openResale.buyer.id ? openResale.buyer : id === openResale.seller.id ? openResale.seller : null;
        const name = m ? `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() || "Member" : "Member";
        return { id, name, photoUrl: null };
      });
    }
    return [];
  }, [peerPresenceIds, tab, openDirect, openGroup, openResale]);

  const showDirectSeen = useMemo(() => {
    if (!openDirect || !session?.user?.id) return false;
    const peerRead =
      openDirect.memberA.id === session.user.id
        ? openDirect.memberBLastReadAt
        : openDirect.memberALastReadAt;
    if (!peerRead) return false;
    const myOutbound = openDirect.messages.filter((m) => m.senderId === session.user.id);
    const lastMine = myOutbound[myOutbound.length - 1];
    if (!lastMine) return false;
    return new Date(peerRead).getTime() >= new Date(lastMine.createdAt).getTime();
  }, [openDirect, session?.user?.id]);

  const showResaleSeen = useMemo(() => {
    if (!openResale || !session?.user?.id) return false;
    const uid = session.user.id;
    const peerRead =
      openResale.buyer.id === uid ? openResale.sellerLastReadAt : openResale.buyerLastReadAt;
    if (!peerRead) return false;
    const myOutbound = openResale.messages.filter((m) => {
      const sid = (m as { senderId?: string }).senderId;
      return sid === uid;
    });
    const lastMine = myOutbound[myOutbound.length - 1];
    if (!lastMine) return false;
    return new Date(peerRead).getTime() >= new Date(lastMine.createdAt).getTime();
  }, [openResale, session?.user?.id]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  /** Open “new message” composer with a member (e.g. from /members/[id] “Message”). */
  useEffect(() => {
    if (!addresseeIdParam) {
      addresseePrefillDone.current = null;
      return;
    }
    if (!session?.user?.id || addresseeIdParam === session.user.id) return;
    if (addresseePrefillDone.current === addresseeIdParam) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/members/${addresseeIdParam}`, fetchOpts);
      if (!res.ok || cancelled) return;
      const d = (await res.json().catch(() => null)) as {
        id?: string;
        firstName?: string;
        lastName?: string;
        profilePhotoUrl?: string | null;
      } | null;
      if (cancelled || !d?.id) return;
      addresseePrefillDone.current = addresseeIdParam;
      setNewMessageFriend({
        id: d.id,
        firstName: d.firstName ?? "",
        lastName: d.lastName ?? "",
        profilePhotoUrl: d.profilePhotoUrl ?? null,
      });
      setShowFriendPicker(false);
      setNewMessageContent("");
      setTab("direct");
      router.replace("/my-community/messages?tab=direct", { scroll: false });
    })();
    return () => {
      cancelled = true;
    };
  }, [addresseeIdParam, session?.user?.id, router]);

  useEffect(() => {
    if (!resaleId) {
      setOpenResale(null);
      return;
    }
    fetch(`/api/resale-conversations/${resaleId}`, fetchOpts)
      .then((r) => r.json())
      .then((data) => {
        if (data.id) {
          setOpenResale(data);
          fetch(`/api/resale-conversations/${resaleId}/read`, {
            ...fetchOpts,
            method: "PATCH",
          }).catch(() => {});
        } else setOpenResale(null);
      })
      .catch(() => setOpenResale(null));
  }, [resaleId]);

  useEffect(() => {
    if (!directId) {
      setOpenDirect(null);
      return;
    }
    fetch(`/api/direct-conversations/${directId}`, fetchOpts)
      .then((r) => r.json())
      .then((data) => {
        if (data.id) {
          setOpenDirect(data);
          fetch(`/api/direct-conversations/${directId}/read`, { ...fetchOpts, method: "PATCH" }).catch(
            () => {}
          );
        } else setOpenDirect(null);
      })
      .catch(() => setOpenDirect(null));
  }, [directId]);

  useEffect(() => {
    if (!groupId) {
      setOpenGroup(null);
      return;
    }
    fetch(`/api/group-conversations/${groupId}`, fetchOpts)
      .then((r) => r.json())
      .then((data) => {
        if (data.id) setOpenGroup(data);
        else setOpenGroup(null);
      })
      .catch(() => setOpenGroup(null));
  }, [groupId]);

  async function handleAcceptRequest(conversationId: string) {
    setAcceptDeclineLoading(conversationId);
    try {
      const res = await fetch(`/api/direct-conversations/${conversationId}`, {
        ...fetchOpts,
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept" }),
      });
      if (res.ok) await load();
    } finally {
      setAcceptDeclineLoading(null);
    }
  }

  async function handleDeclineRequest(conversationId: string) {
    setAcceptDeclineLoading(conversationId);
    try {
      const res = await fetch(`/api/direct-conversations/${conversationId}`, {
        ...fetchOpts,
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "decline" }),
      });
      if (res.ok) await load();
    } finally {
      setAcceptDeclineLoading(null);
    }
  }

  async function sendResaleReply() {
    if (!openResale || !reply.trim()) return;
    stopComposerTyping();
    setSending(true);
    try {
      const res = await fetchWithRetry(`/api/resale-conversations/${openResale.id}`, {
        ...fetchOpts,
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
    stopComposerTyping();
    setSending(true);
    try {
      const res = await fetchWithRetry(`/api/direct-conversations/${openDirect.id}`, {
        ...fetchOpts,
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

  async function sendGroupReply() {
    if (!openGroup || !reply.trim()) return;
    stopComposerTyping();
    setSending(true);
    try {
      const res = await fetchWithRetry(`/api/group-conversations/${openGroup.id}`, {
        ...fetchOpts,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: reply.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.id) {
        setReply("");
        setOpenGroup((prev) =>
          prev
            ? {
                ...prev,
                messages: [
                  ...prev.messages,
                  {
                    id: data.id,
                    content: data.content ?? reply.trim(),
                    createdAt: data.createdAt ?? new Date().toISOString(),
                    senderId: session?.user?.id ?? "",
                    sender: { id: session?.user?.id ?? "", firstName: "You", lastName: "" },
                  },
                ],
              }
            : null
        );
      } else {
        alert(data.error ?? "Failed to send");
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
        ...fetchOpts,
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

  if (loading) {
    return (
      <div className="flex flex-col w-full min-h-0 max-lg:min-h-[min(100dvh-14rem,720px)] lg:h-[calc(100dvh-10.5rem)] lg:max-h-[calc(100dvh-10.5rem)] bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-center flex-1 min-h-0 py-16">
          <div className="w-10 h-10 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full min-h-0 max-lg:min-h-[min(100dvh-14rem,720px)] lg:h-[calc(100dvh-10.5rem)] lg:max-h-[calc(100dvh-10.5rem)] bg-white rounded-lg border-2 border-gray-200 overflow-hidden">
      {/* App-style green header */}
      <header
        className="flex items-center justify-between px-4 py-3 shrink-0 border-b-2 border-black"
        style={{ backgroundColor: "var(--color-primary)" }}
      >
        <h1 className="text-lg font-bold text-white" style={{ fontFamily: "var(--font-heading)" }}>
          Messages
        </h1>
        <div className="flex items-center gap-2">
          <Link
            href="/my-community/my-page"
            className="py-1.5 px-3 rounded-lg text-sm font-semibold text-white border border-white/80 hover:bg-white/10 transition-colors shrink-0"
          >
            Go to Profile
          </Link>
          <div className="flex items-center gap-1">
          {tab === "groups" && (
            <button
              type="button"
              className="p-2 rounded-full text-white hover:opacity-90 opacity-60 cursor-not-allowed"
              aria-label="New group chat (coming soon)"
              title="New group chat — coming soon"
              disabled
            >
              <IonIcon name="people-outline" size={22} className="text-white" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowFriendPicker(true)}
            className="p-2 rounded-full text-white hover:opacity-90"
            aria-label="New message"
          >
            <IonIcon name="create-outline" size={24} className="text-white" />
          </button>
          </div>
        </div>
      </header>

      {/* App-style cream tab bar */}
      <div
        className="flex p-1 mx-4 mt-4 mb-2 rounded-lg shrink-0"
        style={{ backgroundColor: "var(--color-section-alt)" }}
      >
        <button
          type="button"
          onClick={() => setTab("direct")}
          className={`flex-1 py-2.5 rounded-md text-sm font-semibold transition-colors ${tab === "direct" ? "text-white" : "text-[var(--color-heading)]"}`}
          style={tab === "direct" ? { backgroundColor: "var(--color-primary)" } : undefined}
        >
          Direct
        </button>
        <button
          type="button"
          onClick={() => setTab("groups")}
          className={`flex-1 py-2.5 rounded-md text-sm font-semibold transition-colors ${tab === "groups" ? "text-white" : "text-[var(--color-heading)]"}`}
          style={tab === "groups" ? { backgroundColor: "var(--color-primary)" } : undefined}
        >
          Groups
        </button>
        <button
          type="button"
          onClick={() => setTab("resale")}
          className={`flex-1 py-2.5 rounded-md text-sm font-semibold transition-colors ${tab === "resale" ? "text-white" : "text-[var(--color-heading)]"}`}
          style={tab === "resale" ? { backgroundColor: "var(--color-primary)" } : undefined}
        >
          Resale
        </button>
      </div>

      {tab === "direct" && (
        <>
          {!openDirect ? (
            <div className="flex-1 min-h-0 flex flex-col overflow-auto px-0">
              {messageRequests.length > 0 && (
                <div className="px-4 pt-3 pb-2 border-b border-gray-200">
                  <h2 className="text-[13px] font-bold mb-2" style={{ color: "var(--color-primary)" }}>
                    Message requests
                  </h2>
                  <div className="space-y-3">
                    {messageRequests.map((c) => {
                      const other = otherMember(c);
                      const name = `${other.firstName ?? ""} ${other.lastName ?? ""}`.trim() || "Someone";
                      const isLoading = acceptDeclineLoading === c.id;
                      return (
                        <div key={c.id} className="mb-3">
                          <Link
                            href={`/my-community/messages?direct=${c.id}`}
                            className="flex items-center gap-3 py-2 rounded-lg hover:bg-gray-100 transition-colors"
                          >
                            {other.profilePhotoUrl ? (
                              <img src={other.profilePhotoUrl.startsWith("http") ? other.profilePhotoUrl : (typeof window !== "undefined" ? window.location.origin : "") + other.profilePhotoUrl} alt="" className="w-12 h-12 rounded-full object-cover shrink-0" />
                            ) : (
                              <div className="w-12 h-12 rounded-full shrink-0 flex items-center justify-center text-lg font-bold text-gray-500" style={{ backgroundColor: "var(--color-section-alt)" }}>
                                {name[0] ?? "?"}
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="font-semibold text-[var(--color-heading)] truncate">{name}</p>
                              <p className="text-sm text-gray-500 truncate mt-0.5">
                                {c.messages?.[0]?.content != null && c.messages[0].content !== ""
                                  ? messageListPreview(c.messages[0].content)
                                  : "Message request"}
                              </p>
                            </div>
                          </Link>
                          <div className="flex gap-2 mt-1 ml-14">
                            <button
                              type="button"
                              onClick={() => handleAcceptRequest(c.id)}
                              disabled={!!isLoading}
                              className="py-2 px-4 rounded-lg text-sm font-semibold text-white disabled:opacity-60 transition-opacity"
                              style={{ backgroundColor: "var(--color-primary)" }}
                            >
                              {isLoading ? "…" : "Accept"}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeclineRequest(c.id)}
                              disabled={!!isLoading}
                              className="py-2 px-4 rounded-lg text-sm font-semibold text-gray-600 border border-gray-300 hover:bg-gray-50 disabled:opacity-60"
                            >
                              Decline
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {newMessageFriend ? (
                <div className="mx-4 mt-4 p-4 rounded-lg border border-gray-200" style={{ backgroundColor: "var(--color-section-alt)" }}>
                  <p className="text-sm font-medium mb-2">
                    Message {newMessageFriend.firstName} {newMessageFriend.lastName}
                  </p>
                  <textarea
                    value={newMessageContent}
                    onChange={(e) => setNewMessageContent(e.target.value)}
                    className="w-full border-2 rounded-xl px-4 py-2 text-sm mb-2 resize-none"
                    style={{ borderColor: "var(--color-primary)" }}
                    rows={3}
                    placeholder="Type your message..."
                  />
                  <div className="flex gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => {
                        setGifInsertTarget("newDm");
                        setGifPickerOpen(true);
                      }}
                      className="px-4 py-2 rounded-lg border-2 border-gray-300 font-semibold text-sm text-[var(--color-heading)] hover:bg-gray-50"
                    >
                      GIF
                    </button>
                    <button type="button" onClick={() => { setNewMessageFriend(null); setNewMessageContent(""); }} className="px-4 py-2 rounded-lg border border-gray-300 font-medium text-gray-700 hover:bg-gray-50">
                      Cancel
                    </button>
                    <button type="button" onClick={startDirectMessage} disabled={sendingNew || !newMessageContent.trim()} className="px-4 py-2 rounded-lg text-white font-semibold disabled:opacity-70" style={{ backgroundColor: "var(--color-primary)" }}>
                      {sendingNew ? "Sending…" : "Send"}
                    </button>
                  </div>
                </div>
              ) : null}
              {showFriendPicker && !newMessageFriend && friends.length > 0 && (
                <div className="mx-4 mt-4">
                  <p className="text-sm font-semibold mb-2">Choose a friend to message</p>
                  <ul className="space-y-1">
                    {friends.map((f) => (
                      <li key={f.id}>
                        <button
                          type="button"
                          onClick={() => { setNewMessageFriend(f); setShowFriendPicker(false); }}
                          className="w-full flex items-center gap-3 p-4 rounded-lg hover:bg-gray-100 text-left border-b border-gray-100 last:border-0 transition-colors"
                        >
                          {f.profilePhotoUrl ? (
                            <img src={f.profilePhotoUrl.startsWith("http") ? f.profilePhotoUrl : (typeof window !== "undefined" ? window.location.origin : "") + f.profilePhotoUrl} alt="" className="w-12 h-12 rounded-full object-cover shrink-0" />
                          ) : (
                            <div className="w-12 h-12 rounded-full shrink-0 flex items-center justify-center text-lg font-bold text-gray-500" style={{ backgroundColor: "var(--color-section-alt)" }}>
                              {f.firstName?.[0] ?? "?"}{f.lastName?.[0] ?? ""}
                            </div>
                          )}
                          <span className="font-semibold text-[var(--color-heading)]">{f.firstName} {f.lastName}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button type="button" onClick={() => setShowFriendPicker(false)} className="mt-3 px-4 py-2 rounded-lg border border-gray-300 font-medium text-gray-700 hover:bg-gray-50">
                    Cancel
                  </button>
                </div>
              )}
              {!showFriendPicker && !newMessageFriend && directConversations.length === 0 && messageRequests.length === 0 && (
                <div className="flex-1 flex flex-col items-center justify-center py-12 px-6">
                  <IonIcon name="chatbubbles-outline" size={64} className="text-gray-400 mb-3" />
                  <p className="text-base text-gray-500 text-center mb-6">No direct messages yet</p>
                  <button type="button" onClick={() => setShowFriendPicker(true)} className="py-3 px-6 rounded-lg text-white font-semibold" style={{ backgroundColor: "var(--color-primary)" }}>
                    Start a conversation
                  </button>
                </div>
              )}
              {!newMessageFriend && !showFriendPicker && directConversations.length > 0 && (
                <ul className="flex-1 min-h-0">
                  {directConversations.map((c) => {
                    const other = otherMember(c);
                    const last = c.messages[0];
                    const name = `${other.firstName ?? ""} ${other.lastName ?? ""}`.trim() || "Unknown";
                    return (
                      <li key={c.id} className="border-b border-gray-200 last:border-0">
                        <Link
                          href={`/my-community/messages?direct=${c.id}`}
                          className="flex items-center gap-3 p-4 hover:bg-gray-50 transition-colors"
                        >
                          <div className="shrink-0">
                            {other.profilePhotoUrl ? (
                              <img src={other.profilePhotoUrl.startsWith("http") ? other.profilePhotoUrl : (typeof window !== "undefined" ? window.location.origin : "") + other.profilePhotoUrl} alt="" className="w-12 h-12 rounded-full object-cover" />
                            ) : (
                              <div className="w-12 h-12 rounded-full flex items-center justify-center text-gray-500" style={{ backgroundColor: "var(--color-section-alt)" }}>
                                <IonIcon name="person" size={24} />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-[var(--color-heading)] truncate">{name}</p>
                            <p className="text-sm text-gray-500 truncate mt-0.5">
                              {last ? messageListPreview(last.content) : "No messages yet"}
                            </p>
                          </div>
                          {last && <span className="text-xs text-gray-500 shrink-0 ml-2">{formatTime(last.createdAt)}</span>}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              {/* Chat header - app style green with avatar + name */}
              <div
                className="flex items-center gap-3 px-4 py-3 border-b-2 border-black shrink-0"
                style={{ backgroundColor: "var(--color-primary)" }}
              >
                <Link href="/my-community/messages" className="text-white hover:opacity-90 flex items-center gap-2 shrink-0">
                  <IonIcon name="arrow-back" size={24} className="text-white" />
                </Link>
                {(() => {
                  const other = otherMember(openDirect);
                  const name = `${other.firstName ?? ""} ${other.lastName ?? ""}`.trim() || "Unknown";
                  return (
                    <>
                      {other.profilePhotoUrl ? (
                        <img src={other.profilePhotoUrl.startsWith("http") ? other.profilePhotoUrl : (typeof window !== "undefined" ? window.location.origin : "") + other.profilePhotoUrl} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
                      ) : (
                        <div className="w-9 h-9 rounded-full shrink-0 flex items-center justify-center text-white/80" style={{ backgroundColor: "var(--color-section-alt)" }}>
                          <span className="text-sm font-bold">{name[0] ?? "?"}</span>
                        </div>
                      )}
                      <h2 className="font-semibold text-white truncate flex-1 min-w-0">{name}</h2>
                    </>
                  );
                })()}
              </div>
              {openDirect.status === "pending" && openDirect.messages.some((m) => m.senderId !== session?.user?.id) && (
                <div className="px-4 py-3 border-b border-gray-200 shrink-0" style={{ backgroundColor: "var(--color-section-alt)" }}>
                  <p className="text-sm text-gray-800 mb-2">Message request — accept to continue the conversation</p>
                  <div className="flex gap-3">
                    <button type="button" onClick={() => handleAcceptRequest(openDirect.id)} disabled={!!acceptDeclineLoading} className="py-2 px-4 rounded-lg text-white font-semibold text-sm disabled:opacity-70" style={{ backgroundColor: "var(--color-primary)" }}>
                      {acceptDeclineLoading === openDirect.id ? "…" : "Accept"}
                    </button>
                    <button type="button" onClick={() => handleDeclineRequest(openDirect.id)} disabled={!!acceptDeclineLoading} className="py-2 px-4 rounded-lg border border-gray-400 text-gray-600 font-semibold text-sm">
                      Decline
                    </button>
                  </div>
                </div>
              )}
              {typingPeersResolved.length > 0 &&
                !(
                  openDirect.status === "pending" &&
                  openDirect.messages.some((m) => m.senderId !== session?.user?.id)
                ) && <ChatTypingIndicator peers={typingPeersResolved} />}
              <div className="flex-1 overflow-y-scroll overflow-x-hidden p-4 space-y-3 min-h-0 [scrollbar-gutter:stable]">
                {openDirect.messages.map((m) => {
                  const isMe = session?.user?.id && m.senderId === session.user.id;
                  const link = sharedContentLink(m);
                  return (
                    <div key={m.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[80%] px-3 py-2.5 rounded-2xl border-2 border-black ${isMe ? "rounded-br-md" : "rounded-bl-md"}`}
                        style={isMe ? { backgroundColor: "var(--color-primary)", borderColor: "transparent" } : { backgroundColor: "var(--color-section-alt)" }}
                      >
                        {m.content ? <MessageBubbleBody content={m.content} isMe={!!isMe} /> : null}
                        {link && (
                          <div className="mt-2">
                            {m.sharedContentType === "business" && m.sharedBusiness ? (
                              <Link
                                href={link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-3 p-2.5 rounded-xl border-2 border-black/20 hover:opacity-90 transition-opacity w-full text-left"
                                style={{ backgroundColor: "var(--color-section-alt)", borderColor: "var(--color-primary)" }}
                              >
                                {m.sharedBusiness.logoUrl ? (
                                  <img
                                    src={m.sharedBusiness.logoUrl.startsWith("http") ? m.sharedBusiness.logoUrl : (typeof window !== "undefined" ? window.location.origin : "") + m.sharedBusiness.logoUrl}
                                    alt=""
                                    className="w-12 h-12 rounded-lg object-cover shrink-0"
                                  />
                                ) : (
                                  <div className="w-12 h-12 rounded-lg shrink-0 flex items-center justify-center" style={{ backgroundColor: "var(--color-section-alt)", color: "var(--color-primary)" }}>
                                    <IonIcon name="business" size={24} />
                                  </div>
                                )}
                                <div className="min-w-0 flex-1">
                                  <p className="font-semibold text-[var(--color-heading)] truncate">{m.sharedBusiness.name}</p>
                                  {m.sharedBusiness.shortDescription && (
                                    <p className="text-xs text-gray-600 line-clamp-2 mt-0.5">{m.sharedBusiness.shortDescription}</p>
                                  )}
                                  <p className="text-xs font-medium mt-1" style={{ color: "var(--color-primary)" }}>View business →</p>
                                </div>
                              </Link>
                            ) : (
                              <a href={link} target="_blank" rel="noopener noreferrer" className={`text-sm font-semibold underline ${isMe ? "text-white" : ""}`} style={!isMe ? { color: "var(--color-primary)" } : undefined}>
                                View shared content →
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {(showDirectSeen || chatPresencePeers.length > 0) && (
                  <ChatSeenPresenceRow showSeen={showDirectSeen} peers={chatPresencePeers} />
                )}
              </div>
              <div className="p-3 border-t border-gray-200 flex items-end gap-2 shrink-0 bg-white">
                <button
                  type="button"
                  onClick={() => {
                    setGifInsertTarget("reply");
                    setGifPickerOpen(true);
                  }}
                  className="shrink-0 px-3 py-2 rounded-full border-2 text-sm font-semibold text-[var(--color-heading)]"
                  style={{ borderColor: "var(--color-primary)" }}
                >
                  GIF
                </button>
                <textarea
                  value={reply}
                  onChange={(e) => {
                    setReply(e.target.value);
                    onComposerTyping();
                  }}
                  className="flex-1 min-h-[40px] max-h-[120px] rounded-full border-2 px-4 py-2.5 text-base resize-none"
                  style={{ borderColor: "var(--color-primary)" }}
                  rows={1}
                  placeholder="Message..."
                />
                <button
                  type="button"
                  onClick={sendDirectReply}
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
        </>
      )}

      {tab === "groups" && (
        <>
          {!openGroup ? (
            <div className="flex-1 min-h-0 flex flex-col overflow-auto">
              {groupConversations.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center py-12 px-6">
                  <IonIcon name="people-outline" size={64} className="text-gray-400 mb-3" />
                  <p className="text-base text-gray-500 text-center">No group chats yet</p>
                </div>
              ) : (
                <ul className="flex-1 min-h-0">
                  {groupConversations.map((c) => {
                    const last = c.messages?.[0];
                    const members = c.members ?? [];
                    const name = c.name ?? (members.map((m) => m.member?.firstName).filter(Boolean).join(", ") || "Group");
                    const firstPhoto = members[0]?.member?.profilePhotoUrl;
                    return (
                      <li key={c.id} className="border-b border-gray-200 last:border-0">
                        <Link href={`/my-community/messages?tab=groups&group=${c.id}`} className="flex items-center gap-3 p-4 hover:bg-gray-50 transition-colors">
                          <div className="w-12 h-12 rounded-full shrink-0 flex items-center justify-center text-gray-500" style={{ backgroundColor: "var(--color-section-alt)" }}>
                            {firstPhoto ? (
                              <img src={firstPhoto.startsWith("http") ? firstPhoto : (typeof window !== "undefined" ? window.location.origin : "") + firstPhoto} alt="" className="w-12 h-12 rounded-full object-cover" />
                            ) : (
                              <IonIcon name="people" size={24} className="text-gray-500" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-[var(--color-heading)] truncate">{name}</p>
                            <p className="text-sm text-gray-500 truncate mt-0.5">
                              {last ? messageListPreview(last.content) : "No messages yet"}
                            </p>
                          </div>
                          {last && <span className="text-xs text-gray-500 shrink-0 ml-2">{formatTime(last.createdAt)}</span>}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3 border-b-2 border-black shrink-0" style={{ backgroundColor: "var(--color-primary)" }}>
                <Link href="/my-community/messages?tab=groups" className="text-white hover:opacity-90 shrink-0">
                  <IonIcon name="arrow-back" size={24} className="text-white" />
                </Link>
                <h2 className="font-semibold text-white truncate flex-1">{openGroup.name ?? "Group"}</h2>
              </div>
              {typingPeersResolved.length > 0 && <ChatTypingIndicator peers={typingPeersResolved} />}
              <div className="flex-1 overflow-y-scroll overflow-x-hidden p-4 space-y-3 min-h-0 [scrollbar-gutter:stable]">
                {openGroup.messages.map((m) => {
                  const isMe = session?.user?.id && m.senderId === session.user.id;
                  return (
                    <div key={m.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[80%] px-3 py-2.5 rounded-2xl border-2 border-black ${isMe ? "rounded-br-md" : "rounded-bl-md"}`} style={isMe ? { backgroundColor: "var(--color-primary)", borderColor: "transparent" } : { backgroundColor: "var(--color-section-alt)" }}>
                        <MessageBubbleBody content={m.content} isMe={!!isMe} />
                      </div>
                    </div>
                  );
                })}
                {chatPresencePeers.length > 0 && (
                  <ChatSeenPresenceRow showSeen={false} peers={chatPresencePeers} />
                )}
              </div>
              <div className="p-3 border-t border-gray-200 flex items-end gap-2 shrink-0 bg-white">
                <button
                  type="button"
                  onClick={() => {
                    setGifInsertTarget("reply");
                    setGifPickerOpen(true);
                  }}
                  className="shrink-0 px-3 py-2 rounded-full border-2 text-sm font-semibold text-[var(--color-heading)]"
                  style={{ borderColor: "var(--color-primary)" }}
                >
                  GIF
                </button>
                <textarea
                  value={reply}
                  onChange={(e) => {
                    setReply(e.target.value);
                    onComposerTyping();
                  }}
                  className="flex-1 min-h-[40px] max-h-[120px] rounded-full border-2 px-4 py-2.5 text-base resize-none"
                  style={{ borderColor: "var(--color-primary)" }}
                  rows={1}
                  placeholder="Message..."
                />
                <button type="button" onClick={sendGroupReply} disabled={sending || !reply.trim()} className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 disabled:opacity-50 text-white" style={{ backgroundColor: "var(--color-primary)" }} aria-label="Send">
                  <IonIcon name="send" size={22} className="text-white" />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {tab === "resale" && (
        <>
          {!openResale ? (
            <div className="flex-1 min-h-0 flex flex-col overflow-auto">
              {resaleConversations.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center py-12 px-6">
                  <IonIcon name="bag-outline" size={64} className="text-gray-400 mb-3" />
                  <p className="text-base text-gray-500 text-center">No resale conversations yet</p>
                </div>
              ) : (
                <ul className="flex-1 min-h-0">
                  {resaleConversations.map((c) => {
                    const last = c.messages?.[0];
                    const photo = c.storeItem?.photos?.[0];
                    const photoUrl = photo ? (photo.startsWith("http") ? photo : (typeof window !== "undefined" ? window.location.origin : "") + photo) : null;
                    return (
                      <li key={c.id} className="border-b border-gray-200 last:border-0">
                        <Link href={`/my-community/messages?conversation=${c.id}`} className="flex items-center gap-3 p-4 hover:bg-gray-50 transition-colors">
                          <div className="w-12 h-12 rounded-lg shrink-0 overflow-hidden flex items-center justify-center bg-gray-100">
                            {photoUrl ? <img src={photoUrl} alt="" className="w-full h-full object-cover" /> : <IonIcon name="bag" size={24} className="text-gray-500" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-[var(--color-heading)] truncate">{c.storeItem?.title ?? "Item"}</p>
                            <p className="text-sm text-gray-500 truncate mt-0.5">
                              {last ? messageListPreview(last.content) : "No messages yet"}
                            </p>
                          </div>
                          {last && <span className="text-xs text-gray-500 shrink-0 ml-2">{formatTime(last.createdAt)}</span>}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3 border-b-2 border-black shrink-0" style={{ backgroundColor: "var(--color-primary)" }}>
                <Link href="/my-community/messages?tab=resale" className="text-white hover:opacity-90 shrink-0">
                  <IonIcon name="arrow-back" size={24} className="text-white" />
                </Link>
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold text-white truncate">{openResale.storeItem.title}</h2>
                  <p className="text-xs text-white/80 truncate">With {openResale.buyer.firstName} {openResale.buyer.lastName} / {openResale.seller.firstName} {openResale.seller.lastName}</p>
                </div>
              </div>
              {typingPeersResolved.length > 0 && <ChatTypingIndicator peers={typingPeersResolved} />}
              <div className="flex-1 overflow-y-scroll overflow-x-hidden p-4 space-y-3 min-h-0 [scrollbar-gutter:stable]">
                {openResale.messages.map((m, i) => {
                  const msg = m as { id?: string; senderId?: string; sender?: { id: string; firstName: string; lastName: string } };
                  const isMe = session?.user?.id && msg.senderId === session.user.id;
                  return (
                    <div key={msg.id ?? `idx-${i}`} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[80%] px-3 py-2.5 rounded-2xl border-2 border-black ${isMe ? "rounded-br-md" : "rounded-bl-md"}`} style={isMe ? { backgroundColor: "var(--color-primary)", borderColor: "transparent" } : { backgroundColor: "var(--color-section-alt)" }}>
                        <MessageBubbleBody content={m.content} isMe={!!isMe} />
                      </div>
                    </div>
                  );
                })}
                {(showResaleSeen || chatPresencePeers.length > 0) && (
                  <ChatSeenPresenceRow showSeen={showResaleSeen} peers={chatPresencePeers} />
                )}
              </div>
              <div className="p-3 border-t border-gray-200 flex items-end gap-2 shrink-0 bg-white">
                <button
                  type="button"
                  onClick={() => {
                    setGifInsertTarget("reply");
                    setGifPickerOpen(true);
                  }}
                  className="shrink-0 px-3 py-2 rounded-full border-2 text-sm font-semibold text-[var(--color-heading)]"
                  style={{ borderColor: "var(--color-primary)" }}
                >
                  GIF
                </button>
                <textarea
                  value={reply}
                  onChange={(e) => {
                    setReply(e.target.value);
                    onComposerTyping();
                  }}
                  className="flex-1 min-h-[40px] max-h-[120px] rounded-full border-2 px-4 py-2.5 text-base resize-none"
                  style={{ borderColor: "var(--color-primary)" }}
                  rows={1}
                  placeholder="Message..."
                />
                <button type="button" onClick={sendResaleReply} disabled={sending || !reply.trim()} className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 disabled:opacity-50 text-white" style={{ backgroundColor: "var(--color-primary)" }} aria-label="Send">
                  <IonIcon name="send" size={22} className="text-white" />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <GifPickerModalWeb
        visible={gifPickerOpen}
        onClose={() => setGifPickerOpen(false)}
        onSelect={(url) => {
          if (gifInsertTarget === "newDm") setNewMessageContent(url);
          else setReply(url);
        }}
      />
    </div>
  );
}
