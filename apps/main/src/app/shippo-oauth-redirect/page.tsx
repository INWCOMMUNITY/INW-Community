"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Legacy page if an old Shippo callback pointed here.
 * OAuth must complete at /api/shipping/oauth-callback — a browser page cannot exchange the code.
 */
function ShippoOAuthRedirectContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  const code = searchParams.get("code");

  if (error) {
    return (
      <section className="py-12 px-4 max-w-lg mx-auto">
        <h1 className="text-xl font-semibold mb-2">Shippo connection cancelled</h1>
        <p className="text-gray-600 mb-4">
          {searchParams.get("error_description")
            ? decodeURIComponent(
                String(searchParams.get("error_description")).replace(/\+/g, " ")
              )
            : "You did not complete the connection, or an error occurred."}
        </p>
        <Link href="/seller-hub/shipping-setup" className="text-[var(--color-link)] hover:underline">
          Back to shipping setup
        </Link>
      </section>
    );
  }

  if (code) {
    return (
      <section className="py-12 px-4 max-w-lg mx-auto">
        <h1 className="text-xl font-semibold mb-2">Update Shippo callback URL</h1>
        <p className="text-gray-600 mb-4">
          Shippo returned an authorization code to this page, but the app completes connection only at{" "}
          <code className="text-sm">/api/shipping/oauth-callback</code>. Ask Shippo support to set your callback to
          that URL, then try <strong>Connect with Shippo</strong> again from Seller Hub → Shipping.
        </p>
        <Link href="/seller-hub/shipping-setup" className="text-[var(--color-link)] hover:underline">
          Back to shipping setup
        </Link>
      </section>
    );
  }

  return (
    <section className="py-12 px-4 max-w-lg mx-auto">
      <h1 className="text-xl font-semibold mb-2">Shippo redirect</h1>
      <p className="text-gray-600 mb-4">
        Use <strong>Seller Hub → Shipping → Connect with Shippo</strong>. The callback URL registered with Shippo
        should be <code className="text-sm">…/api/shipping/oauth-callback</code> on your site.
      </p>
      <Link href="/seller-hub/shipping-setup" className="text-[var(--color-link)] hover:underline">
        Go to shipping setup
      </Link>
    </section>
  );
}

export default function ShippoOAuthRedirectPage() {
  return (
    <Suspense fallback={<section className="py-12 px-4"><p className="text-gray-500">Loading…</p></section>}>
      <ShippoOAuthRedirectContent />
    </Suspense>
  );
}
