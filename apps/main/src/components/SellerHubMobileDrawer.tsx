"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLockBodyScroll } from "@/lib/scroll-lock";
import { IonIcon } from "@/components/IonIcon";

const SOLD_ITEMS_VIEWED_KEY = "sellerHubSoldItemsViewedAt";
const SHIPPO_URL = "https://apps.goshippo.com/";

type NavItem = {
  href: string;
  label: string;
  icon: string;
  alert?: boolean;
  external?: boolean;
  action?: "stripe" | "create-post" | "offer-reward" | "offer-coupon";
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
  if (item.action === "offer-reward") {
    return (
      <Link href="/business-hub?from=seller-hub&open=reward" className={rowClass} onClick={onNavigate}>
        {inner}
      </Link>
    );
  }
  if (item.action === "offer-coupon") {
    return (
      <Link href="/business-hub?from=seller-hub&open=coupon" className={rowClass} onClick={onNavigate}>
        {inner}
      </Link>
    );
  }
  if (item.external) {
    return (
      <a
        href={item.href}
        target="_blank"
        rel="noopener noreferrer"
        className={rowClass}
        onClick={onNavigate}
      >
        {inner}
      </a>
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
  const [soldCount, setSoldCount] = useState(0);
  const [soldViewedAt, setSoldViewedAt] = useState<string | null>(null);

  useLockBodyScroll(open);

  useEffect(() => {
    if (!open) return;
    try {
      setSoldViewedAt(localStorage.getItem(SOLD_ITEMS_VIEWED_KEY));
    } catch {
      setSoldViewedAt(null);
    }
    fetch("/api/seller-hub/pending-actions", { credentials: "include" })
      .then((r) => r.json())
      .then((d: { pendingShip?: number; soldCount?: number }) => {
        setPendingShip(Number(d?.pendingShip) || 0);
        setSoldCount(Number(d?.soldCount) || 0);
      })
      .catch(() => {});
  }, [open]);

  const soldItemsAlert = soldCount > 0 && !soldViewedAt;

  const sellerHubItems: NavItem[] = [
    { href: "/business-hub?from=seller-hub", label: "Business Hub", icon: "business-outline" },
  ];

  const storefrontItems: NavItem[] = [
    { href: "/seller-hub/store/items", label: "My Items", icon: "cube-outline" },
    { href: "/seller-hub/store/manage", label: "Sold Items", icon: "pricetag-outline", alert: soldItemsAlert },
    { href: "/seller-hub/store/items", label: "Drafts", icon: "document-text-outline" },
    { href: "/seller-hub/offers", label: "Offers", icon: "pricetag-outline" },
    { href: "/seller-hub/store/cancellations", label: "Cancellations", icon: "close-circle-outline" },
    { href: "/seller-hub/policies", label: "Policies", icon: "book-outline" },
  ];

  const actionItems: NavItem[] = [
    { href: "/seller-hub/ship", label: "Ship Item", icon: "boat-outline", alert: pendingShip > 0 },
    { href: "/business-hub?from=seller-hub&open=reward", label: "Offer Reward", icon: "gift-outline", action: "offer-reward" },
    { href: "/business-hub?from=seller-hub&open=coupon", label: "Offer Coupon", icon: "pricetag-outline", action: "offer-coupon" },
    { href: "/seller-hub", label: "Create Post", icon: "megaphone-outline", action: "create-post" },
  ];

  const profileItems: NavItem[] = [
    { href: "/business-hub?from=seller-hub", label: "Local Business", icon: "business-outline" },
    { href: "/seller-hub/time-away", label: "Time Away", icon: "calendar-outline" },
    { href: "#stripe", label: "Stripe", icon: "card-outline", action: "stripe" },
    { href: SHIPPO_URL, label: "Shippo", icon: "boat-outline", external: true },
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
            title="Seller Hub"
            items={sellerHubItems}
            onNavigate={onClose}
            onStripe={onStripeDashboard}
            onCreatePost={onCreatePost}
          />
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
