"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useLockBodyScroll } from "@/lib/scroll-lock";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useCart } from "@/contexts/CartContext";

const SEGMENT_COLOR = "#5F6955";

type NavChild = { href: string; label: string };
type NavItem =
  | { href: string; label: string }
  | { href: string; label: string; children: NavChild[] };

const navItems: NavItem[] = [
  { href: "/", label: "Home" },
  {
    label: "Community",
    href: "/my-community",
    children: [
      { href: "/my-community", label: "Local Feed" },
      { href: "/calendars", label: "Events" },
      { href: "/community-groups", label: "Groups" },
      { href: "/blog", label: "Blogs" },
      { href: "/badges", label: "Badges" },
    ],
  },
  {
    label: "Storefront",
    href: "/storefront",
    children: [
      { href: "/storefront", label: "NWC Storefront" },
      { href: "/resale", label: "Community Resale" },
    ],
  },
  {
    label: "Support Local",
    href: "/support-local",
    children: [
      { href: "/support-local", label: "Directory" },
      { href: "/support-local/sellers", label: "Local Sellers" },
      { href: "/coupons", label: "Coupons" },
      { href: "/rewards", label: "Rewards" },
    ],
  },
  {
    label: "Members",
    href: "/support-nwc",
    children: [
      { href: "/about", label: "About" },
      { href: "/support-nwc", label: "Support NWC" },
      { href: "/sponsor-hub", label: "Business Hub" },
      { href: "/seller-hub", label: "Seller Hub" },
    ],
  },
];

function isPathActive(pathname: string, item: (typeof navItems)[number]): boolean {
  const href = "href" in item ? item.href : "";
  if (href === "/") return pathname === "/";
  if (pathname === href) return true;
  if ("children" in item) {
    return (item.children ?? []).some((c) => pathname === c.href || (c.href !== "/" && pathname.startsWith(c.href)));
  }
  return pathname.startsWith(href);
}

export function Header() {
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const { count: cartCount, setOpen: setCartOpen } = useCart();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [expandedMobileItem, setExpandedMobileItem] = useState<string | null>(null);
  useLockBodyScroll(mobileOpen);
  const toggleMobileExpand = (label: string) => setExpandedMobileItem((prev) => (prev === label ? null : label));
  useEffect(() => {
    if (!mobileOpen) setExpandedMobileItem(null);
  }, [mobileOpen]);

  return (
    <>
    <header className="sticky top-0 z-40 bg-white border-b border-gray-200 no-print" style={{ backgroundColor: "white", borderBottomColor: "#e5e7eb" }}>
      <div className="max-w-[var(--max-width)] mx-auto px-3 sm:px-4 flex items-center min-h-12 sm:min-h-14 py-1.5 sm:py-2">
        {/* Mobile: three-part layout — NWC left (50%), hamburger center, My Community + cart right (50%) */}
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
          <div className="flex flex-1 items-center justify-end gap-1.5 shrink-0 min-w-0">
            {status === "loading" ? (
              <span className="text-xs text-gray-500">...</span>
            ) : session?.user?.isSubscriber ? (
              <Link
                href="/my-community"
                prefetch={false}
                className="rounded-full px-2.5 py-2 font-medium text-[0.86rem] text-white hover:opacity-95 transition-opacity shrink-0 inline-flex items-center justify-center"
                style={{ backgroundColor: SEGMENT_COLOR }}
              >
                My Community
              </Link>
            ) : (
              <Link
                href={session ? "/my-community" : "/login"}
                className="rounded-full px-2.5 py-2 font-medium text-[0.86rem] text-white hover:opacity-95 transition-opacity shrink-0"
                style={{ backgroundColor: SEGMENT_COLOR }}
              >
                My Community
              </Link>
            )}
            {cartCount > 0 && (
              <button
                type="button"
                onClick={() => setCartOpen(true)}
                className="relative p-1.5 rounded-full hover:bg-gray-100 text-gray-600 shrink-0"
                aria-label={`Cart (${cartCount} items)`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                  <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
                  <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
                </svg>
                <span className="absolute top-0 right-0 bg-red-500 text-white text-[8px] font-bold rounded-full h-3 min-w-[0.75rem] px-0.5 flex items-center justify-center leading-none">
                  {cartCount > 99 ? "99+" : cartCount}
                </span>
              </button>
            )}
          </div>
        </div>
        {/* Desktop: original layout */}
        <div className="hidden md:flex items-center shrink-0" style={{ minHeight: 0 }}>
          <Link href="/" className="text-[1rem] sm:text-[1.2rem] md:text-[1.35rem] font-bold leading-tight text-center" style={{ fontFamily: "var(--font-heading)", color: "#333" }}>
            <span className="block">Northwest</span>
            <span className="block">Community</span>
          </Link>
        </div>
        <nav className="hidden md:flex flex-1 items-stretch min-w-0 px-[0.5in]">
          <div
            className="flex w-full max-w-full rounded-md overflow-visible border border-gray-300"
            style={{ borderColor: "#d1d5db", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}
          >
            {navItems.map((item, index) => {
              const active = isPathActive(pathname, item);
              const isFirst = index === 0;
              const isLast = index === navItems.length - 1;
              const hasChildren = "children" in item && (item.children?.length ?? 0) > 0;
              const content = (
                <>
                  <span className="text-center">{item.label}</span>
                  {hasChildren && <span className="ml-0.5 text-[10px] opacity-80" aria-hidden>▾</span>}
                </>
              );
              const segmentClass = `flex-1 min-w-0 py-4 font-medium text-base whitespace-nowrap border-r border-gray-300 ${isLast ? "border-r-0 rounded-r-md" : ""} ${isFirst ? "rounded-l-md" : ""} ${active ? "text-white" : "text-gray-700 hover:bg-gray-50"} flex items-center justify-center text-center`;
              const segmentStyle = active ? { backgroundColor: SEGMENT_COLOR } : { backgroundColor: "white" };

              if (hasChildren) {
                return (
                  <div key={item.label} className="relative group flex-1 min-w-0 flex">
                    <Link
                      href={"href" in item ? item.href : "#"}
                      prefetch={false}
                      className={segmentClass}
                      style={{ ...segmentStyle, display: "inline-flex", alignItems: "center" }}
                    >
                      {content}
                    </Link>
                    {/* Wrapper includes pt-2 bridge so hover is preserved when moving from trigger to menu */}
                    <div className="absolute top-full left-0 right-0 pt-2 pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 transition-opacity duration-150 z-[100]">
                      <div className="w-full bg-white border border-gray-300 rounded-md shadow-lg" style={{ borderColor: "#d1d5db", boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}>
                        {(item.children ?? []).map((c) => {
                          const isChildActive = pathname === c.href || (c.href !== "/" && pathname.startsWith(c.href));
                          return (
                            <Link
                              key={c.href}
                              href={c.href}
                              prefetch={false}
                              className={`block py-2.5 px-5 first:rounded-t-md last:rounded-b-md text-base text-center whitespace-nowrap ${isChildActive ? "text-white hover:opacity-90" : "text-gray-700 hover:bg-gray-100"}`}
                              style={isChildActive ? { backgroundColor: SEGMENT_COLOR } : undefined}
                            >
                              {c.label}
                            </Link>
                          );
                        })}
                        {item.label === "Community" && (session?.user as { isAdmin?: boolean })?.isAdmin && (
                          <Link
                            href="/admin"
                            prefetch={false}
                            className="block py-2.5 px-5 rounded-b-md text-base text-center text-gray-700 hover:bg-gray-100 border-t border-gray-200"
                            style={pathname.startsWith("/admin") ? { backgroundColor: SEGMENT_COLOR, color: "white" } : undefined}
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
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={false}
                  className={segmentClass}
                  style={segmentStyle}
                >
                  <span className="text-center">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
        <div className="hidden md:flex items-center justify-end gap-3 shrink-0">
          {(session?.user as { isAdmin?: boolean })?.isAdmin && (
            <Link
              href="/admin/dashboard"
              prefetch={false}
              className="rounded-full px-3 py-2 sm:px-5 sm:py-2.5 font-medium text-sm sm:text-[1.1375rem] text-gray-700 hover:bg-gray-100 transition-opacity shrink-0 border border-gray-300"
            >
              Admin
            </Link>
          )}
          {status === "loading" ? (
            <span className="text-sm text-gray-500 w-24">...</span>
          ) : session?.user?.isSubscriber ? (
            <div className="relative group shrink-0">
              <Link
                href="/my-community"
                prefetch={false}
                className="rounded-full px-3 py-2 sm:px-5 sm:py-2.5 font-medium text-sm sm:text-[1.1375rem] text-white hover:opacity-95 transition-opacity inline-flex items-center justify-center"
                style={{ backgroundColor: SEGMENT_COLOR }}
              >
                My Community
              </Link>
              <div className="absolute top-full left-1/2 -translate-x-1/2 pt-2 pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 transition-opacity duration-150 z-[100]">
                <div className="bg-white border border-gray-300 rounded-md shadow-lg min-w-[10rem]" style={{ borderColor: "#d1d5db", boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}>
                  <Link
                    href="/resale-hub"
                    prefetch={false}
                    className="block py-2.5 px-5 hover:bg-gray-100 rounded-t-md text-sm sm:text-base text-gray-700 text-center"
                  >
                    Resale Hub
                  </Link>
                  <Link
                    href="/api/auth/signout?callbackUrl=%2F"
                    className="block py-2.5 px-5 hover:bg-gray-100 rounded-b-md text-sm sm:text-base text-gray-700 text-center"
                  >
                    Log out
                  </Link>
                </div>
              </div>
            </div>
          ) : (
            <div className="relative group shrink-0">
              <Link
                href={session ? "/my-community" : "/login"}
                className="rounded-full px-3 py-2 sm:px-5 sm:py-2.5 font-medium text-sm sm:text-[1.1375rem] text-white hover:opacity-95 transition-opacity inline-flex items-center justify-center"
                style={{ backgroundColor: SEGMENT_COLOR }}
              >
                My Community
              </Link>
              {session && (
                <div className="absolute top-full left-1/2 -translate-x-1/2 pt-2 pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 transition-opacity duration-150 z-[100]">
                  <div className="bg-white border border-gray-300 rounded-md shadow-lg min-w-[10rem]" style={{ borderColor: "#d1d5db", boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}>
                    <Link
                      href="/my-community/profile"
                      prefetch={false}
                      className="block py-2.5 px-5 hover:bg-gray-100 rounded-t-md text-sm sm:text-base text-gray-700 text-center"
                    >
                      Edit profile
                    </Link>
<Link
                    href="/api/auth/signout?callbackUrl=%2F"
                    className="block py-2.5 px-5 hover:bg-gray-100 rounded-b-md text-sm sm:text-base text-gray-700 text-center"
                  >
                    Log out
                  </Link>
                  </div>
                </div>
              )}
            </div>
          )}
          {cartCount > 0 && (
            <button
              type="button"
              onClick={() => setCartOpen(true)}
              className="relative p-2 rounded-full hover:bg-gray-100 text-gray-600 shrink-0"
              aria-label={`Cart (${cartCount} items)`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
                <circle cx="9" cy="21" r="1" />
                <circle cx="20" cy="21" r="1" />
                <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
              </svg>
              <span className="absolute top-0 right-0 bg-red-500 text-white text-[10px] font-bold rounded-full h-4 min-w-[1rem] px-1 flex items-center justify-center leading-none">
                {cartCount > 99 ? "99+" : cartCount}
              </span>
            </button>
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
            className={`relative w-auto min-w-[max-content] max-w-[min(90vw,280px)] mx-auto bg-white border-b-2 border-[var(--color-primary)] shadow-xl rounded-lg shrink-0 transition-[max-height] duration-200 ${!expandedMobileItem ? `overflow-y-auto ${session?.user?.isSubscriber ? "max-h-[85vh]" : "max-h-[70vh]"}` : ""}`}
            style={{
              animation: "headerSlideDown 0.2s ease-out",
              ...(expandedMobileItem && session?.user?.isSubscriber
                ? { paddingBottom: "0.5rem", minHeight: "calc(100vh - 2rem)" }
                : {}),
            }}
            onClick={(e) => e.stopPropagation()}
          >
          <nav className="px-4 py-4 space-y-3 flex flex-col items-center text-center">
            <Link
              href="/"
              onClick={() => setMobileOpen(false)}
              className="flex justify-center pb-3 border-b border-gray-200 mb-1 w-full"
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
                className="w-full rounded-lg border-2 overflow-hidden text-left block py-3 px-4 font-medium text-gray-800 hover:bg-gray-50"
                style={{ borderColor: "var(--color-primary)" }}
              >
                Admin
              </Link>
            )}
            {navItems.map((item) => {
              const hasChildren = "children" in item && (item.children?.length ?? 0) > 0;
              const isExpanded = expandedMobileItem === item.label;
              const boxClass = "w-full rounded-lg border-2 overflow-hidden text-left";
              const boxStyle = { borderColor: "var(--color-primary)" };

              if (hasChildren) {
                return (
                  <div key={item.label} className={boxClass} style={boxStyle}>
                    <div className="flex items-center justify-between gap-2 bg-white">
                      <Link
                        href={"href" in item ? item.href : "#"}
                        prefetch={false}
                        onClick={() => setMobileOpen(false)}
                        className={`flex-1 py-3 px-3 font-medium ${isPathActive(pathname, item) ? "text-white hover:bg-opacity-90" : "text-gray-800 hover:bg-gray-50"}`}
                        style={isPathActive(pathname, item) ? { backgroundColor: "var(--color-primary)" } : undefined}
                      >
                        {item.label}
                      </Link>
                      <button
                        type="button"
                        onClick={() => toggleMobileExpand(item.label)}
                        className="shrink-0 p-3 text-gray-600 hover:bg-gray-100"
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
                      <div className="border-t border-gray-200 bg-gray-50/80">
                        {(item.children ?? []).map((c) => {
                          const isChildActive = pathname === c.href || (c.href !== "/" && pathname.startsWith(c.href));
                          return (
                            <Link
                              key={c.href}
                              href={c.href}
                              prefetch={false}
                              onClick={() => setMobileOpen(false)}
                              className={`block py-2.5 px-4 text-sm ${isChildActive ? "text-white hover:bg-opacity-90" : "text-gray-700 hover:bg-gray-100"}`}
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
                            className={`block py-2.5 px-4 text-sm ${pathname.startsWith("/admin") ? "text-white hover:bg-opacity-90" : "text-gray-700 hover:bg-gray-100"}`}
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
                  className={`${boxClass} block py-3 px-4 font-medium ${active ? "text-white hover:bg-opacity-90" : "text-gray-800 hover:bg-gray-50"}`}
                  style={{ ...boxStyle, ...(active ? { backgroundColor: "var(--color-primary)" } : {}) }}
                >
                  {item.label}
                </Link>
              );
            })}
            {session?.user?.isSubscriber && (
              <Link
                href="/resale-hub"
                prefetch={false}
                onClick={() => setMobileOpen(false)}
                className={`w-full rounded-lg border-2 overflow-hidden text-left block py-3 px-4 font-medium ${pathname === "/resale-hub" || pathname.startsWith("/resale-hub/") ? "text-white hover:bg-opacity-90" : "text-gray-800 hover:bg-gray-50"}`}
                style={{ borderColor: "var(--color-primary)", ...(pathname === "/resale-hub" || pathname.startsWith("/resale-hub/") ? { backgroundColor: "var(--color-primary)" } : {}) }}
              >
                Resale Hub
              </Link>
            )}
            {session?.user && (
              <Link
                href="/api/auth/signout?callbackUrl=%2F"
                onClick={() => setMobileOpen(false)}
                className="w-full rounded-lg border-2 overflow-hidden text-left block py-3 px-4 font-medium text-gray-800 hover:bg-gray-50"
                style={{ borderColor: "var(--color-primary)" }}
              >
                Log out
              </Link>
            )}
          </nav>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
