"use client";

import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { BackToProfileLink } from "@/components/BackToProfileLink";

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

const CATEGORY_LABEL: Record<string, string> = {
  social: "Social",
  content: "Feed & blog",
  events: "Events",
  groups: "Groups",
  commerce: "Orders & offers",
};

/** Visual cue aligned with mobile: heart = like, speech = comment, etc. */
function activityGlyph(type: string): string {
  switch (type) {
    case "post_like":
    case "comment_like":
    case "post_likes_group":
    case "comment_likes_group":
      return "♥";
    case "post_comment":
    case "blog_comment":
      return "💬";
    case "direct_message":
      return "✉";
    case "friend_request":
      return "＋";
    default:
      return "·";
  }
}

function displayMemberName(m: { firstName: string; lastName: string }): string {
  return [m.firstName, m.lastName].filter(Boolean).join(" ").trim() || "Someone";
}

function MemberNameLink({
  id,
  className,
  children,
}: {
  id: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={`/members/${id}`} className={className ?? "font-semibold text-emerald-800 hover:underline"}>
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

function ListingThumb({ url }: { url: string | null | undefined }) {
  const src = url ? resolveMemberPhotoUrl(url) : undefined;
  if (!src) return null;
  return (
    <img
      src={src}
      alt=""
      className="h-12 w-12 shrink-0 rounded-lg object-cover ring-1 ring-gray-200 bg-gray-100"
      width={48}
      height={48}
    />
  );
}

function memberInitials(m: { firstName: string; lastName: string }): string {
  return `${m.firstName?.[0] ?? ""}${m.lastName?.[0] ?? ""}`.toUpperCase() || "?";
}

function PyramidFace({
  m,
  z,
  className,
}: {
  m: ActivityLikeGroupMember;
  z: number;
  className?: string;
}) {
  const src = resolveMemberPhotoUrl(m.profilePhotoUrl);
  return (
    <Link
      href={`/members/${m.id}`}
      className={`relative shrink-0 rounded-full ring-2 ring-white bg-gray-200 shadow-sm ${className ?? ""}`}
      style={{ zIndex: z }}
      aria-label={`${displayMemberName(m)} profile`}
    >
      {src ? (
        <img src={src} alt="" className="h-[34px] w-[34px] rounded-full object-cover" width={34} height={34} />
      ) : (
        <div className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-gray-200 text-[11px] font-bold text-gray-600">
          {memberInitials(m)}
        </div>
      )}
    </Link>
  );
}

/** Apex = most recent liker; base row = older likers (2-wide pyramid). */
function PyramidLikeAvatars({ members }: { members: ActivityLikeGroupMember[] }) {
  if (members.length === 1) {
    return (
      <div
        className="flex w-[76px] shrink-0 items-center justify-center"
        aria-label="People who liked this"
      >
        <PyramidFace m={members[0]} z={1} />
      </div>
    );
  }
  if (members.length >= 3) {
    const [top, leftBase, rightBase] = [members[0], members[1], members[2]];
    return (
      <div
        className="flex w-[76px] shrink-0 flex-col items-center justify-end pb-0.5"
        aria-label="People who liked this"
      >
        <div className="relative z-[5] -mb-3 flex justify-center">
          <PyramidFace m={top} z={50} />
        </div>
        <div className="relative z-[1] flex flex-row justify-center">
          <PyramidFace m={leftBase} z={30} className="-mr-[11px]" />
          <PyramidFace m={rightBase} z={40} />
        </div>
      </div>
    );
  }
  if (members.length === 2) {
    return (
      <div
        className="flex w-[76px] shrink-0 flex-col items-center justify-end pb-0.5"
        aria-label="People who liked this"
      >
        <div className="relative z-[4] -mb-3 flex justify-center">
          <PyramidFace m={members[0]} z={40} />
        </div>
        <div className="relative z-[1] flex justify-center">
          <PyramidFace m={members[1]} z={20} />
        </div>
      </div>
    );
  }
  return null;
}

function renderAggregatedLikeTitleWeb(item: ActivityItem): ReactNode {
  const g = item.likeGroup!;
  const suffix =
    g.target === "post" ? " liked your post" : " liked your comment";
  const { members, othersCount } = g;

  if (othersCount > 0) {
    return (
      <span className="inline-flex flex-wrap items-baseline gap-x-0">
        {members.map((m, i) => (
          <Fragment key={m.id}>
            {i > 0 ? <span className="text-gray-900">, </span> : null}
            <MemberNameLink id={m.id}>{displayMemberName(m)}</MemberNameLink>
          </Fragment>
        ))}
        <span className="text-gray-900">
          {`, and ${othersCount} ${othersCount === 1 ? "other" : "others"}${suffix}`}
        </span>
      </span>
    );
  }

  if (members.length === 2) {
    return (
      <span className="inline-flex flex-wrap items-baseline gap-x-1">
        <MemberNameLink id={members[0].id}>{displayMemberName(members[0])}</MemberNameLink>
        <span className="text-gray-900"> and </span>
        <MemberNameLink id={members[1].id}>{displayMemberName(members[1])}</MemberNameLink>
        <span className="text-gray-900">{suffix}</span>
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-0">
      <MemberNameLink id={members[0].id}>{displayMemberName(members[0])}</MemberNameLink>
      <span className="text-gray-900">, </span>
      <MemberNameLink id={members[1].id}>{displayMemberName(members[1])}</MemberNameLink>
      <span className="text-gray-900">, and </span>
      <MemberNameLink id={members[2].id}>{displayMemberName(members[2])}</MemberNameLink>
      <span className="text-gray-900">{suffix}</span>
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
          <span className="text-gray-900">{rest}</span>
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
        <span className="text-gray-600">: {rest}</span>
      </>
    );
  }
  if (subtitle === `${name} wants to connect`) {
    return (
      <>
        <MemberNameLink id={actor.id}>{name}</MemberNameLink>
        <span className="text-gray-600"> wants to connect</span>
      </>
    );
  }
  const inv = `${name} invited you to `;
  if (subtitle.startsWith(inv)) {
    const rest = subtitle.slice(inv.length);
    return (
      <>
        <MemberNameLink id={actor.id}>{name}</MemberNameLink>
        <span className="text-gray-600"> invited you to {rest}</span>
      </>
    );
  }
  const admin = `${name} invited you to help admin `;
  if (subtitle.startsWith(admin)) {
    const rest = subtitle.slice(admin.length);
    return (
      <>
        <MemberNameLink id={actor.id}>{name}</MemberNameLink>
        <span className="text-gray-600"> invited you to help admin {rest}</span>
      </>
    );
  }
  const sale = `${name} · `;
  if (subtitle.startsWith(sale)) {
    const rest = subtitle.slice(sale.length);
    return (
      <>
        <MemberNameLink id={actor.id}>{name}</MemberNameLink>
        <span className="text-gray-600"> · {rest}</span>
      </>
    );
  }
  return subtitle;
}

export default function NotificationsPage() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [friendBusyId, setFriendBusyId] = useState<string | null>(null);

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
      <BackToProfileLink />
      <div className="mt-4 mb-2 flex flex-row items-start justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900">Activity</h1>
        <Link
          href="/my-community/messages"
          className="shrink-0 rounded-lg border border-emerald-800/20 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-900 hover:bg-emerald-100 flex items-center gap-2"
          aria-label="Inbox"
        >
          <span className="text-lg leading-none" aria-hidden>
            ✉
          </span>
          Inbox
        </Link>
      </div>
      <p className="text-gray-600 text-sm mb-6">
        Friend requests, messages, comments, likes, invites, orders, and resale offers — in one place.
      </p>

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 text-red-800 px-4 py-3 text-sm">
          {error}
          <button
            type="button"
            className="block mt-2 text-red-900 underline font-medium"
            onClick={() => {
              setLoading(true);
              load();
            }}
          >
            Retry
          </button>
        </div>
      ) : items.length === 0 ? (
        <p className="text-gray-600 text-sm leading-relaxed">
          No recent activity yet. When people interact with your posts, orders, or invites, it will show up here.
        </p>
      ) : (
        <ul className="divide-y divide-gray-200 border border-gray-200 rounded-lg overflow-hidden bg-white">
          {items.map((item) => {
            const href = webHrefFromNav(item.nav);
            const cat = CATEGORY_LABEL[item.category] ?? item.category;
            const glyph = activityGlyph(item.type);
            const friendRequestId =
              item.nav.kind === "friend_request" ? item.nav.requestId : null;
            const busy = friendRequestId != null && friendBusyId === friendRequestId;

            if (friendRequestId != null) {
              return (
                <li key={item.id} className="px-4 py-3 hover:bg-gray-50 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="text-xs font-semibold uppercase tracking-wide text-emerald-800/80 inline-flex items-center gap-1">
                        <span className="text-base leading-none" aria-hidden>
                          {glyph}
                        </span>
                        {cat}
                      </span>
                      <p className="font-semibold text-gray-900 mt-0.5">{item.title}</p>
                      {item.subtitle ? (
                        <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                          {renderSubtitleWithLeadingMemberWeb(item.subtitle, item.actor)}
                        </p>
                      ) : null}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                          onClick={() => respondFriendRequest(friendRequestId, "accepted")}
                        >
                          {busy ? "…" : "Approve"}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          className="rounded-lg border border-emerald-800 px-3 py-1.5 text-sm font-semibold text-emerald-900 hover:bg-emerald-50 disabled:opacity-50"
                          onClick={() => respondFriendRequest(friendRequestId, "declined")}
                        >
                          {busy ? "…" : "Decline"}
                        </button>
                      </div>
                    </div>
                    <time
                      className="text-xs text-gray-500 shrink-0 whitespace-nowrap"
                      dateTime={item.occurredAt}
                    >
                      {formatWhen(item.occurredAt)}
                    </time>
                  </div>
                </li>
              );
            }

            const inner = (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-1 gap-3">
                    {resolveMemberPhotoUrl(item.storeItemPhotoUrl ?? undefined) ? (
                      <ListingThumb url={item.storeItemPhotoUrl} />
                    ) : item.likeGroup && item.likeGroup.members.length > 0 ? (
                      <PyramidLikeAvatars members={item.likeGroup.members} />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <span className="text-xs font-semibold uppercase tracking-wide text-emerald-800/80 inline-flex items-center gap-1">
                        <span className="text-base leading-none" aria-hidden>
                          {glyph}
                        </span>
                        {cat}
                      </span>
                      <p className="font-semibold text-gray-900 mt-0.5">
                        {item.likeGroup
                          ? renderAggregatedLikeTitleWeb(item)
                          : renderTitleWithLeadingMemberWeb(item.title, item.actor)}
                      </p>
                      {item.subtitle ? (
                        <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                          {renderSubtitleWithLeadingMemberWeb(item.subtitle, item.actor)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <time className="text-xs text-gray-500 shrink-0 whitespace-nowrap" dateTime={item.occurredAt}>
                    {formatWhen(item.occurredAt)}
                  </time>
                </div>
                {href ? (
                  <Link
                    href={href}
                    className="text-sm text-emerald-700 font-medium mt-2 inline-block hover:underline"
                  >
                    View →
                  </Link>
                ) : null}
              </>
            );
            return (
              <li key={item.id} className="px-4 py-3 hover:bg-gray-50 transition-colors">
                <div className="px-1">{inner}</div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
