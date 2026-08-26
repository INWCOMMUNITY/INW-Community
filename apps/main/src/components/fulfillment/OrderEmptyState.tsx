"use client";

import Link from "next/link";
import { IonIcon } from "@/components/IonIcon";
import type { FulfillmentTabKey } from "@/lib/store-order-fulfillment";

const COPY: Record<
  FulfillmentTabKey,
  { icon: string; title: string; body: string; cta?: { href: string; label: string } }
> = {
  ship: {
    icon: "boat-outline",
    title: "Nothing to Ship",
    body: "Paid orders with ship fulfillment will appear here when they need a label or mark-shipped.",
    cta: { href: "/seller-hub/shipping-setup", label: "Shipping setup" },
  },
  pickups: {
    icon: "hand-left-outline",
    title: "No pickup orders",
    body: "Orders with in-store pickup will show up here when buyers choose pickup at checkout.",
  },
  deliveries: {
    icon: "car-outline",
    title: "No local deliveries",
    body: "Orders with local delivery will appear here when you need to deliver to the buyer.",
  },
  history: {
    icon: "time-outline",
    title: "No history yet",
    body: "Shipped and canceled orders will appear here.",
  },
};

export function OrderEmptyState({ tab }: { tab: FulfillmentTabKey }) {
  const c = COPY[tab];
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-8 text-center">
      <IonIcon name={c.icon} size={36} className="text-[var(--color-primary)] mx-auto mb-3" />
      <p className="font-semibold text-gray-900 mb-1">{c.title}</p>
      <p className="text-sm text-gray-600 max-w-md mx-auto">{c.body}</p>
      {c.cta ? (
        <Link href={c.cta.href} className="btn inline-block mt-4 text-sm py-2 px-4">
          {c.cta.label}
        </Link>
      ) : null}
    </div>
  );
}
