"use client";

import Link from "next/link";
import { IonIcon } from "@/components/IonIcon";

type ShippoConnectionBannerProps = {
  connected: boolean | null;
  shippingSetupHref: string;
  orderCount?: number;
};

export function ShippoConnectionBanner({
  connected,
  shippingSetupHref,
  orderCount = 0,
}: ShippoConnectionBannerProps) {
  if (connected === true) return null;

  return (
    <div className="rounded-xl border-2 border-amber-200 bg-amber-50 p-5 mb-6">
      <div className="flex items-start gap-3">
        <IonIcon name="boat-outline" size={24} className="text-amber-800 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-amber-900 mb-1">
            {connected === false
              ? "Connect Shippo to purchase and print labels"
              : "Checking shipping connection…"}
          </p>
          <p className="text-sm text-amber-800/90 mb-3">
            {orderCount > 0
              ? `You have ${orderCount} order${orderCount !== 1 ? "s" : ""} to ship. You can still mark orders shipped without a label, or connect Shippo to buy postage here.`
              : "Connect Shippo when you are ready to buy labels in the browser."}
          </p>
          {connected === false ? (
            <Link href={shippingSetupHref} className="btn text-sm py-2 px-4 inline-block">
              Connect shipping
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
