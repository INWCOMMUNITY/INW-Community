"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

/**
 * Resale order detail: redirect to seller-hub order detail so the same page is used.
 * (Order data and layout are shared; back link there goes to Seller Hub.)
 */
export default function ResaleHubOrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string | undefined;

  useEffect(() => {
    if (id) router.replace(`/seller-hub/orders/${id}`);
  }, [id, router]);

  return (
    <div className="max-w-[var(--max-width)] mx-auto">
      <p className="text-gray-600 mb-4">Redirecting to order…</p>
      {id ? (
        <Link href={`/seller-hub/orders/${id}`} className="text-[var(--color-link)] hover:underline">
          Open order
        </Link>
      ) : null}
      <div className="mt-4">
        <Link href="/resale-hub/orders" className="text-[var(--color-link)] hover:underline">
          ← Back to Resale Orders
        </Link>
      </div>
    </div>
  );
}
