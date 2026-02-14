"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLockBodyScroll } from "@/lib/scroll-lock";

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
  { href: "/my-community/events", label: "My Events" },
  { href: "/my-community/coupons", label: "My Coupons" },
  { href: "/my-community/wantlist", label: "My Wishlist" },
  { href: "/my-community/orders", label: "My Orders" },
  { divider: "My Rewards" },
  { href: "/my-community/points", label: "Community Points" },
  { href: "/my-community/rewards", label: "Rewards" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/my-community") {
    return pathname === "/my-community" || pathname === "/my-community/";
  }
  if (pathname === href) return true;
  if (pathname.startsWith(href + "/")) return true;
  return false;
}

export function MyCommunityFloatingMenu() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useLockBodyScroll(open);

  return (
    <>
      {/* Fixed bottom-right circular green button with person outline - mobile only */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="md:hidden fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full flex items-center justify-center shadow-lg border-2 border-white"
        style={{ backgroundColor: "var(--color-primary)" }}
        aria-label="Open My Community menu"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      </button>

      {/* Slide-up panel - mobile only */}
      {open && (
        <div
          className="md:hidden fixed inset-0 z-[100] flex flex-col justify-end"
          aria-modal="true"
          role="dialog"
          aria-label="My Community menu"
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/40"
            aria-label="Close menu"
          />
          <div
            className="relative bg-white rounded-t-xl shadow-2xl max-h-[80vh] overflow-y-auto border-t-2"
            style={{ borderColor: "var(--color-primary)" }}
          >
            <div className="sticky top-0 bg-white flex justify-center py-3 border-b border-gray-200">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-2 rounded-full hover:bg-gray-100 text-gray-600"
                aria-label="Collapse menu"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6">
                  <path d="M18 15l-6-6-6 6" />
                </svg>
              </button>
            </div>
            <nav className="p-6 text-center">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
                My Community
              </h2>
              <ul className="space-y-1">
                {SIDEBAR_ITEMS.map((item, i) =>
                  "divider" in item ? (
                    <li key={`div-${item.divider}-${i}`} className="pt-3 mt-3 border-t border-gray-200 first:pt-0 first:mt-0 first:border-0">
                      <span className="block py-1 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        {item.divider}
                      </span>
                    </li>
                  ) : (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        prefetch={false}
                        onClick={() => setOpen(false)}
                        className={`block py-2.5 px-4 rounded transition font-medium text-center ${
                          isActive(pathname, item.href)
                            ? "text-white"
                            : "text-gray-800 hover:bg-gray-100"
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
          </div>
        </div>
      )}
    </>
  );
}
