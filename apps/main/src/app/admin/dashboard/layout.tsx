"use client";

import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import Link from "next/link";
import { BlogsNavItem } from "./BlogsNavItem";
import { FlaggedNavItem } from "./FlaggedNavItem";

// When on localhost, this is the live admin URL to link to in the banner
const LIVE_ADMIN_URL = process.env.NEXT_PUBLIC_LIVE_SITE_URL || process.env.NEXT_PUBLIC_MAIN_SITE_URL || "https://inwcommunity.com";

const SIDEBAR_SECTIONS = [
  {
    divider: "NW Community",
    items: [
      { href: "/admin/dashboard/members", label: "Members" },
      { href: "/admin/dashboard/subscriptions", label: "Subscriptions" },
      { href: "/admin/dashboard/sponsors", label: "Sponsors" },
      { href: "/admin/dashboard/businesses", label: "Businesses" },
      { href: "/admin/dashboard/sellers", label: "Sellers" },
    ],
  },
  {
    divider: "Incentives",
    items: [
      { href: "/admin/dashboard/coupons", label: "Coupons" },
      { href: "/admin/dashboard/top5", label: "NWC Top 10 Prizes" },
      { href: "/admin/dashboard/points-config", label: "Points" },
      { href: "/admin/dashboard/badges", label: "Badges" },
    ],
  },
  {
    divider: "Community",
    items: [
      { href: "/admin/dashboard/events", label: "Events" },
      { href: "/admin/dashboard/blogs", label: "Blogs" },
      { href: "/admin/dashboard/posts", label: "Posts" },
      { href: "/admin/dashboard/flagged", label: "Flagged" },
      { href: "/admin/dashboard/reports", label: "Reports" },
    ],
  },
  {
    divider: "My Business",
    items: [
      { href: "/admin/dashboard/business-info", label: "Business Info" },
      { href: "/admin/dashboard/disputes", label: "Disputes" },
      { href: "/admin/dashboard/traffic", label: "Traffic" },
    ],
  },
  {
    divider: "Website",
    items: [
      { href: "/admin/dashboard/design", label: "Design" },
      { href: "/admin/dashboard/site-images", label: "Site Images" },
      { href: "/", label: "See Website", external: true },
    ],
  },
];

export default function AdminDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isLive, setIsLive] = useState<boolean | null>(null);
  useEffect(() => {
    setIsLive(typeof window !== "undefined" && !window.location.origin.includes("localhost"));
  }, []);

  function isActive(href: string) {
    if (href.startsWith("http")) return false;
    if (href === "/admin/dashboard") return pathname === "/admin/dashboard";
    return pathname === href || pathname?.startsWith(href + "/");
  }

  const SidebarNav = () => (
    <nav className="flex flex-col gap-1 py-4">
      <Link
        href="/admin/dashboard"
        className={`px-4 py-2 text-sm font-medium rounded-r ${
          isActive("/dashboard")
            ? "border-l-4"
            : "hover:bg-[#FDEDCC]/30"
        }`}
        style={isActive("/admin/dashboard") ? { backgroundColor: "#FDEDCC", color: "#3E432F", borderColor: "#505542" } : { color: "#505542" }}
      >
        Dashboard
      </Link>
      {SIDEBAR_SECTIONS.map((section) => (
        <div key={section.divider} className="mt-4">
          <div className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wider" style={{ color: "#3E432F", opacity: 0.8 }}>
            {section.divider}
          </div>
          <div className="mt-1 space-y-0.5">
            {section.items.map((item) =>
              item.external ? (
                <a
                  key={item.href}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block px-4 py-2 text-sm font-medium rounded-r hover:bg-[#FDEDCC]/30"
                  style={{ color: "#505542" }}
                >
                  {item.label}
                </a>
              ) : item.href === "/admin/dashboard/blogs" ? (
                <BlogsNavItem
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  isActive={isActive(item.href)}
                  onClick={() => setSidebarOpen(false)}
                />
              ) : item.href === "/admin/dashboard/flagged" ? (
                <FlaggedNavItem
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  isActive={isActive(item.href)}
                  onClick={() => setSidebarOpen(false)}
                />
              ) : (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setSidebarOpen(false)}
                  className={`block px-4 py-2 text-sm font-medium rounded-r ${
                    isActive(item.href)
                      ? "border-l-4"
                      : "hover:bg-[#FDEDCC]/30"
                  }`}
                  style={isActive(item.href) ? { backgroundColor: "#FDEDCC", color: "#3E432F", borderColor: "#505542" } : { color: "#505542" }}
                >
                  {item.label}
                </Link>
              )
            )}
          </div>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen flex">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:flex-col md:w-60 md:fixed md:inset-y-0 bg-white border-r" style={{ borderColor: "#e5e3df" }}>
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "#e5e3df" }}>
          <span className="font-bold" style={{ color: "#3E432F" }}>NWC Admin</span>
        </div>
        <div className="flex-1 overflow-y-auto">
          <SidebarNav />
        </div>
        <div className="p-4 border-t" style={{ borderColor: "#e5e3df" }}>
          <Link
            href="/api/auth/signout?callbackUrl=%2F"
            className="block w-full text-sm hover:underline py-2"
            style={{ color: "#505542" }}
          >
            Log out
          </Link>
        </div>
      </aside>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Mobile sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-60 bg-white border-r shadow-xl transform transition-transform md:hidden ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "#e5e3df" }}>
          <span className="font-bold" style={{ color: "#3E432F" }}>NWC Admin</span>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="p-2 text-gray-500 hover:text-gray-700"
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>
        <div className="overflow-y-auto h-[calc(100vh-120px)]">
          <SidebarNav />
        </div>
        <div className="p-4 border-t">
          <Link
            href="/api/auth/signout?callbackUrl=%2F"
            className="block w-full text-sm text-gray-600 hover:text-gray-900 hover:underline py-2"
          >
            Log out
          </Link>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 md:pl-60 min-w-0">
        {isLive === false && (
          <div className="bg-amber-100 border-b border-amber-200 px-4 py-2 text-sm text-amber-800">
            You&apos;re editing the <strong>local</strong> site. To edit the live site, go to{" "}
            <a href={`${LIVE_ADMIN_URL}/admin`} className="font-medium underline hover:no-underline">{LIVE_ADMIN_URL}/admin</a>
          </div>
        )}
        <header className="sticky top-0 z-30 bg-white border-b px-4 py-3 flex items-center justify-between md:justify-end" style={{ borderColor: "#e5e3df" }}>
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="md:hidden p-2 hover:bg-[#FDEDCC]/30 rounded"
            style={{ color: "#505542" }}
            aria-label="Open menu"
          >
            ☰
          </button>
          <div className="md:hidden w-8" />
        </header>
        <main className="p-4">{children}</main>
      </div>
    </div>
  );
}
