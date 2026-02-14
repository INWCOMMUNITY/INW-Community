"use client";

import { useState, useRef, useEffect } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";

export type ShareButtonType = "coupon" | "reward" | "business" | "blog" | "store_item";

interface ShareButtonBaseProps {
  type: ShareButtonType;
  id: string;
  title?: string;
  className?: string;
}

interface ShareButtonStoreItemProps extends ShareButtonBaseProps {
  type: "store_item";
  slug: string;
  listingType: "resale" | "new";
}

interface ShareButtonBusinessProps extends ShareButtonBaseProps {
  type: "business";
  slug: string;
}

interface ShareButtonBlogProps extends ShareButtonBaseProps {
  type: "blog";
  slug: string;
}

interface ShareButtonCouponProps extends ShareButtonBaseProps {
  type: "coupon";
}

interface ShareButtonRewardProps extends ShareButtonBaseProps {
  type: "reward";
}

export type ShareButtonProps =
  | ShareButtonStoreItemProps
  | ShareButtonBusinessProps
  | ShareButtonBlogProps
  | ShareButtonCouponProps
  | ShareButtonRewardProps;

const SHARE_API_BASE: Record<ShareButtonType, string> = {
  business: "/api/businesses",
  coupon: "/api/coupons",
  reward: "/api/rewards",
  blog: "/api/blogs",
  store_item: "/api/store-items",
};

function buildShareUrl(props: ShareButtonProps): string {
  if (typeof window === "undefined") return "";
  const base = window.location.origin;
  switch (props.type) {
    case "coupon":
      return `${base}/coupons/${props.id}`;
    case "reward":
      return `${base}/rewards${props.id ? `#reward-${props.id}` : ""}`;
    case "business":
      return `${base}/support-local/${props.slug}`;
    case "blog":
      return `${base}/blog/${props.slug}`;
    case "store_item":
      return props.listingType === "resale"
        ? `${base}/resale/${props.slug}`
        : `${base}/storefront/${props.slug}`;
    default:
      return base;
  }
}

function getShareTitle(props: ShareButtonProps): string {
  return props.title ?? "Check this out";
}

const SHARED_TYPE_MAP: Record<ShareButtonType, "post" | "blog" | "store_item" | "business" | "coupon" | "reward"> = {
  business: "business",
  coupon: "coupon",
  reward: "reward",
  blog: "blog",
  store_item: "store_item",
};

export function ShareButton(props: ShareButtonProps) {
  const { type, id, title, className = "" } = props;
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shareToFeedLoading, setShareToFeedLoading] = useState(false);
  const [shareToFeedDone, setShareToFeedDone] = useState(false);
  const [showFriendPicker, setShowFriendPicker] = useState(false);
  const [friends, setFriends] = useState<{ id: string; firstName: string; lastName: string }[]>([]);
  const [sendToMessageLoading, setSendToMessageLoading] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const url = buildShareUrl(props);
  const shareTitle = getShareTitle(props);

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
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function openEmail() {
    const subject = encodeURIComponent(shareTitle);
    const body = encodeURIComponent(`${shareTitle}\n\n${url}`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
    setOpen(false);
  }

  function openSms() {
    const body = encodeURIComponent(`${shareTitle} ${url}`);
    window.location.href = `sms:?body=${body}`;
    setOpen(false);
  }

  function openMessenger() {
    const encoded = encodeURIComponent(url);
    const appId = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID || "";
    const messengerUrl = appId
      ? `https://www.facebook.com/dialog/send?link=${encoded}&app_id=${appId}&redirect_uri=${encodeURIComponent(url)}`
      : `https://www.facebook.com/sharer/sharer.php?u=${encoded}`;
    window.open(messengerUrl, "_blank", "noopener,noreferrer,width=600,height=400");
    setOpen(false);
  }

  async function handleShareToFeed() {
    if (status !== "authenticated" || shareToFeedLoading) return;
    setShareToFeedLoading(true);
    try {
      const res = await fetch(`${SHARE_API_BASE[type]}/${id}/share`, { method: "POST" });
      if (res.ok) {
        setShareToFeedDone(true);
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "Failed to share to feed");
      }
    } finally {
      setShareToFeedLoading(false);
    }
    setOpen(false);
  }

  function getSharedPayload(): { sharedContentType: string; sharedContentId: string; sharedContentSlug?: string } | null {
    const sharedType = SHARED_TYPE_MAP[type];
    if (!sharedType) return null;
    switch (type) {
      case "business":
      case "blog":
      case "store_item":
        return {
          sharedContentType: sharedType,
          sharedContentId: id,
          sharedContentSlug: "slug" in props ? props.slug : undefined,
        };
      case "coupon":
      case "reward":
        return { sharedContentType: sharedType, sharedContentId: id };
      default:
        return null;
    }
  }

  async function handleSendToFriend(friendId: string) {
    setSendToMessageLoading(friendId);
    try {
      const payload = getSharedPayload();
      const res = await fetch("/api/direct-conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          addresseeId: friendId,
          content: `${shareTitle}\n${url}`,
          ...(payload && {
            sharedContentType: payload.sharedContentType,
            sharedContentId: payload.sharedContentId,
            sharedContentSlug: payload.sharedContentSlug,
          }),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setShowFriendPicker(false);
        setOpen(false);
      } else {
        alert(data.error ?? "Failed to send");
      }
    } finally {
      setSendToMessageLoading(null);
    }
  }

  async function handleNativeShare() {
    if (!navigator.share) return false;
    try {
      await navigator.share({
        title: shareTitle,
        url,
        text: shareTitle,
      });
      setOpen(false);
      return true;
    } catch {
      return false;
    }
  }

  function toggleOpen() {
    if (open) {
      setOpen(false);
      return;
    }
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      handleNativeShare().then((shared) => {
        if (!shared) setOpen(true);
      });
    } else {
      setOpen(true);
    }
  }

  const buttonContent = (
    <span className="inline-flex items-center justify-center" aria-hidden>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
        <path d="M12 2.59l5.7 5.7-1.41 1.42L13 6.41V16h-2V6.41l-3.3 3.3-1.41-1.42L12 2.59zM21 15v4a1 1 0 01-1 1H4a1 1 0 01-1-1v-4H2v4a3 3 0 003 3h14a3 3 0 003-3v-4h-2z" />
      </svg>
    </span>
  );

  if (status !== "authenticated") {
    return (
      <Link
        href={`/login?callbackUrl=${typeof window !== "undefined" ? window.location.pathname : "/"}`}
        className={`inline-flex items-center justify-center p-2 rounded border border-gray-300 bg-white hover:bg-gray-50 ${className}`}
        title="Share (log in)"
      >
        {buttonContent}
      </Link>
    );
  }

  return (
    <div className="relative inline-block" ref={menuRef}>
      <button
        type="button"
        onClick={toggleOpen}
        className={`inline-flex items-center justify-center p-2 rounded border border-gray-300 bg-white hover:bg-gray-50 ${className}`}
        title="Share"
        aria-expanded={open}
        aria-haspopup="true"
      >
        {buttonContent}
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 py-1 min-w-[180px] bg-white border border-gray-200 rounded-lg shadow-lg z-50"
          role="menu"
        >
          <button
            type="button"
            onClick={handleCopyLink}
            className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100"
            role="menuitem"
          >
            {copied ? "Copied!" : "Copy link"}
          </button>
          <button
            type="button"
            onClick={openEmail}
            className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100"
            role="menuitem"
          >
            Email
          </button>
          <button
            type="button"
            onClick={openSms}
            className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100"
            role="menuitem"
          >
            Text message
          </button>
          <button
            type="button"
            onClick={openMessenger}
            className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100"
            role="menuitem"
          >
            Messenger
          </button>
          <button
            type="button"
            onClick={handleCopyLink}
            className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 border-t border-gray-100"
            role="menuitem"
          >
            Copy link for Instagram
          </button>
          {!showFriendPicker ? (
            <button
              type="button"
              onClick={() => setShowFriendPicker(true)}
              className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 border-t border-gray-100"
              role="menuitem"
            >
              Send in message
            </button>
          ) : (
            <div className="border-t border-gray-100 max-h-48 overflow-y-auto">
              <button type="button" onClick={() => setShowFriendPicker(false)} className="w-full text-left px-4 py-1.5 text-xs text-gray-500 hover:bg-gray-100">
                ← Back
              </button>
              {friends.length === 0 ? (
                <p className="px-4 py-2 text-sm text-gray-500">Loading friends…</p>
              ) : (
                friends.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => handleSendToFriend(f.id)}
                    disabled={sendToMessageLoading !== null}
                    className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 disabled:opacity-60"
                    role="menuitem"
                  >
                    {sendToMessageLoading === f.id ? "Sending…" : `${f.firstName} ${f.lastName}`}
                  </button>
                ))
              )}
            </div>
          )}
          <button
            type="button"
            onClick={handleShareToFeed}
            disabled={shareToFeedLoading || shareToFeedDone}
            className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 border-t border-gray-100 disabled:opacity-60"
            role="menuitem"
          >
            {shareToFeedLoading ? "Sharing…" : shareToFeedDone ? "Shared to feed!" : "Share to feed"}
          </button>
        </div>
      )}
    </div>
  );
}
