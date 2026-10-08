"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IonIcon } from "@/components/IonIcon";
import { SellerHubMobileDrawer } from "@/components/SellerHubMobileDrawer";

const SEGMENT_COLOR = "#5F6955";

type Child = { href: string; label: string; icon: string; alert?: boolean };
type NavItem =
  | { href: string; label: string; icon: string; alert?: boolean }
  | { label: string; icon: string; children: Child[] };

function hrefPath(href: string): string {
  return href.split("?")[0] || href;
}

function isPathActive(pathname: string, href: string): boolean {
  const path = hrefPath(href);
  if (path === "/") return pathname === "/";
  if (path === "/seller-hub") return pathname === "/seller-hub";
  if (path === "/seller-hub/store") return pathname === "/seller-hub/store";
  if (pathname === path) return true;
  if (pathname.startsWith(`${path}/`)) return true;
  return false;
}

function isItemActive(pathname: string, item: NavItem): boolean {
  if ("href" in item) return isPathActive(pathname, item.href);
  return (
    item.children?.some(
      (c) => !c.href.startsWith("http") && c.href !== "#stripe" && isPathActive(pathname, c.href)
    ) ?? false
  );
}

function dropdownLandingHref(item: Extract<NavItem, { children: Child[] }>): string {
  if (item.label === "Listings") return "/seller-hub/store/items";
  if (item.label === "Orders") return "/seller-hub/orders";
  if (item.label === "Store") return "/seller-hub/store";
  if (item.label === "Money") return "/seller-hub/store/payouts";
  const first = item.children.find((c) => !c.href.startsWith("http") && c.href !== "#stripe");
  return first?.href ?? "#";
}

export function SellerHubTopNav() {
  const pathname = usePathname();
  const [hoveredDropdown, setHoveredDropdown] = useState<string | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const triggerRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [hasLocalDelivery, setHasLocalDelivery] = useState(false);
  const [payoutReady, setPayoutReady] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleEnter = useCallback((label: string) => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    const el = triggerRefs.current[label];
    if (el && typeof document !== "undefined") {
      const rect = el.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + 4,
        left: rect.left + rect.width / 2,
      });
    }
    setHoveredDropdown(label);
  }, []);

  const handleLeave = useCallback(() => {
    closeTimeoutRef.current = setTimeout(() => setHoveredDropdown(null), 120);
  }, []);

  useEffect(() => {
    fetch("/api/seller-hub/pending-actions", { credentials: "include" })
      .then((r) => r.json())
      .then((d: { hasLocalDelivery?: boolean; payoutReady?: boolean }) => {
        setHasLocalDelivery(Boolean(d?.hasLocalDelivery));
        setPayoutReady(Boolean(d?.payoutReady));
      })
      .catch(() => {});
  }, []);

  const listingsChildren: Child[] = [
    { href: "/seller-hub/store/items", label: "My Items", icon: "cube-outline" },
    { href: "/seller-hub/store/new", label: "List Item", icon: "add-circle-outline" },
    { href: "/seller-hub/apps", label: "Sync Airport", icon: "apps-outline" },
  ];

  const ordersChildren: Child[] = [
    { href: "/seller-hub/orders", label: "Fulfillment", icon: "receipt-outline" },
    ...(hasLocalDelivery
      ? [{ href: "/seller-hub/orders?tab=deliveries", label: "Deliveries", icon: "bicycle-outline" }]
      : []),
    { href: "/seller-hub/offers", label: "Offers", icon: "pricetag-outline" },
  ];

  const storeChildren: Child[] = [
    { href: "/seller-hub/store", label: "Storefront Info", icon: "storefront-outline" },
    { href: "/seller-hub/policies", label: "Policies", icon: "book-outline" },
    { href: "/seller-hub/shipping-setup", label: "Shipping", icon: "boat-outline" },
    { href: "/seller-hub/shipping-options", label: "Shipping Options", icon: "cube-outline" },
    { href: "/seller-hub/time-away", label: "Time Away", icon: "calendar-outline" },
    { href: "/business-hub?from=seller-hub", label: "Business Hub", icon: "business-outline" },
  ];

  const navItems: NavItem[] = [
    { href: "/", label: "NWC Home", icon: "home-outline" },
    { href: "/seller-hub", label: "Seller Hub", icon: "globe-outline" },
    { label: "Listings", icon: "cube-outline", children: listingsChildren },
    { label: "Orders", icon: "receipt-outline", children: ordersChildren },
    { label: "Store", icon: "storefront-outline", children: storeChildren },
    {
      href: "/seller-hub/store/payouts",
      label: "Money",
      icon: "wallet-outline",
      alert: payoutReady,
    },
  ];

  async function handleStripeClick(e?: React.MouseEvent) {
    e?.preventDefault();
    const res = await fetch("/api/stripe/connect/express-dashboard", { credentials: "include" });
    const d = await res.json().catch(() => ({}));
    if (d?.url) window.open(d.url, "_blank", "noopener,noreferrer");
    else window.location.href = "/seller-hub/store/payouts";
  }

  const segmentClass = (active: boolean) =>
    `flex-1 min-w-0 py-5 px-5 font-medium text-base whitespace-nowrap flex items-center justify-center gap-2 text-center transition-colors ${
      active ? "text-white" : "bg-transparent text-gray-700 group-hover/seg:text-white"
    }`;
  const dividerClass = (index: number, active: boolean) =>
    `group/seg flex-1 min-w-0 flex border-r-2 transition-colors ${
      index === navItems.length - 1 ? "border-r-0" : ""
    } ${active ? "" : "hover:bg-[#5d4f40]"}`;
  const dividerStyle = (index: number) =>
    index === navItems.length - 1 ? undefined : { borderRightColor: "var(--color-primary)" };
  const submenuItemClass =
    "w-full flex items-center gap-2 py-2.5 px-4 text-base text-gray-700 transition-colors hover:bg-[#5d4f40] hover:text-white first:rounded-t-md last:rounded-b-md";

  const activeSegmentIndex = navItems.findIndex((item) => isItemActive(pathname, item));

  return (
    <header className="sticky top-0 z-40 bg-white border-b-2 no-print overflow-visible py-2 lg:py-4" style={{ borderBottomColor: "var(--color-primary)" }}>
      <div className="lg:hidden max-w-[var(--max-width)] mx-auto px-3 flex items-center gap-3">
        <span className="shrink-0 size-10" aria-hidden />
        <span
          className="flex-1 text-center text-base font-bold truncate"
          style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
        >
          Seller Hub
        </span>
        <button
          type="button"
          className="shrink-0 size-10 inline-flex items-center justify-center rounded-lg border-2 text-[var(--color-heading)] hover:bg-gray-50 p-0"
          style={{ borderColor: "var(--color-primary)" }}
          aria-label="Open Seller Hub menu"
          aria-expanded={mobileMenuOpen}
          onClick={() => setMobileMenuOpen(true)}
        >
          <IonIcon name="menu-outline" size={20} />
        </button>
      </div>

      <div className="max-w-[var(--max-width)] mx-auto px-3 overflow-visible hidden lg:block">
        <nav
          className="flex w-full rounded-md border-2 min-w-0 overflow-visible"
          style={{ borderColor: "var(--color-primary)", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}
        >
          {navItems.map((item, index) => {
            if ("href" in item) {
              const active = index === activeSegmentIndex;
              return (
                <div
                  key={item.label}
                  className={dividerClass(index, active)}
                  style={{
                    ...dividerStyle(index),
                    ...(active ? { backgroundColor: SEGMENT_COLOR } : undefined),
                  }}
                >
                  <Link
                    href={item.href}
                    prefetch={false}
                    className={segmentClass(active)}
                  >
                    <IonIcon name={item.icon} size={22} className="text-current" />
                    <span>{item.label}</span>
                    {item.alert ? (
                      <span
                        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold leading-none text-white"
                        style={{ backgroundColor: "var(--color-secondary)" }}
                        aria-label="Payout ready"
                      >
                        !
                      </span>
                    ) : null}
                  </Link>
                </div>
              );
            }
            const hasChildren = (item.children?.length ?? 0) > 0;
            const active = index === activeSegmentIndex;
            const firstChildHref = dropdownLandingHref(item);
            return (
              <div
                key={item.label}
                ref={(el) => { triggerRefs.current[item.label] = el; }}
                className={`relative ${dividerClass(index, active)}`}
                style={{
                  ...dividerStyle(index),
                  ...(active ? { backgroundColor: SEGMENT_COLOR } : undefined),
                }}
                onMouseEnter={() => hasChildren && handleEnter(item.label)}
                onMouseLeave={handleLeave}
              >
                <Link
                  href={hasChildren && !firstChildHref.startsWith("http") && firstChildHref !== "#stripe" ? firstChildHref : "#"}
                  prefetch={false}
                  className={`${segmentClass(active)} !inline-flex items-center`}
                >
                  <IonIcon name={item.icon} size={22} className="text-current" />
                  <span>{item.label}</span>
                  {hasChildren && <span className="text-xs opacity-80" aria-hidden>▾</span>}
                </Link>
                {hasChildren && hoveredDropdown === item.label && typeof document !== "undefined" && createPortal(
                  <div
                    className="fixed z-[9999] pt-1 -translate-x-1/2"
                    style={{ top: dropdownPosition.top, left: dropdownPosition.left }}
                    onMouseEnter={() => handleEnter(item.label)}
                    onMouseLeave={handleLeave}
                  >
                    <div className="min-w-[12rem] bg-white border-2 rounded-md shadow-lg py-1" style={{ borderColor: "var(--color-primary)", boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}>
                      {item.children.map((c) => {
                        if (c.href === "#stripe") {
                          return (
                            <button
                              key={c.label}
                              type="button"
                              onClick={handleStripeClick}
                              className={`${submenuItemClass} text-left`}
                            >
                              <IonIcon name={c.icon} size={18} className="text-current" />
                              {c.label}
                            </button>
                          );
                        }
                        if (c.href.startsWith("http")) {
                          return (
                            <a
                              key={c.label}
                              href={c.href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={submenuItemClass}
                            >
                              <IonIcon name={c.icon} size={18} className="text-current" />
                              {c.label}
                            </a>
                          );
                        }
                        const childActive = isPathActive(pathname, c.href);
                        return (
                          <Link
                            key={c.href + c.label}
                            href={c.href}
                            prefetch={false}
                            className={
                              childActive
                                ? "w-full flex items-center gap-2 py-2.5 px-4 first:rounded-t-md last:rounded-b-md text-white hover:bg-[var(--color-earth)]"
                                : submenuItemClass
                            }
                            style={childActive ? { backgroundColor: SEGMENT_COLOR } : undefined}
                          >
                            <IonIcon name={c.icon} size={18} className="text-current" />
                            {c.label}
                            {c.alert ? (
                              <span
                                className="ml-auto inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold leading-none text-white"
                                style={{ backgroundColor: "var(--color-secondary)" }}
                                aria-label="Action needed"
                              >
                                !
                              </span>
                            ) : null}
                          </Link>
                        );
                      })}
                    </div>
                  </div>,
                  document.body
                )}
              </div>
            );
          })}
        </nav>
      </div>
      <SellerHubMobileDrawer
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        onStripeDashboard={() => void handleStripeClick()}
        hasLocalDelivery={hasLocalDelivery}
      />
    </header>
  );
}
