"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { IonIcon } from "@/components/IonIcon";

type GridAction = {
  label: string;
  href: string;
  icon: string;
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

/** Matches `ResaleHubContent` in the mobile app (My Community → Resale Hub). */
export function ResaleHubMobileHome() {
  const [pendingShip, setPendingShip] = useState(0);
  const [pendingDeliveries, setPendingDeliveries] = useState(0);
  const [pendingPickups, setPendingPickups] = useState(0);
  const [sellerOffersPending, setSellerOffersPending] = useState(0);
  const [resaleSetupComplete, setResaleSetupComplete] = useState(false);

  useEffect(() => {
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
        setResaleSetupComplete(stripe && shippo && anyPolicy);
      } catch {
        if (!cancelled) setResaleSetupComplete(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const gridActions: GridAction[] = useMemo(() => {
    const beforeLabel = resaleSetupComplete ? "Store Variables" : "Before You Start";
    return [
      { label: "List Item", href: "/resale-hub/list", icon: "add-circle" },
      { label: "My Listings", href: "/resale-hub/listings", icon: "list-outline" },
      { label: "Orders / To Ship", href: "/resale-hub/orders", icon: "receipt" },
      { label: "Offers", href: "/resale-hub/offers", icon: "pricetag-outline" },
      { label: "Deliveries", href: "/resale-hub/deliveries", icon: "car-outline" },
      { label: "Pick Ups", href: "/resale-hub/pickups", icon: "hand-left-outline" },
      { label: "Payouts", href: "/resale-hub/payouts", icon: "wallet" },
      { label: beforeLabel, href: "/resale-hub/before-you-start", icon: "checkbox-outline" },
    ];
  }, [resaleSetupComplete]);

  const badgeFor = (label: string) => {
    if (label === "Orders / To Ship") return pendingShip > 0;
    if (label === "Offers") return sellerOffersPending > 0;
    if (label === "Deliveries") return pendingDeliveries > 0;
    if (label === "Pick Ups") return pendingPickups > 0;
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
            Resale Hub
          </h1>
          <p className="text-sm leading-5" style={{ color: "var(--color-text)" }}>
            List and Ship pre-loved items in our community, in NWCs Resale Storefront.
          </p>
        </div>
        <div
          className="w-[72px] h-[72px] rounded-full shrink-0 flex items-center justify-center bg-white border-2"
          style={{ borderColor: "var(--color-primary)" }}
        >
          <IonIcon name="cash-outline" size={40} className="text-[var(--color-primary)]" />
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

      <div className="mt-6 flex flex-col items-center gap-3">
        <Link
          href="/resale"
          prefetch={false}
          className="text-sm font-semibold"
          style={{ color: "var(--color-primary)" }}
        >
          Browse NWC Resale store
        </Link>
        <Link
          href="/my-community"
          prefetch={false}
          className="py-2 px-4 text-sm font-semibold"
          style={{ color: "var(--color-primary)" }}
        >
          Go to Profile →
        </Link>
      </div>
    </div>
  );
}
