"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { HeartSaveButton } from "@/components/HeartSaveButton";

interface StoreItem {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  photos: string[];
  category: string | null;
  priceCents: number;
  quantity: number;
  business?: { name: string; slug: string };
}

export default function MyWishlistPage() {
  const { data: session, status } = useSession();
  const [items, setItems] = useState<StoreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (status === "unauthenticated") {
      setLoading(false);
      return;
    }
    if (!session?.user) return;

    Promise.all([
      fetch("/api/saved?type=store_item").then((r) => r.json()),
    ]).then(([savedList]) => {
      const ids = (savedList as { referenceId: string }[]).map((i) => i.referenceId);
      setSavedIds(new Set(ids));
      if (ids.length === 0) {
        setItems([]);
        setLoading(false);
        return;
      }
      fetch(`/api/store-items?ids=${ids.join(",")}`)
        .then((r) => r.json())
        .then((data) => {
          setItems(Array.isArray(data) ? data : []);
        })
        .catch(() => setItems([]))
        .finally(() => setLoading(false));
    }).catch(() => setLoading(false));
  }, [session?.user, status]);

  if (status === "loading" || loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-4">My Wishlist</h1>
        <p className="text-gray-500">Loading…</p>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-4">My Wishlist</h1>
        <p className="text-gray-600 mb-4">
          Sign in to save items from the storefront to your wishlist.
        </p>
        <Link href="/login?callbackUrl=/my-community/wantlist" className="btn">
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">My Wishlist</h1>
      {items.length === 0 ? (
        <p className="text-gray-600">
          No items in your wishlist yet. Browse the{" "}
          <Link href="/storefront" className="text-[var(--color-link)] hover:underline">
            storefront
          </Link>{" "}
          and click the heart icon on items you want to save.
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {items.map((item) => (
            <div key={item.id} className="border rounded-lg overflow-hidden hover:shadow-md transition relative">
              <div className="absolute top-2 right-2 z-10">
                <HeartSaveButton
                  type="store_item"
                  referenceId={item.id}
                  initialSaved={savedIds.has(item.id)}
                  className="bg-white/90 rounded-full border-2 border-[var(--color-primary)]"
                />
              </div>
              <Link href={`/storefront/${item.slug}`}>
                {item.photos[0] ? (
                  <img
                    src={item.photos[0]}
                    alt={item.title}
                    className="w-full h-48 object-cover"
                  />
                ) : (
                  <div className="w-full h-48 bg-gray-100 flex items-center justify-center text-gray-400">
                    No image
                  </div>
                )}
              </Link>
              <div className="p-4">
                <h2 className="text-lg font-bold">
                  <Link href={`/storefront/${item.slug}`} className="hover:underline">
                    {item.title}
                  </Link>
                </h2>
                {item.business && (
                  <Link
                    href={`/support-local/${item.business.slug}`}
                    className="text-sm text-primary-600 hover:underline"
                  >
                    {item.business.name}
                  </Link>
                )}
                {item.description && (
                  <p className="text-sm text-gray-600 mt-2 line-clamp-2">{item.description}</p>
                )}
                <p className="text-lg font-bold mt-2">${(item.priceCents / 100).toFixed(2)}</p>
                <Link href={`/storefront/${item.slug}`} className="btn mt-4 inline-block">
                  View details
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
