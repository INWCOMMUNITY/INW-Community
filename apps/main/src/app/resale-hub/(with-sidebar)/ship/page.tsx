"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

export default function ResaleHubShipPage() {
  const [shippingConnected, setShippingConnected] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/shipping/status")
      .then((r) => r.json())
      .then((d: { connected?: boolean }) => setShippingConnected(d.connected ?? false))
      .catch(() => setShippingConnected(false));
  }, []);

  return (
    <div className="w-full max-md:flex max-md:flex-col max-md:items-center">
      <div className="w-full max-w-[var(--max-width)] max-md:mx-auto max-md:flex max-md:flex-col max-md:items-center">
        <h1 className="text-2xl font-bold mb-4 max-md:text-center">Ship an Item</h1>
        <p className="text-gray-600 mb-6 max-md:text-center">
          Resale orders that need shipping labels will appear here. You pay for
          labels with your connected EasyPost account (your card). Labels are printable from this site.
        </p>

        {shippingConnected === false && (
          <div className="border rounded-lg p-6 mb-8 bg-amber-50 border-amber-200 w-full max-md:flex max-md:flex-col max-md:items-center max-md:text-center">
            <h2 className="font-semibold text-amber-900 mb-2">Set up Easy Post</h2>
            <p className="text-amber-800 mb-4">
              Connect your EasyPost account to pay for labels with your own card when
              you have orders to ship.
            </p>
            <Link href="/seller-hub/shipping-setup" className="btn inline-block">
              Set Up Easy Post
            </Link>
          </div>
        )}

        {shippingConnected === true && (
          <div className="flex flex-wrap items-center gap-3 mb-6 p-3 rounded-lg bg-green-50 border border-green-200 w-full max-md:justify-center max-md:text-center">
            <span className="text-green-800 font-medium">
              Shipping account connected
            </span>
            <Link
              href="/seller-hub/shipping-setup"
              className="text-sm text-green-700 underline hover:no-underline"
            >
              Update API key
            </Link>
          </div>
        )}

        <p className="text-sm text-gray-500 max-md:text-center">
          No orders need shipping right now. When a buyer purchases with shipping,
          you&apos;ll see the order here and can purchase labels the same way as
          in Seller Hub.
        </p>
        <Link
          href="/resale-hub"
          className="text-[var(--color-link)] hover:underline mt-4 inline-block max-md:block max-md:text-center"
        >
          Back to Resale Hub
        </Link>
      </div>
    </div>
  );
}
