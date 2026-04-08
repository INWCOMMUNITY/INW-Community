"use client";

import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { BlogsNavItem } from "./BlogsNavItem";
import { FlaggedNavItem } from "./FlaggedNavItem";
import { IonIcon } from "@/components/IonIcon";

const MAIN_SITE_URL = process.env.NEXT_PUBLIC_MAIN_SITE_URL || "http://localhost:3000";

type SidebarItem = { href: string; label: string; icon: string; external?: boolean };

const SETTINGS_MY_BUSINESS: { href: string; label: string; icon: string }[] = [
  { href: "/dashboard/business-info", label: "Business Info", icon: "information-circle-outline" },
  { href: "/dashboard/disputes", label: "Disputes", icon: "warning-outline" },
  { href: "/dashboard/traffic", label: "Traffic", icon: "pulse-outline" },
];

const SETTINGS_WEBSITE: { href: string; label: string; icon: string; external?: boolean }[] = [
  { href: "/dashboard/design", label: "Design", icon: "color-palette-outline" },
  { href: "/dashboard/site-images", label: "Site Images", icon: "images-outline" },
  { href: MAIN_SITE_URL, label: "See Website", icon: "globe-outline", external: true },
];

const SIDEBAR_SECTIONS: { divider: string; items: SidebarItem[] }[] = [
  {
    divider: "INW Community",
    items: [
      { href: "/dashboard/members", label: "Members", icon: "people-outline" },
      { href: "/dashboard/subscriptions", label: "Subscriptions", icon: "card-outline" },
      { href: "/dashboard/sponsors", label: "Business Subscriptions", icon: "business-outline" },
      { href: "/dashboard/businesses", label: "Businesses", icon: "storefront-outline" },
      { href: "/dashboard/sellers", label: "Sellers", icon: "bag-handle-outline" },
    ],
  },
  {
    divider: "Incentives",
    items: [
      { href: "/dashboard/coupons", label: "Coupons", icon: "pricetag-outline" },
      { href: "/dashboard/seasons", label: "Seasons", icon: "leaf-outline" },
      { href: "/dashboard/rewards", label: "Rewards", icon: "gift-outline" },
      { href: "/dashboard/top5", label: "NWC Top 10 Prizes", icon: "trophy-outline" },
      { href: "/dashboard/points-config", label: "Points", icon: "star-outline" },
      { href: "/dashboard/badges", label: "Badges", icon: "ribbon-outline" },
    ],
  },
  {
    divider: "Community",
    items: [
      { href: "/dashboard/group-requests", label: "Groups", icon: "people-circle-outline" },
      { href: "/dashboard/group-deletion-requests", label: "Group Deletions", icon: "trash-outline" },
      { href: "/dashboard/events", label: "Events", icon: "calendar-outline" },
      { href: "/dashboard/blogs", label: "Blogs", icon: "newspaper-outline" },
      { href: "/dashboard/posts", label: "Posts", icon: "document-text-outline" },
      { href: "/dashboard/tags", label: "Tags", icon: "pricetags-outline" },
      { href: "/dashboard/flagged", label: "Flagged", icon: "flag-outline" },
      { href: "/dashboard/reports", label: "Reports", icon: "bar-chart-outline" },
    ],
  },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const ok = sessionStorage.getItem("nwc_admin") === "1";
    if (!ok) {
      router.replace("/");
      return;
    }
  }, [router]);

  useEffect(() => {
    if (!settingsOpen) return;
    function onDocMouseDown(e: MouseEvent) {
      const t = e.target as HTMLElement;
      if (t.closest?.("[data-admin-settings-root]")) return;
      setSettingsOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSettingsOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [settingsOpen]);

  function isActive(href: string) {
    if (href.startsWith("http")) return false;
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname === href || pathname?.startsWith(href + "/");
  }

  const SidebarNav = () => (
    <nav className="flex flex-col gap-1 py-4">
      <Link
        href="/dashboard"
        className={`flex items-center gap-2.5 px-4 py-2 text-sm font-medium rounded-r ${
          isActive("/dashboard")
            ? "border-l-4"
            : "hover:bg-[#FDEDCC]/30"
        }`}
        style={isActive("/dashboard") ? { backgroundColor: "#FDEDCC", color: "#3E432F", borderColor: "#505542" } : { color: "#505542" }}
      >
        <IonIcon name="home-outline" size={20} className="opacity-90 shrink-0" />
        <span>Dashboard</span>
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
                  className="flex items-center gap-2.5 px-4 py-2 text-sm font-medium rounded-r hover:bg-[#FDEDCC]/30"
                  style={{ color: "#505542" }}
                >
                  <IonIcon name={item.icon} size={20} className="opacity-90 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </a>
              ) : item.href === "/dashboard/blogs" ? (
                <BlogsNavItem
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  icon={item.icon}
                  isActive={isActive(item.href)}
                  onClick={() => setSidebarOpen(false)}
                />
              ) : item.href === "/dashboard/flagged" ? (
                <FlaggedNavItem
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  icon={item.icon}
                  isActive={isActive(item.href)}
                  onClick={() => setSidebarOpen(false)}
                />
              ) : (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setSidebarOpen(false)}
                  className={`flex items-center gap-2.5 px-4 py-2 text-sm font-medium rounded-r ${
                    isActive(item.href)
                      ? "border-l-4"
                      : "hover:bg-[#FDEDCC]/30"
                  }`}
                  style={isActive(item.href) ? { backgroundColor: "#FDEDCC", color: "#3E432F", borderColor: "#505542" } : { color: "#505542" }}
                >
                  <IonIcon name={item.icon} size={20} className="opacity-90 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </Link>
              )
            )}
          </div>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen flex flex-col overflow-x-hidden">
      <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:flex-col md:w-60 md:shrink-0 bg-white border-r" style={{ borderColor: "#e5e3df" }}>
        <div className="flex h-[52px] shrink-0 items-center px-4 border-b" style={{ borderColor: "#e5e3df" }}>
          <span className="text-sm font-bold leading-tight" style={{ color: "#3E432F" }}>NWC ADMIN HUB</span>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0">
          <SidebarNav />
        </div>
        <div className="p-4 border-t shrink-0" style={{ borderColor: "#e5e3df" }}>
          <a
            href={MAIN_SITE_URL}
            className="flex w-full items-center gap-2.5 py-2 text-sm font-medium hover:underline"
            style={{ color: "#505542" }}
          >
            <IonIcon name="home-outline" size={20} className="opacity-90 shrink-0" />
            <span>NWC Home</span>
          </a>
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
          <span className="text-sm font-bold leading-tight" style={{ color: "#3E432F" }}>NWC ADMIN HUB</span>
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
          <a
            href={MAIN_SITE_URL}
            className="flex w-full items-center gap-2.5 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 hover:underline"
          >
            <IonIcon name="home-outline" size={20} className="opacity-90 shrink-0" />
            <span>NWC Home</span>
          </a>
        </div>
      </aside>

      {/* basis-0: flex item can shrink below content width so table wrappers get real overflow + scrollbars */}
      <div className="flex min-h-0 min-w-0 flex-1 basis-0 flex-col overflow-hidden">
        <header
          className="shrink-0 sticky top-0 z-30 bg-white border-b px-4 flex items-center gap-2 h-[52px]"
          style={{ borderColor: "#e5e3df" }}
        >
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="md:hidden p-2 hover:bg-[#FDEDCC]/30 rounded shrink-0"
            style={{ color: "#505542" }}
            aria-label="Open menu"
          >
            ☰
          </button>
          <div className="flex-1 min-w-0" aria-hidden />
          <div className="relative shrink-0" data-admin-settings-root>
            <button
              type="button"
              onClick={() => setSettingsOpen((o) => !o)}
              className="flex items-center justify-center p-2 rounded hover:bg-[#FDEDCC]/40"
              style={{ color: "#505542" }}
              aria-expanded={settingsOpen}
              aria-haspopup="true"
              aria-label="Settings menu"
            >
              <IonIcon name="settings-outline" size={22} className="opacity-90" />
            </button>
            {settingsOpen ? (
              <div
                className="absolute right-0 top-full mt-1 w-56 rounded-lg border bg-white py-2 shadow-lg z-50"
                style={{ borderColor: "#e5e3df" }}
                role="menu"
              >
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">My Business</div>
                {SETTINGS_MY_BUSINESS.map((it) => (
                  <Link
                    key={it.href}
                    href={it.href}
                    role="menuitem"
                    className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-[#FDEDCC]/40"
                    style={{ color: "#3E432F" }}
                    onClick={() => setSettingsOpen(false)}
                  >
                    <IonIcon name={it.icon} size={18} className="opacity-90 shrink-0" />
                    {it.label}
                  </Link>
                ))}
                <div className="mt-2 border-t pt-2 px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500" style={{ borderColor: "#e5e3df" }}>
                  Website
                </div>
                {SETTINGS_WEBSITE.map((it) =>
                  it.external ? (
                    <a
                      key={it.label}
                      href={it.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      role="menuitem"
                      className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-[#FDEDCC]/40"
                      style={{ color: "#3E432F" }}
                      onClick={() => setSettingsOpen(false)}
                    >
                      <IonIcon name={it.icon} size={18} className="opacity-90 shrink-0" />
                      {it.label}
                    </a>
                  ) : (
                    <Link
                      key={it.href}
                      href={it.href}
                      role="menuitem"
                      className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-[#FDEDCC]/40"
                      style={{ color: "#3E432F" }}
                      onClick={() => setSettingsOpen(false)}
                    >
                      <IonIcon name={it.icon} size={18} className="opacity-90 shrink-0" />
                      {it.label}
                    </Link>
                  )
                )}
              </div>
            ) : null}
          </div>
        </header>
        <main className="min-h-0 min-w-0 w-full flex-1 overflow-y-auto overflow-x-hidden p-4">{children}</main>
      </div>
      </div>
    </div>
  );
}
