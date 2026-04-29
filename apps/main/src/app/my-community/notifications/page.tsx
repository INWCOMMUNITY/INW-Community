"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BackToProfileLink } from "@/components/BackToProfileLink";

type ActivityNav =
  | { kind: "friend_requests" }
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
  | { kind: "none" };

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
}

function webHrefFromNav(nav: ActivityNav): string | null {
  switch (nav.kind) {
    case "friend_requests":
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

export default function NotificationsPage() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="w-full max-w-2xl">
      <BackToProfileLink />
      <h1 className="text-2xl font-bold text-gray-900 mt-4 mb-2">Activity</h1>
      <p className="text-gray-600 text-sm mb-6">
        Friend requests, comments, likes, invites, orders, and resale offers — in one place.
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
            const inner = (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="text-xs font-semibold uppercase tracking-wide text-emerald-800/80">
                      {cat}
                    </span>
                    <p className="font-semibold text-gray-900 mt-0.5">{item.title}</p>
                    {item.subtitle ? (
                      <p className="text-sm text-gray-600 mt-1 line-clamp-2">{item.subtitle}</p>
                    ) : null}
                  </div>
                  <time className="text-xs text-gray-500 shrink-0 whitespace-nowrap" dateTime={item.occurredAt}>
                    {formatWhen(item.occurredAt)}
                  </time>
                </div>
                {href ? (
                  <span className="text-sm text-emerald-700 font-medium mt-2 inline-block">View →</span>
                ) : null}
              </>
            );
            return (
              <li key={item.id} className="px-4 py-3 hover:bg-gray-50 transition-colors">
                {href ? (
                  <Link href={href} className="block -mx-1 px-1">
                    {inner}
                  </Link>
                ) : (
                  <div className="px-1">{inner}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
