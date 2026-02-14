"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

type NavItem = { href: string; label: string; alert?: boolean };

const SIDEBAR_SCALE = 1.5;
const FONT_SCALE = 0.7;
// Width just a bit wider than longest label (e.g. "My Local Business Page")
const SIDEBAR_WIDTH = 200;

export function SellerSidebar({ mobile }: { mobile?: boolean } = {}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [showDeliveries, setShowDeliveries] = useState(false);
  const [pendingShip, setPendingShip] = useState(0);
  const [pendingReturns, setPendingReturns] = useState(0);
  const [payoutReady, setPayoutReady] = useState(false);

  useEffect(() => {
    fetch("/api/store-items?mine=1")
      .then((r) => r.json())
      .then((data: { localDeliveryAvailable?: boolean }[]) => {
        const items = Array.isArray(data) ? data : [];
        setShowDeliveries(items.some((i) => i.localDeliveryAvailable === true));
      })
      .catch(() => setShowDeliveries(false));
  }, []);

  useEffect(() => {
    fetch("/api/seller-hub/pending-actions")
      .then((r) => r.json())
      .then((data: { pendingShip?: number; pendingReturns?: number; payoutReady?: boolean }) => {
        setPendingShip(Number(data.pendingShip) || 0);
        setPendingReturns(Number(data.pendingReturns) || 0);
        setPayoutReady(Boolean(data.payoutReady));
      })
      .catch(() => {});
  }, []);

  const storefrontItems: NavItem[] = [
    { href: "/seller-hub/store/items", label: "My Items" },
    { href: "/seller-hub/orders", label: "My Orders" },
    ...(showDeliveries ? [{ href: "/seller-hub/deliveries", label: "My Deliveries" }] : []),
    { href: "/seller-hub/store/payouts", label: "My Funds", alert: payoutReady },
  ];

  const actionItems: NavItem[] = [
    { href: "/seller-hub/store/new", label: "List Items", alert: false },
    { href: "/seller-hub/ship", label: "Ship Items", alert: pendingShip > 0 },
    { href: "/seller-hub/offers", label: "New Offers", alert: false },
    { href: "/seller-hub/messages", label: "My Messages", alert: false },
    { href: "/seller-hub/store/returns", label: "Return Requests", alert: pendingReturns > 0 },
    { href: "/seller-hub/store/cancellations", label: "Cancellations", alert: false },
    { href: "/seller-hub/store/actions", label: "Other Actions", alert: false },
  ];

  function AlertIcon() {
    return (
      <span
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold leading-none"
        style={{ backgroundColor: "var(--color-secondary)", color: "white" }}
        title="Action needed"
        aria-label="Action needed"
      >
        !
      </span>
    );
  }

  function NavLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
    const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
    return (
      <Link
        href={item.href}
        onClick={onNavigate}
        className={`flex w-full items-center justify-between gap-2 rounded py-2.5 px-3.5 ${
          isActive ? "bg-gray-200 font-medium" : "hover:bg-gray-100"
        }`}
        style={{ fontSize: `${0.875 * SIDEBAR_SCALE * FONT_SCALE}rem` }}
      >
        <span>{item.label}</span>
        {item.alert ? <AlertIcon /> : null}
      </Link>
    );
  }

  function Section({ title, items, onNavigate }: { title: string; items: NavItem[]; onNavigate?: () => void }) {
    return (
      <div
        className="mb-5 rounded-lg border border-gray-200 bg-white p-3 shadow-sm"
        style={{ borderColor: "var(--color-border, #e5e7eb)" }}
      >
        <p
          className="mb-2 px-2 py-1 font-semibold uppercase tracking-wider opacity-80"
          style={{ color: "var(--color-heading)", fontSize: "0.7rem" }}
        >
          {title}
        </p>
        <div className="flex flex-col gap-0.5">
          {items.map((item) => (
            <NavLink key={item.href + item.label} item={item} onNavigate={onNavigate} />
          ))}
        </div>
      </div>
    );
  }

  const sellerProfileItems: NavItem[] = [
    { href: "/seller-hub/store", label: "Storefront Info" },
    { href: "/seller-hub/shipping-setup", label: "Set Up Easy Post" },
    { href: "/seller-hub/sponsor-hub", label: "Sponsor Hub" },
    { href: "/sponsor-hub/business", label: "My Local Business Page" },
    { href: "/seller-hub/time-away", label: "Time Away" },
  ];

  if (mobile) {
    return (
      <>
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full flex items-center justify-center shadow-lg border-2 border-white"
          style={{ backgroundColor: "var(--color-primary)" }}
          aria-label="Open Seller Hub menu"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7">
            <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
            <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
          </svg>
        </button>
        {menuOpen && (
          <div
            className="fixed inset-0 z-[100] flex flex-col justify-end"
            aria-modal="true"
            role="dialog"
            aria-label="Seller Hub menu"
          >
            <button type="button" onClick={() => setMenuOpen(false)} className="absolute inset-0 bg-black/40" aria-label="Close" />
            <div
              className="relative bg-white rounded-t-xl shadow-2xl max-h-[80vh] overflow-y-auto border-t-2 p-6"
              style={{ borderColor: "var(--color-primary)" }}
            >
              <div className="flex justify-center pb-3 border-b border-gray-200 mb-4">
                <button
                  type="button"
                  onClick={() => setMenuOpen(false)}
                  className="p-2 rounded-full hover:bg-gray-100 text-gray-600"
                  aria-label="Collapse menu"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6">
                    <path d="M18 15l-6-6-6 6" />
                  </svg>
                </button>
              </div>
              <Section title="Seller Profile" items={sellerProfileItems} onNavigate={() => setMenuOpen(false)} />
              <Section title="Storefront" items={storefrontItems} onNavigate={() => setMenuOpen(false)} />
              <Section title="Actions" items={actionItems} onNavigate={() => setMenuOpen(false)} />
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <nav
      className="relative flex flex-col pt-44"
      style={{ minWidth: SIDEBAR_WIDTH }}
    >
      <div className="absolute left-0 flex justify-center pt-2" style={{ width: `${SIDEBAR_WIDTH}px`, top: 0 }}>
        <div className="relative h-32 w-32 shrink-0 overflow-hidden rounded-full border-2 border-gray-200 ring-2 ring-white shadow-md" style={{ borderColor: "var(--color-border, #e5e7eb)" }}>
          <Image
            src="/nwc-logo-circle.png"
            alt="Northwest Community"
            fill
            className="object-cover"
            sizes="128px"
            priority
          />
        </div>
      </div>
      <div className="flex flex-col">
        <Section title="Seller Profile" items={sellerProfileItems} />
        <Section title="Storefront" items={storefrontItems} />
        <Section title="Actions" items={actionItems} />
      </div>
    </nav>
  );
}
