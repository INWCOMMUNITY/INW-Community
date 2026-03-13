"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";

function ShippoOAuthRedirectContent() {
  const searchParams = useSearchParams();
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");

  if (error) {
    return (
      <section className="py-12 px-4 max-w-lg mx-auto">
        <h1 className="text-xl font-semibold mb-2">Shippo connection cancelled</h1>
        <p className="text-gray-600 mb-4">
          {errorDescription
            ? decodeURIComponent(errorDescription.replace(/\+/g, " "))
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
        <h1 className="text-xl font-semibold mb-2">Shippo redirect received</h1>
        <p className="text-gray-600 mb-4">
          The connection flow is being set up. Once Shippo OAuth is fully enabled, you will be able to connect with one click. For now, you can still connect by pasting your API key on the shipping setup page.
        </p>
        <Link href="/seller-hub/shipping-setup" className="text-[var(--color-link)] hover:underline">
          Go to shipping setup
        </Link>
      </section>
    );
  }

  return (
    <section className="py-12 px-4 max-w-lg mx-auto">
      <h1 className="text-xl font-semibold mb-2">Invalid response from Shippo</h1>
      <p className="text-gray-600 mb-4">
        This page is used when Shippo sends you back after connecting your account. No valid code or error was received. You can try again from shipping setup.
      </p>
      <Link href="/seller-hub/shipping-setup" className="text-[var(--color-link)] hover:underline">
        Back to shipping setup
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
