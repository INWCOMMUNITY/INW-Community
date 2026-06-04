"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IonIcon } from "@/components/IonIcon";

const GUEST_LINKS = [
  { href: "/my-community/feed", label: "Feed", icon: "newspaper-outline" },
  { href: "/my-community/groups", label: "Groups", icon: "people-circle-outline" },
  { href: "/my-community/friends", label: "My Friends", icon: "people-outline" },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/my-community/feed") {
    return pathname === "/my-community/feed" || pathname.startsWith("/my-community/feed/");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function guestHref(href: string): string {
  return `/login?callbackUrl=${encodeURIComponent(href)}`;
}

/** Sidebar for signed-out visitors — same size/position as `MyCommunitySidebar`. */
export function MyCommunityGuestSidebar() {
  const pathname = usePathname();

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
        <li>
          <span
            className="block py-0.5 px-2.5 text-xs font-semibold uppercase tracking-wide"
            style={{ color: "var(--color-primary)" }}
          >
            Social
          </span>
        </li>
        {GUEST_LINKS.map((item) => {
          const active = isActive(pathname, item.href);
          const href = active ? item.href : guestHref(item.href);
          return (
            <li key={item.href}>
              <Link
                href={href}
                prefetch={false}
                className={`flex items-center gap-2 py-2 px-2.5 rounded transition font-medium text-base ${
                  active ? "text-white" : "text-gray-800 hover:bg-gray-200"
                }`}
                style={active ? { backgroundColor: "var(--color-primary)" } : undefined}
              >
                <IonIcon name={item.icon} size={20} className="shrink-0" />
                <span className="truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
        <li className="pt-2 mt-2 border-t" style={{ borderColor: "var(--color-primary)" }}>
          <Link
            href="/login?callbackUrl=/my-community/feed"
            prefetch={false}
            className="flex items-center gap-2 py-2 px-2.5 rounded transition font-medium text-base text-gray-800 hover:bg-gray-200"
          >
            <IonIcon name="log-in-outline" size={20} className="shrink-0" />
            <span className="truncate">Sign in</span>
          </Link>
        </li>
      </ul>
    </nav>
  );
}
