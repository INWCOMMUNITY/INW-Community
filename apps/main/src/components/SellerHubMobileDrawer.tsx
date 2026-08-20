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
  action?: "stripe" | "create-post" | "offer-coupon";
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

function NavRow({
  item,
  onNavigate,
  onStripe,
  onCreatePost,
}: {
  item: NavItem;
  onNavigate: () => void;
  onStripe: () => void;
  onCreatePost: () => void;
}) {
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

  if (item.action === "stripe") {
    return (
      <button type="button" className={rowClass} onClick={() => { onNavigate(); onStripe(); }}>
        {inner}
      </button>
    );
  }
  if (item.action === "create-post") {
    return (
      <button type="button" className={rowClass} onClick={() => { onNavigate(); onCreatePost(); }}>
        {inner}
      </button>
    );
  }
  if (item.action === "offer-coupon") {
    return (
      <Link href="/business-hub?from=seller-hub&open=coupon" className={rowClass} onClick={onNavigate}>
        {inner}
      </Link>
    );
  }
  return (
    <Link href={item.href} prefetch={false} className={rowClass} onClick={onNavigate}>
      {inner}
    </Link>
  );
}

function Section({
  title,
  items,
  onNavigate,
  onStripe,
  onCreatePost,
}: {
  title: string;
  items: NavItem[];
  onNavigate: () => void;
  onStripe: () => void;
  onCreatePost: () => void;
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
          <NavRow
            key={item.href + item.label + (item.action ?? "")}
            item={item}
            onNavigate={onNavigate}
            onStripe={onStripe}
            onCreatePost={onCreatePost}
          />
        ))}
      </div>
    </div>
  );
}

export function SellerHubMobileDrawer({
  open,
  onClose,
  onStripeDashboard,
  onCreatePost,
}: {
  open: boolean;
  onClose: () => void;
  onStripeDashboard: () => void;
  onCreatePost: () => void;
}) {
  const [pendingShip, setPendingShip] = useState(0);

  useLockBodyScroll(open);

  useEffect(() => {
    if (!open) return;
    fetch("/api/seller-hub/pending-actions", { credentials: "include" })
      .then((r) => r.json())
      .then((d: { pendingShip?: number }) => {
        setPendingShip(Number(d?.pendingShip) || 0);
      })
      .catch(() => {});
  }, [open]);

  const storefrontItems: NavItem[] = [
    { href: "/seller-hub/store/items", label: "My Items", icon: "cube-outline" },
    { href: "/seller-hub/orders", label: "Fulfillment", icon: "receipt-outline", alert: pendingShip > 0 },
    { href: "/seller-hub/offers", label: "Offers", icon: "pricetag-outline" },
    { href: "/seller-hub/store/cancellations", label: "Cancellations", icon: "close-circle-outline" },
    { href: "/seller-hub/policies", label: "Policies", icon: "book-outline" },
  ];

  const actionItems: NavItem[] = [
    { href: "/seller-hub/store/new", label: "List Item", icon: "add-circle-outline" },
    { href: "/business-hub?from=seller-hub&open=coupon", label: "Offer Coupon", icon: "pricetag-outline", action: "offer-coupon" },
    { href: "/seller-hub", label: "Create Post", icon: "megaphone-outline", action: "create-post" },
  ];

  const profileItems: NavItem[] = [
    { href: "/seller-hub/store", label: "Seller Storefront", icon: "storefront-outline" },
    { href: "/business-hub?from=seller-hub", label: "Business Hub", icon: "business-outline" },
    { href: "/seller-hub/time-away", label: "Time Away", icon: "calendar-outline" },
    { href: "#stripe", label: "Stripe", icon: "card-outline", action: "stripe" },
    { href: "/seller-hub/shipping-setup", label: "Shipping", icon: "boat-outline" },
    { href: "/seller-hub/channels", label: "Sync Stores", icon: "sync-outline" },
  ];

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] lg:hidden" aria-modal role="dialog" aria-label="Seller Hub menu">
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
            Seller Hub
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
          <Section
            title="Storefront"
            items={storefrontItems}
            onNavigate={onClose}
            onStripe={onStripeDashboard}
            onCreatePost={onCreatePost}
          />
          <Section
            title="Actions"
            items={actionItems}
            onNavigate={onClose}
            onStripe={onStripeDashboard}
            onCreatePost={onCreatePost}
          />
          <Section
            title="Profile"
            items={profileItems}
            onNavigate={onClose}
            onStripe={onStripeDashboard}
            onCreatePost={onCreatePost}
          />
        </div>
      </div>
    </div>
  );
}
