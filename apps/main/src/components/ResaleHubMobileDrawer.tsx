"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLockBodyScroll } from "@/lib/scroll-lock";
import { IonIcon } from "@/components/IonIcon";

type NavItem = {
  href: string;
  label: string;
  icon: string;
  alert?: boolean;
  external?: boolean;
};

function AlertBadge() {
  return (
    <span
      className="inline-flex w-5 h-5 rounded-full items-center justify-center text-[11px] font-bold text-white shrink-0"
      style={{ backgroundColor: "var(--color-secondary)" }}
    >
      !
    </span>
  );
}

function NavRow({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  const inner = (
    <>
      <span className="flex items-center gap-3 min-w-0 flex-1">
        <span className="w-[22px] shrink-0 flex justify-center">
          <IonIcon name={item.icon} size={22} className="text-[var(--color-primary)]" />
        </span>
        <span className="text-[15px] text-[#444] truncate">{item.label}</span>
      </span>
      <span className="flex items-center gap-1.5 shrink-0">
        {item.alert ? <AlertBadge /> : null}
        <IonIcon name="chevron-forward" size={18} className="text-gray-400" />
      </span>
    </>
  );

  const rowClass =
    "flex items-center justify-between py-2.5 px-3 rounded-md hover:bg-gray-100 active:bg-gray-100 transition-colors w-full text-left";

  const handleClick = () => {
    onNavigate();
  };

  if (item.external) {
    return (
      <a
        href={item.href}
        target="_blank"
        rel="noopener noreferrer"
        className={rowClass}
        onClick={handleClick}
      >
        {inner}
      </a>
    );
  }

  return (
    <Link href={item.href} prefetch={false} className={rowClass} onClick={handleClick}>
      {inner}
    </Link>
  );
}

function Section({
  title,
  items,
  onNavigate,
}: {
  title: string;
  items: NavItem[];
  onNavigate: () => void;
}) {
  return (
    <div className="mb-6">
      <p
        className="text-xs font-semibold tracking-wide mb-2"
        style={{ color: "var(--color-heading)" }}
      >
        {title}
      </p>
      <div className="h-px bg-gray-200 mb-3" />
      <div className="flex flex-col">
        {items.map((item) => (
          <NavRow key={item.href + item.label} item={item} onNavigate={onNavigate} />
        ))}
      </div>
    </div>
  );
}

export function ResaleHubMobileDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [pendingShip, setPendingShip] = useState(0);
  const [pendingDeliveries, setPendingDeliveries] = useState(0);
  const [pendingPickups, setPendingPickups] = useState(0);
  const [sellerOffersPending, setSellerOffersPending] = useState(0);

  useLockBodyScroll(open);

  useEffect(() => {
    if (!open) return;
    fetch("/api/seller-hub/pending-actions", { credentials: "include" })
      .then((r) => r.json())
      .then(
        (d: {
          pendingShip?: number;
          pendingDeliveries?: number;
          pendingPickups?: number;
          sellerOffersPending?: number;
        }) => {
          setPendingShip(Number(d?.pendingShip) || 0);
          setPendingDeliveries(Number(d?.pendingDeliveries) || 0);
          setPendingPickups(Number(d?.pendingPickups) || 0);
          setSellerOffersPending(Number(d?.sellerOffersPending) || 0);
        }
      )
      .catch(() => {});
  }, [open]);

  const resaleHubItems: NavItem[] = [
    { href: "/resale-hub", label: "Resale Hub", icon: "home-outline" },
    { href: "/resale", label: "Browse NWC Resale", icon: "bag-outline" },
    { href: "/my-community", label: "My Community", icon: "people-outline" },
  ];

  const storefrontItems: NavItem[] = [
    { href: "/resale-hub/list", label: "List Item", icon: "add-circle-outline" },
    { href: "/resale-hub/listings", label: "My Listings", icon: "list-outline" },
    {
      href: "/resale-hub/orders",
      label: "Orders / To Ship",
      icon: "receipt-outline",
      alert: pendingShip > 0,
    },
    {
      href: "/resale-hub/deliveries",
      label: "Deliveries",
      icon: "car-outline",
      alert: pendingDeliveries > 0,
    },
    {
      href: "/resale-hub/pickups",
      label: "Pickups",
      icon: "hand-left-outline",
      alert: pendingPickups > 0,
    },
    {
      href: "/resale-hub/offers",
      label: "Offers",
      icon: "pricetag-outline",
      alert: sellerOffersPending > 0,
    },
    { href: "/my-community/messages?tab=resale", label: "Messages", icon: "chatbubbles-outline" },
    { href: "/resale-hub/cancellations", label: "Cancellations", icon: "close-circle-outline" },
    { href: "/seller-hub/time-away", label: "Time Away", icon: "calendar-outline" },
    { href: "/resale-hub/before-you-start", label: "Before You Start", icon: "checkbox-outline" },
  ];

  const getPaidItems: NavItem[] = [{ href: "/resale-hub/payouts", label: "Get Paid", icon: "wallet-outline" }];

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] lg:hidden" aria-modal role="dialog" aria-label="Resale Hub menu">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="Close menu"
        onClick={onClose}
      />
      <div
        className="absolute top-0 right-0 bottom-0 flex flex-col bg-white border-l-2 shadow-xl w-[min(85vw,20rem)]"
        style={{ borderColor: "var(--color-primary)" }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 shrink-0">
          <span
            className="text-lg font-bold"
            style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
          >
            Resale Hub
          </span>
          <button
            type="button"
            className="p-1 rounded-md hover:bg-gray-100"
            aria-label="Close"
            onClick={onClose}
          >
            <IonIcon name="close-outline" size={28} className="text-[var(--color-heading)]" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 pb-8">
          <Section title="Resale Hub" items={resaleHubItems} onNavigate={onClose} />
          <Section title="Storefront" items={storefrontItems} onNavigate={onClose} />
          <Section title="Get Paid" items={getPaidItems} onNavigate={onClose} />
        </div>
      </div>
    </div>
  );
}
