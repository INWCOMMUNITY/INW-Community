"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { IonIcon } from "@/components/IonIcon";

type ActivityNav =
  | { kind: "friend_request"; requestId: string }
  | { kind: "post"; postId: string; commentId?: string }
  | { kind: "blog"; slug: string }
  | { kind: "event_invites" }
  | { kind: "event"; slug: string }
  | { kind: "my_orders" }
  | { kind: "seller_orders" }
  | { kind: "buyer_order"; orderId: string }
  | { kind: "seller_order"; orderId: string }
  | { kind: "group"; slug: string }
  | { kind: "resale_chat"; conversationId: string }
  | { kind: "buyer_resale_offer"; offerId: string }
  | { kind: "direct_message"; conversationId: string }
  | { kind: "none" };

interface ActivityLikeGroupMember {
  id: string;
  firstName: string;
  lastName: string;
  profilePhotoUrl: string | null;
}

interface ActivityItem {
  id: string;
  type: string;
  category: string;
  title: string;
  subtitle: string | null;
  occurredAt: string;
  actor: {
    id: string;
    firstName: string;
    lastName: string;
    profilePhotoUrl: string | null;
  } | null;
  nav: ActivityNav;
  likeGroup?: {
    members: ActivityLikeGroupMember[];
    othersCount: number;
    target: "post" | "comment";
  };
  storeItemPhotoUrl?: string | null;
}

function webHrefFromNav(nav: ActivityNav): string | null {
  switch (nav.kind) {
    case "friend_request":
      return "/my-community/friends";
    case "post": {
      const q =
        nav.commentId != null && nav.commentId !== ""
          ? `?comment=${encodeURIComponent(nav.commentId)}`
          : "";
      return `/my-community/posts/${nav.postId}${q}`;
    }
    case "blog":
      return `/blog/${nav.slug}`;
    case "event_invites":
      return "/my-community/profile";
    case "event":
      return `/event/${nav.slug}`;
    case "my_orders":
      return "/my-community/orders";
    case "seller_orders":
      return "/seller-hub/orders";
    case "buyer_order":
      return "/my-community/orders";
    case "seller_order":
      return `/seller-hub/orders/${nav.orderId}`;
    case "group":
      return `/my-community/groups/${nav.slug}?adminInvite=1`;
    case "resale_chat":
      return `/my-community/messages?tab=resale&conversation=${encodeURIComponent(nav.conversationId)}`;
    case "buyer_resale_offer":
      return "/cart";
    case "direct_message":
      return `/my-community/messages?direct=${encodeURIComponent(nav.conversationId)}`;
    case "none":
    default:
      return null;
  }
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function activityIcon(type: string): string {
  switch (type) {
    case "post_like":
    case "comment_like":
    case "post_likes_group":
    case "comment_likes_group":
      return "heart";
    case "post_comment":
    case "blog_comment":
      return "chatbubbles-outline";
    case "direct_message":
      return "mail-outline";
    case "friend_request":
      return "person-add-outline";
    default:
      break;
  }
  return "notifications-outline";
}

function displayMemberName(m: { firstName: string; lastName: string }): string {
  return [m.firstName, m.lastName].filter(Boolean).join(" ").trim() || "Someone";
}

const nameLinkClass = "font-semibold hover:underline relative z-10 pointer-events-auto";
const nameLinkStyle = { color: "var(--color-heading)" } as const;
const bodyTextStyle = { color: "var(--color-text)" } as const;

function MemberNameLink({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={`/members/${id}`}
      className={nameLinkClass}
      style={nameLinkStyle}
    >
      {children}
    </Link>
  );
}

function resolveMemberPhotoUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  if (path.startsWith("http")) return path;
  if (typeof window !== "undefined") {
    return `${window.location.origin}${path.startsWith("/") ? "" : "/"}${path}`;
  }
  return path.startsWith("/") ? path : `/${path}`;
}

function memberInitials(m: { firstName: string; lastName: string }): string {
  return `${m.firstName?.[0] ?? ""}${m.lastName?.[0] ?? ""}`.toUpperCase() || "?";
}

function TypeIcon({ name }: { name: string }) {
  return (
    <span
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
      style={{ backgroundColor: "var(--color-section-alt)", color: "var(--color-primary)" }}
      aria-hidden
    >
      <IonIcon name={name} size={20} />
    </span>
  );
}

function ListingThumb({ url }: { url: string | null | undefined }) {
  const src = url ? resolveMemberPhotoUrl(url) : undefined;
  if (!src) return null;
  return (
    <img
      src={src}
      alt=""
      className="h-10 w-10 shrink-0 rounded-lg object-cover"
      style={{ border: "1px solid var(--color-primary)" }}
      width={40}
      height={40}
    />
  );
}

function OverlapAvatars({ members }: { members: ActivityLikeGroupMember[] }) {
  const shown = members.slice(0, 3);
  return (
    <div className="flex h-10 shrink-0 items-center" aria-label="People who liked this">
      {shown.map((m, i) => {
        const src = resolveMemberPhotoUrl(m.profilePhotoUrl);
        return (
          <Link
            key={m.id}
            href={`/members/${m.id}`}
            className="relative z-10 pointer-events-auto h-10 w-10 shrink-0 overflow-hidden rounded-full ring-2 ring-white"
            style={{ marginLeft: i === 0 ? 0 : -12, zIndex: shown.length - i }}
            aria-label={`${displayMemberName(m)} profile`}
          >
            {src ? (
              <img src={src} alt="" className="h-full w-full object-cover" width={40} height={40} />
            ) : (
              <span
                className="flex h-full w-full items-center justify-center text-[11px] font-bold"
                style={{ backgroundColor: "var(--color-section-alt)", color: "var(--color-heading)" }}
              >
                {memberInitials(m)}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}

function RowLead({ item }: { item: ActivityItem }) {
  if (resolveMemberPhotoUrl(item.storeItemPhotoUrl ?? undefined)) {
    return <ListingThumb url={item.storeItemPhotoUrl} />;
  }
  if (item.likeGroup && item.likeGroup.members.length > 0) {
    return <OverlapAvatars members={item.likeGroup.members} />;
  }
  return <TypeIcon name={activityIcon(item.type)} />;
}

function renderAggregatedLikeTitleWeb(item: ActivityItem): ReactNode {
  const g = item.likeGroup!;
  const suffix = g.target === "post" ? " liked your post" : " liked your comment";
  const { members, othersCount } = g;

  const nameNodes = members.map((m, i) => {
    const last = i === members.length - 1 && othersCount === 0;
    let sep: ReactNode = null;
    if (i > 0) {
      if (last && members.length === 2) sep = <span style={bodyTextStyle}> and </span>;
      else if (last) sep = <span style={bodyTextStyle}>, and </span>;
      else sep = <span style={bodyTextStyle}>, </span>;
    }
    return (
      <Fragment key={m.id}>
        {sep}
        <MemberNameLink id={m.id}>{displayMemberName(m)}</MemberNameLink>
      </Fragment>
    );
  });

  return (
    <span className="inline">
      {nameNodes}
      {othersCount > 0 ? (
        <span style={bodyTextStyle}>
          {`, and ${othersCount} ${othersCount === 1 ? "other" : "others"}`}
        </span>
      ) : null}
      <span style={bodyTextStyle}>{suffix}</span>
    </span>
  );
}

function renderTitleWithLeadingMemberWeb(
  title: string,
  actor: ActivityItem["actor"]
): ReactNode {
  if (!actor) return title;
  const name = displayMemberName(actor);
  const patterns = [
    `${name} liked your post`,
    `${name} liked your comment`,
    `${name} sent you a message`,
  ];
  for (const p of patterns) {
    if (title === p) {
      const rest = title.slice(name.length);
      return (
        <>
          <MemberNameLink id={actor.id}>{name}</MemberNameLink>
          <span style={bodyTextStyle}>{rest}</span>
        </>
      );
    }
  }
  return title;
}

function renderSubtitleWithLeadingMemberWeb(
  subtitle: string,
  actor: ActivityItem["actor"]
): ReactNode {
  if (!actor) return subtitle;
  const name = displayMemberName(actor);
  const colon = `${name}: `;
  if (subtitle.startsWith(colon)) {
    const rest = subtitle.slice(colon.length);
    return (
      <>
        <MemberNameLink id={actor.id}>{name}</MemberNameLink>
        <span>: {rest}</span>
      </>
    );
  }
  if (subtitle === `${name} wants to connect`) {
    return (
      <>
        <MemberNameLink id={actor.id}>{name}</MemberNameLink>
        <span> wants to connect</span>
      </>
    );
  }
  const inv = `${name} invited you to `;
  if (subtitle.startsWith(inv)) {
    const rest = subtitle.slice(inv.length);
    return (
      <>
        <MemberNameLink id={actor.id}>{name}</MemberNameLink>
        <span> invited you to {rest}</span>
      </>
    );
  }
  const admin = `${name} invited you to help admin `;
  if (subtitle.startsWith(admin)) {
    const rest = subtitle.slice(admin.length);
    return (
      <>
        <MemberNameLink id={actor.id}>{name}</MemberNameLink>
        <span> invited you to help admin {rest}</span>
      </>
    );
  }
  const sale = `${name} · `;
  if (subtitle.startsWith(sale)) {
    const rest = subtitle.slice(sale.length);
    return (
      <>
        <MemberNameLink id={actor.id}>{name}</MemberNameLink>
        <span> · {rest}</span>
      </>
    );
  }
  return subtitle;
}

type ActivityTab = "community" | "shopping";

function RowTime({ iso }: { iso: string }) {
  return (
    <time className="text-xs shrink-0 whitespace-nowrap opacity-70" style={bodyTextStyle} dateTime={iso}>
      {formatWhen(iso)}
    </time>
  );
}

export default function NotificationsPage() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [tab, setTab] = useState<ActivityTab>("community");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [friendBusyId, setFriendBusyId] = useState<string | null>(null);

  const filteredItems = useMemo(
    () =>
      tab === "shopping"
        ? items.filter((i) => i.category === "commerce")
        : items.filter((i) => i.category !== "commerce"),
    [items, tab]
  );

  const emptyMessage =
    tab === "shopping"
      ? "No shopping activity yet. Orders, sales, and resale updates show up here."
      : "No community activity yet. Likes, comments, invites, and messages show up here.";

  const load = useCallback(() => {
    setError(null);
    fetch("/api/me/activity-feed?limit=80")
      .then(async (r) => {
        const data = (await r.json().catch(() => ({}))) as { items?: ActivityItem[]; error?: string };
        if (!r.ok) {
          setError(data.error ?? "Could not load activity.");
          setItems([]);
          return;
        }
        setItems(Array.isArray(data.items) ? data.items : []);
      })
      .catch(() => {
        setError("Connection failed.");
        setItems([]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const respondFriendRequest = async (requestId: string, status: "accepted" | "declined") => {
    setFriendBusyId(requestId);
    try {
      const res = await fetch(`/api/friend-requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not update friend request.");
        return;
      }
      setItems((prev) =>
        prev.filter((it) => !(it.nav.kind === "friend_request" && it.nav.requestId === requestId))
      );
      setError(null);
    } catch {
      setError("Connection failed.");
    } finally {
      setFriendBusyId(null);
    }
  };

  return (
    <div className="w-full max-w-2xl">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1
          className="text-2xl font-bold"
          style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
        >
          Notifications
        </h1>
        <Link
          href="/my-community/messages"
          className="inline-flex shrink-0 items-center gap-2 rounded-full border-2 px-3 py-1.5 text-sm font-semibold hover:opacity-90"
          style={{
            borderColor: "var(--color-primary)",
            color: "var(--color-heading)",
            backgroundColor: "var(--color-section-alt)",
          }}
          aria-label="Inbox"
        >
          <IonIcon name="mail-outline" size={18} />
          Inbox
        </Link>
      </div>
      <div className="mb-6 flex flex-wrap gap-2" role="tablist" aria-label="Notification categories">
        {(
          [
            { id: "community" as const, label: "Community" },
            { id: "shopping" as const, label: "Shopping" },
          ] as const
        ).map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              className={`rounded-full px-3 py-1.5 text-sm font-semibold border ${
                active ? "text-white border-transparent" : "hover:bg-[var(--color-section-alt)]"
              }`}
              style={
                active
                  ? { backgroundColor: "var(--color-primary)" }
                  : { color: "var(--color-heading)", borderColor: "var(--color-earth)" }
              }
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <p className="text-sm" style={bodyTextStyle}>
          Loading…
        </p>
      ) : error ? (
        <div
          className="rounded-xl border px-4 py-3 text-sm"
          style={{ borderColor: "var(--color-primary)", color: "var(--color-heading)" }}
        >
          {error}
          <button
            type="button"
            className="block mt-2 font-semibold underline"
            onClick={() => {
              setLoading(true);
              load();
            }}
          >
            Retry
          </button>
        </div>
      ) : filteredItems.length === 0 ? (
        <p className="text-sm leading-relaxed" style={bodyTextStyle}>
          {emptyMessage}
        </p>
      ) : (
        <ul
          className="overflow-hidden rounded-xl border-2 bg-white [&>li+li]:border-t [&>li+li]:border-[var(--color-section-alt)]"
          style={{ borderColor: "var(--color-primary)" }}
        >
          {filteredItems.map((item) => {
            const href = webHrefFromNav(item.nav);
            const friendRequestId =
              item.nav.kind === "friend_request" ? item.nav.requestId : null;
            const busy = friendRequestId != null && friendBusyId === friendRequestId;
            const title = item.likeGroup
              ? renderAggregatedLikeTitleWeb(item)
              : renderTitleWithLeadingMemberWeb(item.title, item.actor);
            const subtitle = item.subtitle
              ? renderSubtitleWithLeadingMemberWeb(item.subtitle, item.actor)
              : null;

            if (friendRequestId != null) {
              return (
                <li
                  key={item.id}
                  className="relative px-4 py-3 transition-colors hover:bg-[var(--color-section-alt)]"
                >
                  <div className="flex items-start gap-3">
                    <RowLead item={item} />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold leading-snug" style={nameLinkStyle}>
                        {item.title}
                      </p>
                      {subtitle ? (
                        <p className="text-sm mt-0.5 line-clamp-2" style={bodyTextStyle}>
                          {subtitle}
                        </p>
                      ) : null}
                      <p className="mt-0.5">
                        <RowTime iso={item.occurredAt} />
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                          style={{ backgroundColor: "var(--color-primary)" }}
                          onClick={() => respondFriendRequest(friendRequestId, "accepted")}
                        >
                          {busy ? "…" : "Approve"}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          className="rounded-lg border-2 px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
                          style={{
                            borderColor: "var(--color-earth)",
                            color: "var(--color-earth)",
                          }}
                          onClick={() => respondFriendRequest(friendRequestId, "declined")}
                        >
                          {busy ? "…" : "Decline"}
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              );
            }

            return (
              <li
                key={item.id}
                className="relative transition-colors hover:bg-[var(--color-section-alt)]"
              >
                {href ? (
                  <Link
                    href={href}
                    className="absolute inset-0 z-0"
                    aria-label={typeof item.title === "string" ? item.title : "Open notification"}
                  />
                ) : null}
                <div className="relative z-[1] flex items-start gap-3 px-4 py-3 pointer-events-none">
                  <RowLead item={item} />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold leading-snug" style={{ color: "var(--color-heading)" }}>
                      {title}
                    </p>
                    {subtitle ? (
                      <p className="text-sm mt-0.5 line-clamp-2" style={bodyTextStyle}>
                        {subtitle}
                      </p>
                    ) : null}
                    <p className="mt-0.5">
                      <RowTime iso={item.occurredAt} />
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
