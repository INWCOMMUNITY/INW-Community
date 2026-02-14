"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface StoreItem {
  id: string;
  title: string;
  slug: string;
  priceCents: number;
  quantity: number;
  status: string;
  photos: string[];
}

export default function MyItemsPage() {
  const [items, setItems] = useState<StoreItem[]>([]);
  const [connectStatus, setConnectStatus] = useState<{
    onboarded: boolean;
    chargesEnabled: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    setFetchError(null);
    async function load() {
      try {
        const [itemsRes, statusRes] = await Promise.all([
          fetch("/api/store-items?mine=1"),
          fetch("/api/stripe/connect/status"),
        ]);
        const itemsData = await itemsRes.json().catch(() => ({}));
        const statusData = await statusRes.json().catch(() => ({}));

        if (!itemsRes.ok) {
          const msg =
            itemsRes.status === 401
              ? "Please sign in to view your items."
              : itemsRes.status === 403
              ? (itemsData as { error?: string }).error ?? "Seller plan required."
              : (itemsData as { error?: string }).error ?? "Failed to load items.";
          setFetchError(msg);
          setItems([]);
        } else {
          setItems(Array.isArray(itemsData) ? itemsData : []);
        }

        if (!statusRes.ok) {
          if (!itemsRes.ok) {
            setConnectStatus(null);
          } else {
            const msg =
              statusRes.status === 401
                ? "Please sign in to check payment setup."
                : (statusData as { error?: string }).error ?? "Failed to load payment status.";
            setFetchError(msg);
            setConnectStatus(null);
          }
        } else {
          setConnectStatus(statusData);
        }
      } catch {
        setItems([]);
        setConnectStatus(null);
        setFetchError(
          "Connection failed. Make sure the server is running and PostgreSQL is started."
        );
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleOnboard() {
    const res = await fetch("/api/stripe/connect/onboard", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (data.url) {
      window.location.href = data.url;
    } else {
      setFetchError(data.error ?? "Payment setup failed. Check Stripe configuration in .env");
    }
  }

  if (loading) {
    return (
      <div className="py-8">
        <p className="text-gray-500">Loading…</p>
      </div>
    );
  }

  return (
    <div className="w-full max-md:mx-auto max-md:max-w-[var(--max-width)]">
      <h2 className="text-xl font-bold mb-4 max-md:text-center">My Items</h2>
      {fetchError && (
        <div className="border rounded-lg p-4 bg-red-50 mb-6 max-md:text-center">
          <p className="text-red-700 text-sm">{fetchError}</p>
          {fetchError.includes("sign in") && (
            <Link href="/login?callbackUrl=/seller-hub/store/items" className="btn mt-3 text-sm">
              Sign in
            </Link>
          )}
        </div>
      )}
      {connectStatus && !connectStatus.chargesEnabled && (
        <div className="border rounded-lg p-4 bg-amber-50 mb-6 max-md:text-center">
          <h3 className="font-semibold mb-2">Complete payment setup</h3>
          <p className="text-sm text-gray-600 mb-3">
            To list items and receive payments, you need to complete Stripe Connect onboarding.
          </p>
          <button type="button" onClick={handleOnboard} className="btn text-sm">
            Complete payment setup
          </button>
        </div>
      )}
      <div className="flex justify-between items-center mb-4 max-md:flex-col max-md:items-center max-md:gap-3 max-md:text-center">
        <p className="text-gray-600 text-sm">Manage your storefront listings.</p>
        <Link href="/seller-hub/store/new" className="btn text-sm">
          List An Item
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="text-gray-500 text-sm max-md:text-center">No items yet. Add your first item to start selling.</p>
      ) : (
        <div className="grid gap-3 w-full">
          {items.map((item) => (
            <div
              key={item.id}
              className="border rounded-lg p-3 flex items-center gap-3 hover:bg-gray-50 w-full min-w-0"
            >
              {item.photos[0] ? (
                <img src={item.photos[0]} alt="" className="w-12 h-12 object-cover rounded shrink-0" />
              ) : (
                <div className="w-12 h-12 bg-gray-200 rounded flex items-center justify-center text-gray-400 text-xs shrink-0">
                  No photo
                </div>
              )}
              <div className="flex-1 min-w-0 overflow-hidden">
                <h3 className="font-medium truncate">{item.title}</h3>
                <p className="text-xs text-gray-600">
                  ${(item.priceCents / 100).toFixed(2)} · {item.quantity} in stock · {item.status}
                </p>
              </div>
              <Link href={`/seller-hub/store/${item.id}`} className="btn text-sm">
                Edit
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
