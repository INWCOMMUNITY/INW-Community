"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSession } from "next-auth/react";

interface SellerBusiness {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  coverPhotoUrl?: string | null;
  shortDescription: string | null;
  city: string | null;
  itemCount: number;
}

export default function MySellersPage() {
  const { data: session, status } = useSession();
  const [sellers, setSellers] = useState<SellerBusiness[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status !== "authenticated") {
      setLoading(false);
      return;
    }
    fetch("/api/follow-business?mine=1")
      .then((r) => r.json())
      .then((d) => setSellers(Array.isArray(d) ? d : []))
      .catch(() => setSellers([]))
      .finally(() => setLoading(false));
  }, [status]);

  if (status === "unauthenticated") {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-4">My Sellers</h1>
        <p className="text-gray-600 mb-4">Sign in to see the sellers you follow.</p>
        <Link href={`/login?callbackUrl=${encodeURIComponent("/my-community/sellers")}`} className="btn">
          Sign In
        </Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <p className="text-gray-600">Loading...</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">My Sellers</h1>
      {sellers.length === 0 ? (
        <div className="border-2 rounded-lg p-8 text-center" style={{ borderColor: "var(--color-primary)" }}>
          <p className="text-gray-600 mb-4">
            You haven&apos;t followed any sellers yet. Browse Local Sellers in Support Local to find stores to follow.
          </p>
          <Link
            href="/support-local/sellers"
            className="btn inline-block"
          >
            Browse Sellers
          </Link>
        </div>
      ) : (
        <div className="grid gap-4">
          {sellers.map((s) => (
            <Link
              key={s.id}
              href={`/support-local/sellers/${s.slug}`}
              className="flex items-center gap-4 p-4 border-2 rounded-lg hover:bg-gray-50 transition"
              style={{ borderColor: "var(--color-primary)" }}
            >
              <div className="w-16 h-16 rounded-lg overflow-hidden bg-gray-100 shrink-0">
                {s.logoUrl ? (
                  <Image
                    src={s.logoUrl}
                    alt={s.name}
                    width={64}
                    height={64}
                    className="w-full h-full object-cover"
                    quality={95}
                    unoptimized={s.logoUrl.startsWith("blob:")}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">
                    Store
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="font-semibold text-lg">{s.name}</h2>
                {s.city && <p className="text-gray-600 text-sm">{s.city}</p>}
                {s.itemCount > 0 && <p className="text-gray-500 text-sm">{s.itemCount} items</p>}
              </div>
              <span className="text-gray-400">→</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
