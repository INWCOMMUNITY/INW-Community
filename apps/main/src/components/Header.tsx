"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useLockBodyScroll } from "@/lib/scroll-lock";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useCart } from "@/contexts/CartContext";
import { isImmersiveMobileChromeRoute } from "@/lib/immersive-mobile-chrome";
import { SITE_HEADER_SIDE } from "@/components/SiteNavAlignedColumn";

const SEGMENT_COLOR = "var(--color-earth)";

type NavChild = { href: string; label: string };
type NavItem =
  | { href: string; label: string; icon: string }
  | { href: string; label: string; icon: string; children: NavChild[] };

const navItems: NavItem[] = [
  {
    label: "Home",
    href: "/",
    icon: "leaf-outline",
  },
  {
    label: "Community",
    href: "/my-community/feed",
    icon: "people-outline",
    children: [
      { href: "/my-community/feed", label: "Local Feed" },
      { href: "/calendars", label: "Events" },
      { href: "/community-groups", label: "Groups" },
      { href: "/blog", label: "Blogs" },
    ],
  },
  {
    label: "Store",
    href: "/storefront",
    icon: "bag-outline",
  },
  {
    label: "Support Local",
    href: "/support-local",
    icon: "hammer-outline",
    children: [
      { href: "/support-local", label: "Directory" },
      { href: "/support-local/sellers", label: "Local Sellers" },
      { href: "/coupons", label: "Coupons" },
    ],
  },
  {
    label: "Members",
    href: "/business-hub",
    icon: "person-circle-outline",
    children: [
      { href: "/business-hub", label: "Business Hub" },
      { href: "/seller-hub", label: "Seller Hub" },
    ],
  },
];

function navDropdownChildren(item: NavItem): NavChild[] {
  return "children" in item ? (item.children ?? []) : [];
}

function isPathActive(
  pathname: string,
  item: (typeof navItems)[number],
): boolean {
  const href = "href" in item ? item.href : "";
  if ("children" in item && (item.children?.length ?? 0) > 0) {
    const children = navDropdownChildren(item);
    const childMatch = children.some(
      (c) => pathname === c.href || (c.href !== "/" && pathname.startsWith(c.href)),
    );
    if (childMatch) return true;
  }
  if (href === "/") return pathname === "/";
  if (pathname === href) return true;
  return pathname.startsWith(href);
}

function HeaderCartButton({
  count,
  onOpen,
  size = "md",
}: {
  count: number;
  onOpen: () => void;
  size?: "sm" | "md";
}) {
  const iconClass = size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4";
  const circleClass = size === "sm" ? "h-8 w-8" : "h-9 w-9";
  const badgeClass =
    size === "sm"
      ? "absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[8px] font-bold rounded-full h-3 min-w-[0.75rem] px-0.5 flex items-center justify-center leading-none"
      : "absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full h-4 min-w-[1rem] px-1 flex items-center justify-center leading-none";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onOpen();
      }}
      className={`relative ${circleClass} rounded-full shrink-0 inline-flex items-center justify-center bg-[var(--color-section-alt)] text-[var(--color-earth)] hover:text-[var(--color-primary)] transition-colors`}
      aria-label={count > 0 ? `Cart (${count} items)` : "Cart"}
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={iconClass}>
        <circle cx="9" cy="21" r="1" />
        <circle cx="20" cy="21" r="1" />
        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
      </svg>
      {count > 0 && <span className={badgeClass}>{count > 99 ? "99+" : count}</span>}
    </button>
  );
}

function DesktopNavItem({
  item,
  pathname,
  showAdmin,
}: {
  item: NavItem;
  pathname: string;
  showAdmin?: boolean;
}) {
  const active = isPathActive(pathname, item);
  const hasChildren = "children" in item && (item.children?.length ?? 0) > 0;
  const linkClass = `py-2.5 px-5 font-bold text-sm lg:text-base whitespace-nowrap rounded-full inline-flex items-center justify-center text-center transition-colors ${active ? "text-white" : "hover:bg-[var(--color-section-alt)]"}`;
  const linkStyle = active
    ? { backgroundColor: SEGMENT_COLOR }
    : { color: "var(--color-primary)" };

  if (hasChildren) {
    return (
      <div className="relative group flex-1 min-w-0 flex items-center justify-center">
        <Link
          href={"href" in item ? item.href : "#"}
          prefetch={false}
          className={linkClass}
          style={{ ...linkStyle, display: "inline-flex", alignItems: "center" }}
        >
          <span className="text-center">{item.label}</span>
        </Link>
        <div className="absolute top-full left-0 right-0 pt-2 pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 transition-opacity duration-150 z-[100]">
          <div className="w-full bg-white border rounded-md shadow-lg" style={{ borderColor: "var(--color-primary)", boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}>
            {navDropdownChildren(item).map((c) => {
              const isChildActive = pathname === c.href || (c.href !== "/" && pathname.startsWith(c.href));
              return (
                <Link
                  key={c.href}
                  href={c.href}
                  prefetch={false}
                  className={`block py-2.5 px-5 first:rounded-t-md last:rounded-b-md text-base font-bold text-center whitespace-nowrap flex justify-center items-center ${isChildActive ? "text-white hover:opacity-90" : "hover:bg-[var(--color-section-alt)]"}`}
                  style={isChildActive ? { backgroundColor: SEGMENT_COLOR } : { color: "var(--color-primary)" }}
                >
                  {c.label}
                </Link>
              );
            })}
            {item.label === "Community" && showAdmin && (
              <Link
                href="/admin"
                prefetch={false}
                className="block py-2.5 px-5 rounded-b-md text-base font-bold text-center hover:bg-[var(--color-section-alt)] border-t flex justify-center items-center"
                style={{
                  borderTopColor: "var(--color-primary)",
                  color: pathname.startsWith("/admin") ? "white" : "var(--color-primary)",
                  ...(pathname.startsWith("/admin") ? { backgroundColor: SEGMENT_COLOR } : {}),
                }}
              >
                Admin
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-0 flex items-center justify-center">
      <Link
        href={item.href}
        prefetch={false}
        className={linkClass}
        style={linkStyle}
      >
        <span className="text-center">{item.label}</span>
      </Link>
    </div>
  );
}

export function Header() {
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const { count: cartCount, setOpen: setCartOpen } = useCart();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [expandedMobileItem, setExpandedMobileItem] = useState<string | null>(null);
  const [unreadMessages, setUnreadMessages] = useState(0);
  useLockBodyScroll(mobileOpen);
  const toggleMobileExpand = (label: string) => setExpandedMobileItem((prev) => (prev === label ? null : label));
  useEffect(() => {
    if (!mobileOpen) setExpandedMobileItem(null);
  }, [mobileOpen]);
  useEffect(() => {
    if (!session?.user?.id) {
      setUnreadMessages(0);
      return;
    }
    fetch("/api/me/sidebar-alerts", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setUnreadMessages(Number(d?.unreadMessages ?? 0)))
      .catch(() => setUnreadMessages(0));
  }, [session?.user?.id, pathname]);

  if (pathname?.startsWith("/seller-hub") || pathname?.startsWith("/admin")) {
    return null;
  }

  const hideOnMobile = isImmersiveMobileChromeRoute(pathname);
  const isAdmin = Boolean((session?.user as { isAdmin?: boolean })?.isAdmin);

  return (
    <div className={hideOnMobile ? "max-md:hidden" : undefined}>
    <header className="sticky top-0 z-50 bg-white border-b no-print py-3 sm:py-4" style={{ backgroundColor: "white", borderBottomColor: "var(--color-primary)" }}>
      <div className="max-w-[var(--max-width)] mx-auto px-3 sm:px-4 flex items-center">
        {/* Mobile: three-part layout — NWC left, hamburger center, Profile + cart right */}
        <div className="flex md:hidden flex-1 items-center justify-between min-w-0 w-full">
          <div className="flex flex-1 items-center justify-start min-w-0">
            <Link href="/" className="text-[0.94rem] font-bold leading-tight text-center inline-block" style={{ fontFamily: "var(--font-heading)", color: "#333" }}>
              <span className="block">Northwest</span>
              <span className="block">Community</span>
            </Link>
          </div>
          <button
            type="button"
            onClick={() => setMobileOpen((o) => !o)}
            className="shrink-0 p-2.5 rounded-full hover:bg-gray-100 text-gray-600"
            aria-label="Toggle menu"
            aria-expanded={mobileOpen}
          >
            <span className="text-2xl">{mobileOpen ? "✕" : "☰"}</span>
          </button>
          <div className="flex flex-1 items-center justify-end gap-2 min-w-0">
            {status === "loading" ? (
              <span className="text-xs text-gray-500">...</span>
            ) : (
              <>
                <Link
                  href={session ? "/my-community" : "/login"}
                  className="rounded-full px-4 py-2 font-medium text-[0.86rem] !text-white hover:opacity-95 transition-opacity whitespace-nowrap min-w-[6.5rem] text-center"
                  style={{ backgroundColor: SEGMENT_COLOR }}
                >
                  {session ? "Profile" : "Sign in"}
                </Link>
                <HeaderCartButton
                  count={cartCount}
                  onOpen={() => setCartOpen(true)}
                  size="sm"
                />
              </>
            )}
          </div>
        </div>
        {/* Desktop: live layout — equal side columns, compact menu pills, Profile + cart */}
        <div className={`hidden md:flex items-center justify-center ${SITE_HEADER_SIDE}`}>
          <Link href="/" className="text-[1rem] sm:text-[1.2rem] md:text-[1.35rem] font-bold leading-tight text-center" style={{ fontFamily: "var(--font-heading)", color: "#333" }}>
            <span className="block">Northwest</span>
            <span className="block">Community</span>
          </Link>
        </div>
        <nav className="hidden md:flex flex-1 items-stretch min-w-0 px-[0.5in]">
          <div className="flex w-full max-w-full items-stretch justify-evenly gap-1">
            {navItems.map((item) => (
              <DesktopNavItem
                key={item.label}
                item={item}
                pathname={pathname}
                showAdmin={isAdmin}
              />
            ))}
          </div>
        </nav>
        <div className={`hidden md:flex items-center justify-end gap-2 ${SITE_HEADER_SIDE}`}>
          {status === "loading" ? (
            <span className="text-sm text-gray-500">...</span>
          ) : (
            <>
              <div className="relative group shrink-0">
                <Link
                  href={session ? "/my-community" : "/login"}
                  className="rounded-full px-5 py-2.5 sm:px-8 sm:py-2.5 font-medium text-sm sm:text-[1.1375rem] !text-white hover:opacity-95 transition-opacity inline-flex items-center justify-center min-w-[9rem]"
                  style={{ backgroundColor: SEGMENT_COLOR }}
                >
                  {session ? "Profile" : "Sign in"}
                </Link>
                {session && (
                  <div className="absolute top-full left-1/2 -translate-x-1/2 pt-2 pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 transition-opacity duration-150 z-[100]">
                    <div className="bg-white border rounded-md shadow-lg min-w-[10rem]" style={{ borderColor: "var(--color-primary)", boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}>
                      {isAdmin && (
                        <Link
                          href="/admin/dashboard"
                          prefetch={false}
                          className="block py-2.5 px-5 hover:bg-[var(--color-section-alt)] rounded-t-md text-sm sm:text-base text-gray-700 text-center"
                        >
                          Admin
                        </Link>
                      )}
                      <Link
                        href="/my-community/messages"
                        prefetch={false}
                        className={`block py-2.5 px-5 hover:bg-[var(--color-section-alt)] text-sm sm:text-base text-gray-700 text-center ${isAdmin ? "" : "rounded-t-md"}`}
                      >
                        Messages ({unreadMessages})
                      </Link>
                      <Link
                        href="/my-community/profile"
                        prefetch={false}
                        className="block py-2.5 px-5 hover:bg-[var(--color-section-alt)] text-sm sm:text-base text-gray-700 text-center"
                      >
                        Edit profile
                      </Link>
                      <Link
                        href="/api/auth/signout?callbackUrl=%2F"
                        className="block py-2.5 px-5 hover:bg-[var(--color-section-alt)] rounded-b-md text-sm sm:text-base text-gray-700 text-center"
                      >
                        Log out
                      </Link>
                    </div>
                  </div>
                )}
              </div>
              <HeaderCartButton
                count={cartCount}
                onOpen={() => setCartOpen(true)}
              />
            </>
          )}
        </div>
      </div>
    </header>

    {/* Mobile: top-down overlay menu (separate layer over the page) */}
    {mobileOpen && (
      <div
        className="md:hidden fixed inset-0 z-[100] flex flex-col"
        aria-modal="true"
        role="dialog"
        aria-label="Main menu"
      >
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 bg-black/40 z-0"
          aria-label="Close menu"
        />
        <div
          className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex justify-center items-start pt-2 pb-8"
          onClick={() => setMobileOpen(false)}
        >
          <div
            className={`relative w-auto min-w-[max-content] max-w-[min(90vw,280px)] mx-auto bg-white shadow-xl rounded-lg shrink-0 transition-[max-height] duration-200 ${!expandedMobileItem ? "overflow-y-auto max-h-[70vh]" : ""}`}
            style={{
              animation: "headerSlideDown 0.2s ease-out",
            }}
            onClick={(e) => e.stopPropagation()}
          >
          <nav className="px-4 py-4 space-y-1 flex flex-col items-center text-center">
            <Link
              href="/"
              onClick={() => setMobileOpen(false)}
              className="flex justify-center pb-3 border-b border-gray-200 mb-2 w-full"
              aria-label="Northwest Community"
            >
              <img
                src="/nwc-logo-mobile-menu.png"
                alt="Northwest Community"
                className="w-24 h-24 object-contain"
              />
            </Link>
            {(session?.user as { isAdmin?: boolean })?.isAdmin && (
              <Link
                href="/admin/dashboard"
                prefetch={false}
                onClick={() => setMobileOpen(false)}
                className="w-full rounded-lg overflow-hidden text-left block py-3 px-4 font-medium text-gray-800 hover:bg-[var(--color-section-alt)]"
              >
                Admin
              </Link>
            )}
            {navItems.map((item) => {
              const hasChildren = "children" in item && (item.children?.length ?? 0) > 0;
              const isExpanded = expandedMobileItem === item.label;
              const rowClass = "w-full rounded-lg overflow-hidden text-left";

              if (hasChildren) {
                return (
                  <div key={item.label} className={rowClass}>
                    <div className="flex items-center justify-between gap-2 bg-white">
                      <Link
                        href={"href" in item ? item.href : "#"}
                        prefetch={false}
                        onClick={() => setMobileOpen(false)}
                        className={`flex-1 py-3 px-3 font-bold text-sm rounded-lg ${isPathActive(pathname, item) ? "text-white hover:bg-opacity-90" : "text-gray-800 hover:bg-[var(--color-section-alt)]"}`}
                        style={isPathActive(pathname, item) ? { backgroundColor: "var(--color-primary)" } : undefined}
                      >
                        {item.label}
                      </Link>
                      <button
                        type="button"
                        onClick={() => toggleMobileExpand(item.label)}
                        className="shrink-0 p-3 text-gray-600 hover:bg-gray-100 rounded-lg"
                        aria-label={isExpanded ? "Collapse" : "Expand"}
                        aria-expanded={isExpanded}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                          className={`w-5 h-5 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                        >
                          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </div>
                    {isExpanded && (
                      <div className="bg-[var(--color-section-alt)]/40">
                        {navDropdownChildren(item).map((c) => {
                          const isChildActive = pathname === c.href || (c.href !== "/" && pathname.startsWith(c.href));
                          return (
                            <Link
                              key={c.href}
                              href={c.href}
                              prefetch={false}
                              onClick={() => setMobileOpen(false)}
                              className={`block py-2.5 px-4 text-sm font-bold rounded-lg ${isChildActive ? "text-white hover:bg-opacity-90" : "text-gray-700 hover:bg-[var(--color-section-alt)]"}`}
                              style={isChildActive ? { backgroundColor: "var(--color-primary)" } : undefined}
                            >
                              {c.label}
                            </Link>
                          );
                        })}
                        {item.label === "Community" && (session?.user as { isAdmin?: boolean })?.isAdmin && (
                          <Link
                            href="/admin"
                            prefetch={false}
                            onClick={() => setMobileOpen(false)}
                            className={`block py-2.5 px-4 text-sm font-bold rounded-lg ${pathname.startsWith("/admin") ? "text-white hover:bg-opacity-90" : "text-gray-700 hover:bg-[var(--color-section-alt)]"}`}
                            style={pathname.startsWith("/admin") ? { backgroundColor: "var(--color-primary)" } : undefined}
                          >
                            Admin
                          </Link>
                        )}
                      </div>
                    )}
                  </div>
                );
              }
              const active = isPathActive(pathname, item);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={false}
                  onClick={() => setMobileOpen(false)}
                  className={`${rowClass} block py-3 px-4 font-bold text-sm ${active ? "text-white hover:bg-opacity-90" : "text-gray-800 hover:bg-[var(--color-section-alt)]"}`}
                  style={active ? { backgroundColor: "var(--color-primary)" } : undefined}
                >
                  {item.label}
                </Link>
              );
            })}
            {session?.user && (
              <Link
                href="/my-community/messages"
                prefetch={false}
                onClick={() => setMobileOpen(false)}
                className={`w-full rounded-lg overflow-hidden text-left block py-3 px-4 font-medium ${pathname?.startsWith("/my-community/messages") ? "text-white hover:bg-opacity-90" : "text-gray-800 hover:bg-[var(--color-section-alt)]"}`}
                style={pathname?.startsWith("/my-community/messages") ? { backgroundColor: "var(--color-primary)" } : undefined}
              >
                Messages ({unreadMessages})
              </Link>
            )}
            {session?.user && (
              <Link
                href="/api/auth/signout?callbackUrl=%2F"
                onClick={() => setMobileOpen(false)}
                className="w-full rounded-lg overflow-hidden text-left block py-3 px-4 font-medium text-gray-800 hover:bg-[var(--color-section-alt)]"
              >
                Log out
              </Link>
            )}
          </nav>
          </div>
        </div>
      </div>
    )}
    </div>
  );
}
