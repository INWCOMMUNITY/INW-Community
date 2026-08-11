"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useCart } from "@/contexts/CartContext";

function OrderSuccessContent() {
  const searchParams = useSearchParams();
  const { refresh } = useCart();
  const sessionId = searchParams?.get("session_id");
  const orderIdsParam = searchParams?.get("order_ids");
  const orderIds = orderIdsParam ? orderIdsParam.split(",").map((id) => id.trim()).filter(Boolean) : [];
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");

  useEffect(() => {
    let cancelled = false;

    async function finalizeOrder() {
      if (!sessionId && orderIds.length === 0) {
        if (!cancelled) setStatus("error");
        return;
      }

      try {
        const params = new URLSearchParams();
        if (sessionId) params.set("session_id", sessionId);
        if (orderIds.length > 0) params.set("order_ids", orderIds.join(","));
        // Safety net when checkout.session.completed webhook is delayed or missing.
        await fetch(`/api/store-orders/success-summary?${params.toString()}`);
        await fetch("/api/cart", { method: "DELETE" });
        await refresh();
      } catch (err) {
        console.error("[order-success] finalize failed:", err);
      }

      if (!cancelled) setStatus("success");
    }

    void finalizeOrder();
    return () => {
      cancelled = true;
    };
  }, [sessionId, orderIds.join(","), refresh]);

  if (status === "loading") {
    return (
      <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
        <div className="max-w-[var(--max-width)] mx-auto text-center">
          <p className="text-gray-500">Processing your order…</p>
        </div>
      </section>
    );
  }

  if (status === "error") {
    return (
      <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
        <div className="max-w-[var(--max-width)] mx-auto text-center">
          <h1 className="text-2xl font-bold mb-4">Order not found</h1>
          <p className="text-gray-600 mb-6">
            We couldn&apos;t find your order. If you completed payment, you should receive a confirmation email shortly.
          </p>
          <Link href="/storefront" className="btn">Back to storefront</Link>
        </div>
      </section>
    );
  }

  return (
    <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-[var(--max-width)] mx-auto text-center">
        <h1 className="text-3xl font-bold mb-4">Thank you for your order!</h1>
        <p className="text-gray-600 mb-6">
          Your payment was successful. Sellers will ship your order soon.
        </p>
        <div className="flex flex-wrap gap-4 justify-center">
          <Link href="/storefront" className="btn">Continue Shopping</Link>
          <Link href="/my-community/orders" className="btn border border-gray-300 bg-white hover:bg-gray-50">
            View my orders
          </Link>
          <Link href="/my-community" className="btn border border-gray-300 bg-white hover:bg-gray-50">
            Inland Northwest Community
          </Link>
        </div>
      </div>
    </section>
  );
}

export default function OrderSuccessPage() {
  return (
    <Suspense fallback={
      <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
        <div className="max-w-[var(--max-width)] mx-auto text-center">
          <p className="text-gray-500">Loading…</p>
        </div>
      </section>
    }>
      <OrderSuccessContent />
    </Suspense>
  );
}
