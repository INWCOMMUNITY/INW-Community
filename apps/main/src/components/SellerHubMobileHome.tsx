"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { IonIcon } from "@/components/IonIcon";

type GridAction = {
  label: string;
  href: string;
  icon: string;
  show?: boolean;
};

function HubAlertBadge() {
  return (
    <span
      className="absolute top-2 right-2 w-[18px] h-[18px] rounded-full flex items-center justify-center text-[11px] font-bold text-white"
      style={{ backgroundColor: "var(--color-secondary)" }}
    >
      !
    </span>
  );
}

export function SellerHubMobileHome({ hasLocalDelivery }: { hasLocalDelivery: boolean }) {
  const [pendingShip, setPendingShip] = useState(0);
  const [pendingDeliveries, setPendingDeliveries] = useState(0);
  const [pendingPickups, setPendingPickups] = useState(0);
  const [sellerSetupComplete, setSellerSetupComplete] = useState(false);

  useEffect(() => {
    fetch("/api/seller-hub/pending-actions", { credentials: "include" })
      .then((r) => r.json())
      .then((d: { pendingShip?: number; pendingDeliveries?: number; pendingPickups?: number }) => {
        setPendingShip(Number(d?.pendingShip) || 0);
        setPendingDeliveries(Number(d?.pendingDeliveries) || 0);
        setPendingPickups(Number(d?.pendingPickups) || 0);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [funds, shipping, me] = await Promise.all([
          fetch("/api/seller-funds", { credentials: "include" }).then((r) => r.json()),
          fetch("/api/shipping/status", { credentials: "include" }).then((r) => r.json()),
          fetch("/api/me", { credentials: "include" }).then((r) => r.json()),
        ]);
        if (cancelled) return;
        const stripe = Boolean((funds as { hasStripeConnect?: boolean }).hasStripeConnect);
        const shippo = Boolean((shipping as { connected?: boolean }).connected);
        const p = me as {
          sellerShippingPolicy?: string | null;
          sellerLocalDeliveryPolicy?: string | null;
          sellerPickupPolicy?: string | null;
          sellerReturnPolicy?: string | null;
        };
        const anyPolicy = [
          p?.sellerShippingPolicy,
          p?.sellerLocalDeliveryPolicy,
          p?.sellerPickupPolicy,
          p?.sellerReturnPolicy,
        ].some((v) => typeof v === "string" && v.trim().length > 0);
        setSellerSetupComplete(stripe && shippo && anyPolicy);
      } catch {
        if (!cancelled) setSellerSetupComplete(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const gridActions: GridAction[] = useMemo(() => {
    const base: GridAction[] = [
      { label: "List Items", href: "/seller-hub/store/new", icon: "add-circle" },
      { label: "Orders / To Ship", href: "/seller-hub/orders", icon: "receipt" },
      { label: "Storefront Info", href: "/seller-hub/store", icon: "storefront" },
      { label: "Manage Store", href: "/seller-hub/store/manage", icon: "list" },
      {
        label: "Deliveries",
        href: "/seller-hub/deliveries",
        icon: "car-outline",
        show: hasLocalDelivery,
      },
      { label: "Pick Up", href: "/seller-hub/pickups", icon: "hand-left-outline" },
      { label: "Payouts", href: "/seller-hub/store/payouts", icon: "wallet" },
      {
        label: sellerSetupComplete ? "Seller Variables" : "Before You Start",
        href: "/seller-hub/shipping-setup",
        icon: "checkbox-outline",
      },
    ];
    return base.filter((a) => a.show !== false);
  }, [hasLocalDelivery, sellerSetupComplete]);

  const badgeFor = (label: string) => {
    if (label === "Orders / To Ship") return pendingShip > 0;
    if (label === "Deliveries") return pendingDeliveries > 0;
    if (label === "Pick Up") return pendingPickups > 0;
    return false;
  };

  return (
    <div className="px-4 pt-4 pb-10" style={{ paddingBottom: "max(2.5rem, env(safe-area-inset-bottom))" }}>
      <div
        className="flex flex-row items-center gap-4 mb-6 py-4 px-4 rounded-xl border-2"
        style={{
          backgroundColor: "var(--color-section-alt)",
          borderColor: "var(--color-primary)",
        }}
      >
        <div className="flex-1 min-w-0">
          <h1
            className="text-xl font-bold mb-1.5"
            style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
          >
            Seller Hub
          </h1>
          <p className="text-sm leading-5" style={{ color: "var(--color-text)" }}>
            Manage your storefront and resale listings, ship orders, get paid.
          </p>
        </div>
        <div
          className="w-[72px] h-[72px] rounded-full shrink-0 flex items-center justify-center bg-white border-2"
          style={{ borderColor: "var(--color-primary)" }}
        >
          <IonIcon name="briefcase" size={40} className="text-[var(--color-primary)]" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {gridActions.map((action) => {
          const needs = badgeFor(action.label);
          return (
            <Link
              key={action.href + action.label}
              href={action.href}
              prefetch={false}
              className="relative flex flex-col items-center justify-center gap-2 min-h-[100px] p-4 rounded-[10px] border-2 bg-white text-center active:bg-gray-50 transition-colors"
              style={{ borderColor: "var(--color-primary)" }}
            >
              {needs ? <HubAlertBadge /> : null}
              <IonIcon name={action.icon} size={28} className="text-[var(--color-primary)]" />
              <span
                className="text-sm font-semibold text-center leading-tight"
                style={{ color: "var(--color-heading)" }}
              >
                {action.label}
              </span>
            </Link>
          );
        })}
      </div>

      <div className="mt-6 flex justify-center">
        <Link
          href="/business-hub?from=seller-hub"
          prefetch={false}
          className="py-2 px-4 text-sm font-semibold"
          style={{ color: "var(--color-primary)" }}
        >
          Go to Business Hub →
        </Link>
      </div>
    </div>
  );
}
