"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IonIcon } from "@/components/IonIcon";
import { CreatePostModal } from "@/components/CreatePostModal";
import { SellerHubMobileDrawer } from "@/components/SellerHubMobileDrawer";

const SEGMENT_COLOR = "#5F6955";

type Child = { href: string; label: string; icon: string };
type NavItem =
  | { href: string; label: string; icon: string }
  | { label: string; icon: string; children: Child[] };

function isPathActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (href === "/") return false;
  if (href !== "/seller-hub" && pathname.startsWith(href)) return true;
  return false;
}

function isItemActive(pathname: string, item: NavItem): boolean {
  if ("href" in item) return isPathActive(pathname, item.href);
  return (item.children?.some((c) => !c.href.startsWith("http") && c.href !== "#stripe" && isPathActive(pathname, c.href)) ?? false);
}

export function SellerHubTopNav() {
  const pathname = usePathname();
  const [hoveredDropdown, setHoveredDropdown] = useState<string | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const triggerRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [pending, setPending] = useState<{
    payoutSetupComplete?: boolean;
    showDeliveries?: boolean;
  }>({ payoutSetupComplete: false, showDeliveries: false });

  const [createPostOpen, setCreatePostOpen] = useState(false);
  const [createPostBusiness, setCreatePostBusiness] = useState<{ id: string; name: string } | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  async function openCreatePostModal() {
    setHoveredDropdown(null);
    try {
      const r = await fetch("/api/seller-profile", { credentials: "include" });
      const data = await r.json().catch(() => ({}));
      if (data?.business?.id) {
        setCreatePostBusiness({ id: data.business.id, name: data.business.name ?? "Your business" });
      } else {
        setCreatePostBusiness(null);
      }
      setCreatePostOpen(true);
    } catch {
      setCreatePostBusiness(null);
      setCreatePostOpen(true);
    }
  }

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
    Promise.all([
      fetch("/api/seller-hub/pending-actions", { credentials: "include" }).then((r) => r.json()),
      fetch("/api/store-items?mine=1", { credentials: "include" })
        .then((r) => r.json())
        .then((d: { localDeliveryAvailable?: boolean }[]) => (Array.isArray(d) ? d : []))
        .then((items) => items.some((i) => i.localDeliveryAvailable === true)),
    ])
      .then(([actions, showDeliveries]) => {
        setPending({
          payoutSetupComplete: !!actions?.payoutSetupComplete,
          showDeliveries: !!showDeliveries,
        });
      })
      .catch(() => {});
  }, []);

  const storefrontChildren: Child[] = [
    { href: "/seller-hub/store/items", label: "My Items", icon: "cube-outline" },
    { href: "/seller-hub/orders", label: "Orders", icon: "receipt-outline" },
    { href: "/seller-hub/pickups", label: "Pickups", icon: "hand-left-outline" },
    { href: "/seller-hub/deliveries", label: "Deliveries", icon: "car-outline" },
    { href: "/seller-hub/offers", label: "Offers", icon: "pricetag-outline" },
    { href: "/seller-hub/store/cancellations", label: "Cancellations", icon: "close-circle-outline" },
    { href: "/seller-hub/policies", label: "Policies", icon: "book-outline" },
  ];

  const actionsChildren: Child[] = [
    { href: "/seller-hub/store/new", label: "List Item", icon: "add-circle-outline" },
    { href: "/seller-hub/orders", label: "Ship Item", icon: "boat-outline" },
    { href: "/business-hub?from=seller-hub&open=reward", label: "Offer Reward", icon: "gift-outline" },
    { href: "/business-hub?from=seller-hub&open=coupon", label: "Offer Coupon", icon: "pricetag-outline" },
    { href: "/my-community", label: "Create Post", icon: "megaphone-outline" },
  ];

  const profileChildren: Child[] = [
    { href: "/seller-hub/store", label: "Seller Storefront", icon: "storefront-outline" },
    { href: "/business-hub?from=seller-hub", label: "Local Business", icon: "business-outline" },
    { href: "/seller-hub/time-away", label: "Time Away", icon: "calendar-outline" },
    { href: "#stripe", label: "Stripe", icon: "card-outline" },
    { href: "https://apps.goshippo.com/", label: "Shippo", icon: "boat-outline" },
  ];

  const getPaidChildren: Child[] = pending.payoutSetupComplete
    ? []
    : [{ href: "/seller-hub/store/payouts", label: "Set Up / To Do", icon: "wallet-outline" }];

  const sellerHubChildren: Child[] = [
    { href: "/seller-hub", label: "Seller Hub", icon: "home-outline" },
    { href: "/business-hub?from=seller-hub", label: "Business Hub", icon: "business-outline" },
  ];

  const navItems: NavItem[] = [
    { href: "/", label: "NWC Home", icon: "home-outline" },
    { label: "Seller Hub", icon: "globe-outline", children: sellerHubChildren },
    { label: "Storefront", icon: "storefront-outline", children: storefrontChildren },
    { label: "Actions", icon: "flash-outline", children: actionsChildren },
    { label: "Profile", icon: "person-outline", children: profileChildren },
    pending.payoutSetupComplete
      ? { href: "/seller-hub/store/payouts", label: "Get Paid", icon: "wallet-outline" }
      : { label: "Get Paid", icon: "wallet-outline", children: getPaidChildren },
  ];

  async function handleStripeClick(e?: React.MouseEvent) {
    e?.preventDefault();
    const res = await fetch("/api/stripe/connect/express-dashboard", { credentials: "include" });
    const d = await res.json().catch(() => ({}));
    if (d?.url) window.open(d.url, "_blank", "noopener,noreferrer");
    else window.location.href = "/seller-hub/store/payouts";
  }

  function openCreatePostFromMenu() {
    setMobileMenuOpen(false);
    queueMicrotask(() => {
      void openCreatePostModal();
    });
  }

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
    <header className="sticky top-0 z-40 bg-white border-b-2 no-print overflow-visible py-2 lg:py-4" style={{ borderBottomColor: "var(--color-primary)" }}>
      <div className="lg:hidden max-w-[var(--max-width)] mx-auto px-3 flex items-center gap-3">
        <Link
          href="/"
          prefetch={false}
          className="shrink-0 flex items-center justify-center gap-1.5 text-sm font-semibold rounded-lg border-2 hover:bg-gray-50 max-sm:size-10 max-sm:p-0 sm:px-2 sm:py-2"
          style={{ borderColor: "var(--color-primary)", color: "var(--color-primary)" }}
        >
          <IonIcon name="home-outline" size={20} />
          <span className="hidden sm:inline">NWC Home</span>
        </Link>
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

      <div className="max-w-[var(--max-width)] mx-auto px-3 flex items-center overflow-visible hidden lg:flex">
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
            const firstChildHref = item.label === "Storefront" ? "/seller-hub/orders" : item.label === "Get Paid" ? "/seller-hub/store/payouts" : item.children?.[0]?.href ?? "#";
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
                  href={hasChildren && !firstChildHref.startsWith("http") && firstChildHref !== "#stripe" ? firstChildHref : "#"}
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
                        if (c.href === "#stripe") {
                          return (
                            <button
                              key={c.label}
                              type="button"
                              onClick={handleStripeClick}
                              className="w-full flex items-center gap-2 py-2.5 px-4 text-left text-base text-gray-700 hover:bg-gray-100 first:rounded-t-md last:rounded-b-md"
                            >
                              <IonIcon name={c.icon} size={18} />
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
                              className="w-full flex items-center gap-2 py-2.5 px-4 text-base text-gray-700 hover:bg-gray-100 first:rounded-t-md last:rounded-b-md"
                            >
                              <IonIcon name={c.icon} size={18} />
                              {c.label}
                            </a>
                          );
                        }
                        if (c.href === "/my-community" && c.label === "Create Post") {
                          return (
                            <button
                              key={c.href + c.label}
                              type="button"
                              onClick={openCreatePostModal}
                              className="w-full flex items-center gap-2 py-2.5 px-4 text-left text-base text-gray-700 hover:bg-gray-100 first:rounded-t-md last:rounded-b-md"
                            >
                              <IonIcon name={c.icon} size={18} />
                              {c.label}
                            </button>
                          );
                        }
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
      <SellerHubMobileDrawer
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        onStripeDashboard={() => void handleStripeClick()}
        onCreatePost={openCreatePostFromMenu}
      />
      <CreatePostModal
        open={createPostOpen}
        onClose={() => { setCreatePostOpen(false); setCreatePostBusiness(null); }}
        sharedBusinessId={createPostBusiness?.id}
        sharedBusinessName={createPostBusiness?.name ?? undefined}
        noBusinessMessage={createPostOpen && !createPostBusiness ? "Set up your business in Seller Storefront (Profile menu) to post as your business." : undefined}
      />
    </header>
  );
}
