"use client";

import { useState } from "react";
import Link from "next/link";
import { useLockBodyScroll } from "@/lib/scroll-lock";
import Image from "next/image";
import { usePathname } from "next/navigation";

type NavItem = { href: string; label: string };

const SIDEBAR_SCALE = 1.5;
const FONT_SCALE = 0.7;
const SIDEBAR_WIDTH = 200;

const RESALE_HUB_ITEMS: NavItem[] = [
  { href: "/resale-hub/list", label: "List an Item" },
  { href: "/resale-hub/listings", label: "My Listings" },
  { href: "/resale-hub/ship", label: "Ship an Item" },
  { href: "/resale-hub/deliveries", label: "My Deliveries" },
  { href: "/resale-hub/pickups", label: "My Pickups" },
  { href: "/resale-hub/offers", label: "New Offers" },
  { href: "/resale-hub/messages", label: "My Messages" },
  { href: "/resale-hub/cancellations", label: "Cancellations" },
  { href: "/resale-hub/payouts", label: "My Payouts" },
];

function NavLink({ item, onNavigate, mobile }: { item: NavItem; onNavigate?: () => void; mobile?: boolean }) {
  const pathname = usePathname();
  const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
  const fontSize = mobile ? "0.75rem" : `${0.875 * SIDEBAR_SCALE * FONT_SCALE}rem`;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={`flex w-full items-center justify-between gap-2 rounded py-2.5 px-3.5 ${mobile ? "whitespace-nowrap" : ""} ${
        isActive ? "bg-gray-200 font-medium" : "hover:bg-gray-100"
      }`}
      style={{ fontSize }}
    >
      <span>{item.label}</span>
    </Link>
  );
}

function Section({ title, items, onNavigate, mobile }: { title: string; items: NavItem[]; onNavigate?: () => void; mobile?: boolean }) {
  return (
    <div
      className="mb-5 rounded-lg border border-gray-200 bg-white p-3 shadow-sm"
      style={{ borderColor: "var(--color-border, #e5e7eb)" }}
    >
      <p
        className="mb-2 px-2 py-1 font-semibold uppercase tracking-wider opacity-80"
        style={{ color: "var(--color-heading)", fontSize: mobile ? "0.65rem" : "0.7rem" }}
      >
        {title}
      </p>
      <div className="flex flex-col gap-0.5">
        {items.map((item) => (
          <NavLink key={item.href + item.label} item={item} onNavigate={onNavigate} mobile={mobile} />
        ))}
      </div>
    </div>
  );
}

export function ResaleHubSidebar({ mobile }: { mobile?: boolean }) {
  const [open, setOpen] = useState(false);

  useLockBodyScroll(!!(mobile && open));

  if (mobile) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full flex items-center justify-center shadow-lg border-2 border-white"
          style={{ backgroundColor: "var(--color-primary)" }}
          aria-label="Open Resale Hub menu"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7">
            <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
            <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
          </svg>
        </button>
        {open && (
          <div
            className="fixed inset-0 z-[100] flex flex-col justify-end"
            aria-modal="true"
            role="dialog"
            aria-label="Resale Hub menu"
          >
            <button type="button" onClick={() => setOpen(false)} className="absolute inset-0 bg-black/40" aria-label="Close" />
            <div
              className="relative bg-white rounded-t-xl shadow-2xl max-h-[80vh] overflow-y-auto border-t-2 p-6"
              style={{ borderColor: "var(--color-primary)" }}
            >
              <div className="flex justify-center pb-3 border-b border-gray-200 mb-4">
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
              <Section title="Community Resale" items={RESALE_HUB_ITEMS} onNavigate={() => setOpen(false)} mobile />
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
        <Section title="Community Resale" items={RESALE_HUB_ITEMS} />
      </div>
    </nav>
  );
}
