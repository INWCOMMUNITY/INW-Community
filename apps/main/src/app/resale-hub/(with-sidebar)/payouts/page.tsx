"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Redirect to Seller Hub Payouts so Resale Hub "My Payouts" shows the same
 * full funds UI (Available for payout, Pending, Send to bank, Manage payment account).
 */
export default function ResaleHubPayoutsPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/seller-hub/store/payouts");
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-[200px]">
      <p className="text-gray-500">Redirecting to payouts…</p>
    </div>
  );
}
