"use client";

import { Suspense } from "react";
import { ShippingSetupPanel } from "@/components/seller/ShippingSetupPanel";

export default function ShippingPage() {
  return (
    <Suspense fallback={<p className="p-8 text-gray-500 text-center">Loading…</p>}>
      <ShippingSetupPanel />
    </Suspense>
  );
}
