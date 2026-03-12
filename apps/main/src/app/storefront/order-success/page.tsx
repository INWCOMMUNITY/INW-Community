"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useCart } from "@/contexts/CartContext";
import { PointsEarnedModal } from "@/components/PointsEarnedModal";

function OrderSuccessContent() {
  const searchParams = useSearchParams();
  const { refresh } = useCart();
  const sessionId = searchParams?.get("session_id");
  const cash = searchParams?.get("cash") === "1";
  const orderId = searchParams?.get("order_id");
  const orderIdsParam = searchParams?.get("order_ids");
  const cashOrderIdsParam = searchParams?.get("cash_order_ids");
  const orderIds = orderIdsParam ? orderIdsParam.split(",").map((id) => id.trim()).filter(Boolean) : [];
  const cashOrderIds = cashOrderIdsParam ? cashOrderIdsParam.split(",").map((id) => id.trim()).filter(Boolean) : [];
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [pointsModal, setPointsModal] = useState<{
    pointsAwarded: number;
    previousTotal: number;
    newTotal: number;
  } | null>(null);
  const isCashOrder = cash && (orderId || orderIds.length > 0);
  const hadMixedCheckout = cashOrderIds.length > 0;
  const allOrderIds = [...orderIds, ...cashOrderIds];

  useEffect(() => {
    if (isCashOrder) {
      setStatus("success");
      fetch("/api/cart", { method: "DELETE" }).then(() => refresh());
      return;
    }
    if (sessionId || orderIds.length > 0) {
      setStatus("success");
      fetch("/api/cart", { method: "DELETE" }).then(() => refresh());
      return;
    }
    setStatus("error");
  }, [sessionId, isCashOrder, orderIds.length, refresh]);

  useEffect(() => {
    if (status !== "success" || allOrderIds.length === 0) return;
    const orderIdsQuery = allOrderIds.join(",");
    Promise.all([
      fetch(`/api/store-orders/success-summary?order_ids=${encodeURIComponent(orderIdsQuery)}`).then((r) => r.json()),
      fetch("/api/me").then((r) => r.json()),
    ]).then(([summary, me]) => {
      const pointsAwarded = summary?.pointsAwarded ?? 0;
      const newTotal = typeof me?.points === "number" ? me.points : 0;
      if (pointsAwarded > 0 && newTotal >= pointsAwarded) {
        setPointsModal({
          pointsAwarded,
          previousTotal: newTotal - pointsAwarded,
          newTotal,
        });
      }
    }).catch(() => {});
  }, [status, allOrderIds.join(",")]);

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
    <>
      <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
        <div className="max-w-[var(--max-width)] mx-auto text-center">
          <h1 className="text-3xl font-bold mb-4">Thank you for your order!</h1>
          <p className="text-gray-600 mb-6">
            {isCashOrder
              ? orderIds.length > 1
                ? "Your orders are confirmed. Pay in cash when you pick up or receive delivery. Each seller will contact you to arrange details."
                : "Your order is confirmed. Pay in cash when you pick up or receive delivery. The seller will contact you to arrange details."
              : hadMixedCheckout
                ? "Your payment was successful. You were charged only for items paid by card. Pay in cash for the rest when you pick up or receive delivery. Sellers will contact you to arrange details."
                : "Your payment was successful. Community Points have been added to your account. Sellers will ship your order soon."}
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
            <Link href="/storefront" className="btn">Continue Shopping</Link>
            <Link href="/my-community/orders" className="btn border border-gray-300 bg-white hover:bg-gray-50">
              View my orders
            </Link>
            <Link href="/my-community" className="btn border border-gray-300 bg-white hover:bg-gray-50">
              My Community
            </Link>
          </div>
        </div>
      </section>
      {pointsModal && (
        <PointsEarnedModal
          open={true}
          onClose={() => setPointsModal(null)}
          businessName="Your purchase"
          pointsAwarded={pointsModal.pointsAwarded}
          previousTotal={pointsModal.previousTotal}
          newTotal={pointsModal.newTotal}
          message="Thanks for supporting local! Community Points have been added to your account."
          buttonText="Awesome!"
        />
      )}
    </>
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
