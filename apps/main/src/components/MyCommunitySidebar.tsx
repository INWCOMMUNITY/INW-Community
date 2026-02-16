"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type SidebarItem = { href: string; label: string } | { divider: string };

const SIDEBAR_ITEMS: SidebarItem[] = [
  { divider: "Social" },
  { href: "/my-community", label: "Feed" },
  { href: "/my-community/my-page", label: "My Page" },
  { href: "/my-community/friends", label: "Friends / Following" },
  { href: "/my-community/find-members", label: "Find Members" },
  { href: "/my-community/groups", label: "Groups" },
  { divider: "My Hub" },
  { href: "/my-community/businesses", label: "My Businesses" },
  { href: "/my-community/sellers", label: "My Sellers" },
  { href: "/my-community/events", label: "My Events" },
  { href: "/my-community/coupons", label: "My Coupons" },
  { href: "/my-community/wantlist", label: "My Wishlist" },
  { href: "/my-community/orders", label: "My Orders" },
  { divider: "My Rewards" },
  { href: "/my-community/points", label: "Community Points" },
  { href: "/my-community/rewards", label: "Rewards" },
  { href: "/my-community/my-badges", label: "My Badges" },
  { href: "/badges", label: "Community Badges" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/my-community") {
    return pathname === "/my-community" || pathname === "/my-community/";
  }
  if (pathname === href) return true;
  if (pathname.startsWith(href + "/")) return true;
  return false;
}

export function MyCommunitySidebar() {
  const pathname = usePathname();

  return (
    <nav className="border rounded-lg p-4 bg-gray-50 sticky top-24">
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 px-1">
        My Community
      </h2>
      <ul className="space-y-1">
        {SIDEBAR_ITEMS.map((item, i) =>
          "divider" in item ? (
            <li key={`div-${item.divider}-${i}`} className="pt-3 mt-3 border-t border-gray-200 first:pt-0 first:mt-0 first:border-0">
              <span className="block py-1 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                {item.divider}
              </span>
            </li>
          ) : (
            <li key={item.href}>
              <Link
                href={item.href}
                prefetch={false}
                className={`block py-2 px-3 rounded transition font-medium ${
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
                {item.label}
              </Link>
            </li>
          )
        )}
      </ul>
    </nav>
  );
}
