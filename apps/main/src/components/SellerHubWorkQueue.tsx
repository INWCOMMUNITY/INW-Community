"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { IonIcon } from "@/components/IonIcon";
import { HubExclamationBadge } from "@/components/HubExclamationBadge";

type QueueAction = {
  label: string;
  href: string;
  icon: string;
  description?: string;
  show?: boolean;
  badge?: boolean;
};

function MobileAlertBadge() {
  return (
    <span
      className="absolute top-2 right-2 w-[18px] h-[18px] rounded-full flex items-center justify-center text-[11px] font-bold text-white"
      style={{ backgroundColor: "var(--color-secondary)" }}
    >
      !
    </span>
  );
}

export function SellerHubWorkQueue({
  hasLocalDelivery,
  variant,
}: {
  hasLocalDelivery: boolean;
  variant: "desktop" | "mobile";
}) {
  const [pendingShip, setPendingShip] = useState(0);
  const [pendingDeliveries, setPendingDeliveries] = useState(0);
  const [pendingOffers, setPendingOffers] = useState(0);
  const [sellerSetupComplete, setSellerSetupComplete] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/seller-hub/pending-actions", { credentials: "include" })
      .then((r) => r.json())
      .then(
        (d: {
          pendingShip?: number;
          pendingDeliveries?: number;
          sellerOffersPending?: number;
        }) => {
          setPendingShip(Number(d?.pendingShip) || 0);
          setPendingDeliveries(Number(d?.pendingDeliveries) || 0);
          setPendingOffers(Number(d?.sellerOffersPending) || 0);
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
        setSellerSetupComplete(stripe && shippo && anyPolicy);
      } catch {
        if (!cancelled) setSellerSetupComplete(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const actions: QueueAction[] = useMemo(
    () =>
      [
        {
          label: "List Item",
          href: "/seller-hub/store/new",
          icon: "add-circle",
          description: "Add a product to the NWC Storefront.",
        },
        {
          label: "My Items",
          href: "/seller-hub/store/items",
          icon: "cube",
          description: "View and edit your listings.",
        },
        {
          label: "Fulfillment",
          href: "/seller-hub/orders",
          icon: "receipt",
          description: "Orders to ship and shipping labels.",
          badge: pendingShip > 0,
        },
        {
          label: "Policies",
          href: "/seller-hub/policies",
          icon: "book-outline",
          description: "Set shipping, pickup, delivery, and return terms.",
        },
        {
          label: "Deliveries",
          href: "/seller-hub/orders?tab=deliveries",
          icon: "bicycle",
          description: "Local delivery orders to confirm.",
          show: hasLocalDelivery,
          badge: pendingDeliveries > 0,
        },
        {
          label: "Offers",
          href: "/seller-hub/offers",
          icon: "pricetag",
          description: "Respond to offers on your items.",
          badge: pendingOffers > 0,
        },
        {
          label: "Get Paid",
          href: "/seller-hub/store/payouts",
          icon: "wallet",
          description: "View your balance and send funds to your bank.",
        },
        {
          label: "Before You Start",
          href: "/seller-hub/shipping-setup",
          icon: "checkbox",
          description: "Connect payment and shipping so you can list items and get paid.",
          show: sellerSetupComplete === false,
        },
      ].filter((a) => a.show !== false),
    [
      hasLocalDelivery,
      pendingDeliveries,
      pendingOffers,
      pendingShip,
      sellerSetupComplete,
    ]
  );

  if (variant === "mobile") {
    return (
      <div className="grid grid-cols-2 gap-3">
        {actions.map((action) => (
          <Link
            key={action.href + action.label}
            href={action.href}
            prefetch={false}
            className="relative flex flex-col items-center justify-center gap-2 min-h-[100px] p-4 rounded-[10px] border-2 bg-white text-center active:bg-gray-50 transition-colors"
            style={{ borderColor: "var(--color-primary)" }}
          >
            {action.badge ? <MobileAlertBadge /> : null}
            <IonIcon name={action.icon} size={28} className="text-[var(--color-primary)]" />
            <span
              className="text-sm font-semibold text-center leading-tight"
              style={{ color: "var(--color-heading)" }}
            >
              {action.label}
            </span>
          </Link>
        ))}
      </div>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-[1100px] grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 justify-items-center">
      {actions.map((action) => (
        <Link
          key={action.href + action.label}
          href={action.href}
          className="relative hub-card w-full min-w-[240px] max-w-[320px] border-2 border-[var(--color-primary)] rounded-[10px] p-6 transition text-center hover:bg-[var(--color-section-alt)] flex flex-col items-center"
        >
          <HubExclamationBadge show={!!action.badge} />
          <IonIcon name={action.icon} size={28} className="text-[var(--color-primary)] mb-2" />
          <h2 className="text-xl font-bold mb-2">{action.label}</h2>
          {action.description ? <p className="text-sm text-gray-600">{action.description}</p> : null}
        </Link>
      ))}
    </div>
  );
}
