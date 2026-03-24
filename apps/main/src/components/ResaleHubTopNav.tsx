"use client";

import { useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IonIcon } from "@/components/IonIcon";

const SEGMENT_COLOR = "#5F6955";

type Child = { href: string; label: string; icon: string };
type NavItem =
  | { href: string; label: string; icon: string }
  | { label: string; icon: string; children: Child[] };

function isPathActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (href === "/") return false;
  if (href !== "/resale-hub" && pathname.startsWith(href)) return true;
  return false;
}

function isItemActive(pathname: string, item: NavItem): boolean {
  if ("href" in item) return isPathActive(pathname, item.href);
  return (item.children?.some((c) => isPathActive(pathname, c.href)) ?? false);
}

const storefrontChildren: Child[] = [
  { href: "/resale-hub/list", label: "List Item", icon: "add-circle-outline" },
  { href: "/resale-hub/listings", label: "My Listings", icon: "list-outline" },
  { href: "/resale-hub/orders", label: "Orders / To Ship", icon: "receipt-outline" },
  { href: "/resale-hub/deliveries", label: "Deliveries", icon: "car-outline" },
  { href: "/resale-hub/pickups", label: "Pickups", icon: "hand-left-outline" },
  { href: "/resale-hub/offers", label: "Offers", icon: "pricetag-outline" },
  { href: "/resale-hub/messages", label: "Messages", icon: "chatbubbles-outline" },
  { href: "/resale-hub/cancellations", label: "Cancellations", icon: "close-circle-outline" },
  { href: "/seller-hub/time-away", label: "Time Away", icon: "calendar-outline" },
  { href: "/resale-hub/payouts", label: "Payouts", icon: "wallet-outline" },
  { href: "/resale-hub/before-you-start", label: "Before You Start", icon: "checkbox-outline" },
];

const navItems: NavItem[] = [
  { href: "/", label: "NWC Home", icon: "home-outline" },
  { href: "/resale-hub", label: "Resale Hub", icon: "globe-outline" },
  { label: "Storefront", icon: "storefront-outline", children: storefrontChildren },
  { href: "/resale-hub/payouts", label: "Get Paid", icon: "wallet-outline" },
];

export function ResaleHubTopNav() {
  const pathname = usePathname();
  const [hoveredDropdown, setHoveredDropdown] = useState<string | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const triggerRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const segmentClass = (active: boolean) =>
    `flex-1 min-w-0 py-5 px-5 font-medium text-base whitespace-nowrap flex items-center justify-center gap-2 text-center ${
      active ? "text-white" : "text-gray-700 hover:bg-gray-50"
    }`;
  const dividerClass = (index: number) =>
    `flex-1 min-w-0 flex border-r-2 ${index === navItems.length - 1 ? "border-r-0" : ""}`;
  const dividerStyle = (index: number) =>
    index === navItems.length - 1 ? undefined : { borderRightColor: "var(--color-primary)" };
  const segmentStyle = (active: boolean) => (active ? { backgroundColor: SEGMENT_COLOR } : { backgroundColor: "white" });

  const activeSegmentIndex = navItems.findIndex((item) => isItemActive(pathname, item));

  return (
    <header className="sticky top-0 z-40 bg-white border-b-2 no-print overflow-visible py-4" style={{ borderBottomColor: "var(--color-primary)" }}>
      <div className="max-w-[var(--max-width)] mx-auto px-3 flex items-center overflow-visible">
        <nav
          className="flex flex-1 rounded-md border-2 min-w-0 overflow-visible"
          style={{ borderColor: "var(--color-primary)", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}
        >
          {navItems.map((item, index) => {
            if ("href" in item) {
              const active = index === activeSegmentIndex;
              return (
                <div key={item.label} className={dividerClass(index)} style={dividerStyle(index)}>
                  <Link
                    href={item.href}
                    prefetch={false}
                    className={segmentClass(active)}
                    style={segmentStyle(active)}
                  >
                    <IonIcon name={item.icon} size={22} />
                    <span>{item.label}</span>
                  </Link>
                </div>
              );
            }
            const hasChildren = (item.children?.length ?? 0) > 0;
            const active = index === activeSegmentIndex;
            const firstChildHref = item.children?.[0]?.href ?? "#";
            return (
              <div
                key={item.label}
                ref={(el) => { triggerRefs.current[item.label] = el; }}
                className={`relative ${dividerClass(index)}`}
                style={dividerStyle(index)}
                onMouseEnter={() => hasChildren && handleEnter(item.label)}
                onMouseLeave={handleLeave}
              >
                <Link
                  href={firstChildHref}
                  prefetch={false}
                  className={segmentClass(active)}
                  style={{ ...segmentStyle(active), display: "inline-flex", alignItems: "center" }}
                >
                  <IonIcon name={item.icon} size={22} />
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
                        const childActive = isPathActive(pathname, c.href);
                        return (
                          <Link
                            key={c.href + c.label}
                            href={c.href}
                            prefetch={false}
                            className={`w-full flex items-center gap-2 py-2.5 px-4 first:rounded-t-md last:rounded-b-md ${childActive ? "text-white hover:opacity-90" : "text-gray-700 hover:bg-gray-100"}`}
                            style={childActive ? { backgroundColor: SEGMENT_COLOR } : undefined}
                          >
                            <IonIcon name={c.icon} size={18} />
                            {c.label}
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
    </header>
  );
}
