"use client";

import { adminFetch } from "@/lib/admin-fetch";

import { useState } from "react";
import { useRouter } from "next/navigation";


export function AdminCouponActions({ couponId }: { couponId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    if (!confirm("Delete this coupon?")) return;
    setLoading(true);
    try {
      const res = await adminFetch(
        `${process.env.NEXT_PUBLIC_MAIN_SITE_URL || "http://localhost:3000"}/api/admin/coupons/${couponId}`,
        { method: "DELETE", }
      );
      if (res.ok) router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={loading}
      className="text-red-600 hover:underline text-sm"
    >
      {loading ? "…" : "Delete"}
    </button>
  );
}
