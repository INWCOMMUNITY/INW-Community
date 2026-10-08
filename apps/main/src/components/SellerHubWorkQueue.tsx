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
  const [payoutReady, setPayoutReady] = useState(false);
  const [sellerSetupComplete, setSellerSetupComplete] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/seller-hub/pending-actions", { credentials: "include" })
      .then((r) => r.json())
      .then(
        (d: {
          pendingShip?: number;
          pendingDeliveries?: number;
          sellerOffersPending?: number;
          payoutReady?: boolean;
        }) => {
          setPendingShip(Number(d?.pendingShip) || 0);
          setPendingDeliveries(Number(d?.pendingDeliveries) || 0);
          setPendingOffers(Number(d?.sellerOffersPending) || 0);
          setPayoutReady(Boolean(d?.payoutReady));
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
          badge: payoutReady,
        },
        {
          label: "Sync Airport",
          href: "/seller-hub/apps",
          icon: "apps",
          description: "Connect Shopify and Etsy — manage marketplace sync.",
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
          label: "Before You Start",
          href: "/seller-hub/shipping-setup",
          icon: "checkbox",
          description: "Connect payment and shipping so you can list items and get paid.",
          show: sellerSetupComplete === false,
        },
        {
          label: "Policies",
          href: "/seller-hub/policies",
          icon: "book-outline",
          description: "Set shipping, pickup, delivery, and return terms.",
        },
        {
          label: "Storefront Info",
          href: "/seller-hub/store",
          icon: "storefront-outline",
          description: "Edit your storefront profile, bio, and photos.",
        },
      ].filter((a) => a.show !== false),
    [
      hasLocalDelivery,
      pendingDeliveries,
      pendingOffers,
      pendingShip,
      payoutReady,
      sellerSetupComplete,
    ]
  );

  if (variant === "mobile") {
    const lastLabel = actions[actions.length - 1]?.label;
    const lastAlone = actions.length % 2 === 1 && Boolean(lastLabel);

    return (
      <div className="grid grid-cols-2 gap-3">
        {actions.map((action) => {
          const isFeaturedLast = lastAlone && action.label === lastLabel;
          return (
            <Link
              key={action.href + action.label}
              href={action.href}
              prefetch={false}
              className={`relative flex border-2 bg-white text-center transition-colors active:bg-[var(--color-section-alt)] ${
                isFeaturedLast
                  ? "col-span-2 flex-row items-center justify-center gap-3 min-h-[4.25rem] px-4 py-3 rounded-2xl"
                  : "flex-col items-center justify-center gap-2 min-h-[6.75rem] p-4 rounded-2xl"
              }`}
              style={{ borderColor: "var(--color-primary)" }}
            >
              {action.badge ? <MobileAlertBadge /> : null}
              <IonIcon
                name={action.icon}
                size={isFeaturedLast ? 26 : 28}
                className="text-[var(--color-primary)] shrink-0"
              />
              <span
                className={`font-semibold leading-tight ${isFeaturedLast ? "text-[15px]" : "text-sm"}`}
                style={{ color: "var(--color-heading)" }}
              >
                {action.label}
              </span>
            </Link>
          );
        })}
      </div>
    );
  }

  const lastLabel = actions[actions.length - 1]?.label;
  const lastAloneCentered =
    Boolean(lastLabel) && actions.length % 4 === 1;

  return (
    <div className="mx-auto grid w-full max-w-[1400px] grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 justify-items-center">
      {actions.map((action) => {
        const centerLast = lastAloneCentered && action.label === lastLabel;
        return (
          <Link
            key={action.href + action.label}
            href={action.href}
            className={`relative hub-card w-full min-w-0 max-w-[300px] border-2 border-[var(--color-primary)] rounded-[10px] p-5 transition text-center hover:bg-[var(--color-section-alt)] flex flex-col items-center ${
              centerLast ? "lg:col-span-4 lg:justify-self-center" : ""
            }`}
          >
            <HubExclamationBadge show={!!action.badge} />
            <IonIcon name={action.icon} size={28} className="text-[var(--color-primary)] mb-2" />
            <h2 className="text-lg font-bold mb-2">{action.label}</h2>
            {action.description ? <p className="text-sm text-gray-600">{action.description}</p> : null}
          </Link>
        );
      })}
    </div>
  );
}
