"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useMemo } from "react";
import { CreatePostButton } from "@/components/CreatePostButton";
import { IonIcon } from "@/components/IonIcon";

type SidebarItem =
  | { href: string; label: string; icon: string }
  | { divider: string }
  | { action: "create-post"; label: string; icon: string };

const SIDEBAR_BASE: SidebarItem[] = [
  { divider: "Social" },
  { href: "/my-community/messages", label: "My Messages", icon: "chatbubbles-outline" },
  { href: "/my-community/feed", label: "Feed", icon: "newspaper-outline" },
  { href: "/my-community/my-page", label: "My Page", icon: "person-outline" },
  { href: "/my-community/friends", label: "My Friends", icon: "people-outline" },
  { href: "/my-community/groups", label: "Groups", icon: "people-circle-outline" },
  { divider: "Actions" },
  { action: "create-post", label: "Create Post", icon: "add-circle-outline" },
  { href: "/my-community/tags", label: "Manage Tags", icon: "pricetag-outline" },
  { href: "/my-community/post-event", label: "Add Event", icon: "calendar-outline" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/my-community") {
    return pathname === "/my-community" || pathname === "/my-community/";
  }
  if (pathname === href) return true;
  // For /my-community/feed, only highlight when exactly that path (not deeper)
  if (href === "/my-community/feed") {
    return pathname === "/my-community/feed" || pathname.startsWith("/my-community/feed/");
  }
  if (pathname.startsWith(href + "/")) return true;
  return false;
}

export function MyCommunitySidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const isAdmin = (session?.user as { isAdmin?: boolean })?.isAdmin;

  const sidebarItems = useMemo(() => {
    const items: SidebarItem[] = [...SIDEBAR_BASE];
    return items;
  }, []);

  return (
    <nav
      className="border-2 rounded-lg p-2.5 bg-gray-50 text-base leading-snug"
      style={{ borderColor: "var(--color-primary)" }}
    >
      <h2
        className="text-xs font-semibold uppercase tracking-wide mb-2.5 px-1 leading-tight"
        style={{ color: "var(--color-primary)" }}
      >
        INW Community
      </h2>
      <ul className="space-y-1">
        {sidebarItems.map((item, i) =>
          "divider" in item ? (
            <li
              key={`div-${item.divider}-${i}`}
              className="pt-3 mt-3 border-t first:pt-0 first:mt-0 first:border-0"
              style={{ borderColor: "var(--color-primary)" }}
            >
              <span className="block py-0.5 px-2.5 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-primary)" }}>
                {item.divider}
              </span>
            </li>
          ) : "action" in item && item.action === "create-post" ? (
            <li key="create-post">
              <CreatePostButton className="flex items-center gap-2 w-full text-left py-2 px-2.5 rounded transition font-medium text-gray-800 hover:bg-gray-200 text-base">
                <IonIcon name={item.icon} size={20} className="shrink-0" />
                <span className="truncate">{item.label}</span>
              </CreatePostButton>
            </li>
          ) : "href" in item ? (
            <li key={item.href}>
              <Link
                href={item.href}
                prefetch={false}
                className={`flex items-center gap-2 py-2 px-2.5 rounded transition font-medium text-base ${
                  isActive(pathname, item.href)
                    ? "text-white"
                    : "text-gray-800 hover:bg-gray-200"
                }`}
                style={
                  isActive(pathname, item.href)
                    ? { backgroundColor: "var(--color-primary)" }
                    : undefined
                }
              >
                <IonIcon name={item.icon} size={20} className="shrink-0" />
                <span className="truncate">{item.label}</span>
              </Link>
            </li>
          ) : null
        )}
        {isAdmin && (
          <li className="pt-2 mt-2 border-t" style={{ borderColor: "var(--color-primary)" }}>
            <Link
              href="/admin"
              prefetch={false}
              className={`flex items-center gap-2 py-2 px-2.5 rounded transition font-medium text-base ${
                pathname.startsWith("/admin")
                  ? "text-white"
                  : "text-gray-800 hover:bg-gray-200"
              }`}
              style={
                pathname.startsWith("/admin")
                  ? { backgroundColor: "var(--color-primary)" }
                  : undefined
              }
            >
              <IonIcon name="shield-checkmark-outline" size={20} className="shrink-0" />
              <span className="truncate">Admin</span>
            </Link>
          </li>
        )}
      </ul>
    </nav>
  );
}
