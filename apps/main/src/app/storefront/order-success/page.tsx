"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useCart } from "@/contexts/CartContext";
import { OrderSuccessPanel } from "@/components/store/OrderSuccessPanel";

function OrderSuccessContent() {
  const searchParams = useSearchParams();
  const { refresh } = useCart();
  const sessionId = searchParams?.get("session_id");
  const orderIdsParam = searchParams?.get("order_ids");
  const orderIds = orderIdsParam ? orderIdsParam.split(",").map((id) => id.trim()).filter(Boolean) : [];
  const [status, setStatus] = useState<"loading" | "success" | "sold_while_paying" | "error">("loading");

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
        const res = await fetch(`/api/store-orders/success-summary?${params.toString()}`);
        const data = (await res.json().catch(() => ({}))) as {
          soldWhilePaying?: boolean;
          orders?: Array<{ status?: string; cancelReason?: string | null }>;
        };
        await fetch("/api/cart", { method: "DELETE" });
        await refresh();
        if (!cancelled) {
          setStatus(data.soldWhilePaying ? "sold_while_paying" : "success");
        }
        return;
      } catch (err) {
        console.error("[order-success] finalize failed:", err);
        if (!cancelled) setStatus("success");
      }
    }

    void finalizeOrder();
    return () => {
      cancelled = true;
    };
  }, [sessionId, orderIds.join(","), refresh]);

  if (status === "loading") {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center"
        style={{ backgroundColor: "rgba(0, 0, 0, 0.45)" }}
      >
        <div
          className="bg-white px-8 py-10 text-center w-[88vw] max-w-[420px] min-h-[200px] flex items-center justify-center"
          style={{ border: "4px solid #000" }}
        >
          <p className="text-gray-600 font-medium">Processing your order…</p>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ backgroundColor: "rgba(0, 0, 0, 0.45)" }}
      >
        <div
          className="bg-white px-8 py-10 text-center w-[88vw] max-w-[420px]"
          style={{ border: "4px solid #000" }}
        >
          <h1 className="text-xl font-bold mb-3">Order not found</h1>
          <p className="text-gray-600 mb-6 text-sm">
            We couldn&apos;t find your order. If you completed payment, you should receive a confirmation email shortly.
          </p>
          <a
            href="/storefront"
            className="inline-block py-3 px-8 rounded-full font-bold border-[3px] border-black"
          >
            Keep Shopping
          </a>
        </div>
      </div>
    );
  }

  return <OrderSuccessPanel variant={status === "sold_while_paying" ? "sold_while_paying" : "success"} />;
}

export default function OrderSuccessPage() {
  return (
    <Suspense
      fallback={
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: "rgba(0, 0, 0, 0.45)" }}
        >
          <p className="text-white font-medium">Loading…</p>
        </div>
      }
    >
      <OrderSuccessContent />
    </Suspense>
  );
}
