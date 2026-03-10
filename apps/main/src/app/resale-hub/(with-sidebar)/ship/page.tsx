"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

/**
 * Resale Hub Ship: redirect to Seller Hub Ship so sellers manage shipping labels in one place.
 * (Seller Hub and Resale Hub serve different subscribers; both can use the same Ship page.)
 */
export default function ResaleHubShipPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/seller-hub/ship");
  }, [router]);

  return (
    <div className="w-full max-md:flex max-md:flex-col max-md:items-center">
      <div className="w-full max-w-[var(--max-width)] max-md:mx-auto max-md:flex max-md:flex-col max-md:items-center max-md:text-center">
        <h1 className="text-2xl font-bold mb-4">Ship an Item</h1>
        <p className="text-gray-600 mb-6">
          Redirecting to Seller Hub to manage shipping and purchase labels…
        </p>
        <p className="text-sm text-gray-500 mb-4">
          If you are not redirected,{" "}
          <Link href="/seller-hub/ship" className="text-[var(--color-link)] hover:underline">
            go to Seller Hub → Ship
          </Link>
          .
        </p>
        <Link href="/resale-hub" className="text-[var(--color-link)] hover:underline">
          Back to Resale Hub
        </Link>
      </div>
    </div>
  );
}
