"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BackToProfileLink } from "@/components/BackToProfileLink";
import { IonIcon } from "@/components/IonIcon";
import { BuyerOrderCard } from "@/components/orders/BuyerOrderCard";
import { BuyerOrderModals, type BuyerOrderModal } from "@/components/orders/BuyerOrderModals";
import {
  BUYER_ORDER_TABS,
  emptyBuyerTabCopy,
  partitionBuyerOrders,
  type BuyerOrderTab,
  type BuyerStoreOrder,
} from "@/lib/buyer-orders";

export function BuyerOrdersContent() {
  const [tab, setTab] = useState<BuyerOrderTab>("to_receive");
  const [orders, setOrders] = useState<BuyerStoreOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [modal, setModal] = useState<BuyerOrderModal | null>(null);

  const load = useCallback(() => {
    setFetchError(null);
    setLoading(true);
    fetch("/api/store-orders?buyer=1")
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          setFetchError((data as { error?: string }).error ?? "Failed to load orders.");
          return [];
        }
        return Array.isArray(data) ? data : [];
      })
      .then(setOrders)
      .catch(() => {
        setFetchError("Connection failed. Make sure the server is running.");
        setOrders([]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const partitioned = useMemo(() => partitionBuyerOrders(orders), [orders]);
  const visible = partitioned[tab];
  const empty = emptyBuyerTabCopy(tab);

  function patchOrder(orderId: string, patch: Partial<BuyerStoreOrder>) {
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, ...patch } : o)));
  }

  return (
    <div>
      <BackToProfileLink />
      <h1 className="text-2xl font-bold mb-1" style={{ color: "var(--color-heading)" }}>
        My Orders
      </h1>
      <p className="mb-4 opacity-80">
        Track shipments, confirm pickup or delivery, and request refunds.
      </p>

      <div className="flex gap-1 sm:gap-2 mb-6 border-b overflow-x-auto" style={{ borderColor: "var(--color-earth)" }}>
        {BUYER_ORDER_TABS.map((t) => {
          const count = partitioned[t.key].length;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`px-3 sm:px-4 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${
                active ? "text-[var(--color-primary)]" : "border-transparent text-gray-600 hover:text-gray-900"
              }`}
              style={active ? { borderColor: "var(--color-primary)" } : undefined}
            >
              {t.label}
              {loading ? "" : ` (${count})`}
            </button>
          );
        })}
      </div>

      {fetchError ? (
        <div className="border rounded-lg p-6 bg-red-50 mb-8">
          <p className="text-red-700">{fetchError}</p>
          {fetchError.toLowerCase().includes("sign in") || fetchError.toLowerCase().includes("unauthorized") ? (
            <Link href="/login?callbackUrl=/my-community/orders" className="btn mt-4 inline-block">
              Sign in
            </Link>
          ) : (
            <button type="button" className="btn mt-4" onClick={load}>
              Try again
            </button>
          )}
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-36 rounded-xl border-2 animate-pulse"
              style={{ borderColor: "var(--color-earth)", backgroundColor: "var(--color-section-alt)" }}
            />
          ))}
        </div>
      ) : visible.length === 0 && !fetchError ? (
        <div className="rounded-xl border-2 p-8 text-center" style={{ borderColor: "var(--color-primary)" }}>
          <IonIcon name="receipt-outline" size={36} className="mx-auto mb-3 text-[var(--color-primary)]" />
          <p className="font-semibold mb-1" style={{ color: "var(--color-heading)" }}>
            {empty.title}
          </p>
          <p className="text-sm opacity-80 mb-4">{empty.body}</p>
          <Link href="/storefront" className="btn inline-block">
            Keep shopping
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {visible.map((order) => (
            <BuyerOrderCard key={order.id} order={order} onAction={setModal} />
          ))}
        </div>
      )}

      <BuyerOrderModals modal={modal} onClose={() => setModal(null)} onOrderPatched={patchOrder} />
    </div>
  );
}
