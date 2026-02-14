"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getErrorMessage } from "@/lib/api-error";
import Link from "next/link";

interface BusinessOption {
  id: string;
  name: string;
}

interface CouponFormProps {
  businesses: BusinessOption[];
  /** When provided, called after successful submit instead of redirecting (e.g. close modal). */
  onSuccess?: () => void;
}

export function CouponForm({ businesses, onSuccess }: CouponFormProps) {
  const router = useRouter();
  const [businessId, setBusinessId] = useState(businesses[0]?.id ?? "");
  const [name, setName] = useState("");
  const [discount, setDiscount] = useState("");
  const [code, setCode] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!businessId) {
      setError("Select a business first. Add a business from Sponsor Hub if needed.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/coupons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, name, discount, code, imageUrl: imageUrl || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(getErrorMessage(data.error, "Failed to add coupon."));
        return;
      }
      if (onSuccess) {
        onSuccess();
      } else {
        router.push("/sponsor-hub");
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (businesses.length === 0) {
    return (
      <div className="max-w-xl border rounded-lg p-6 bg-gray-50">
        <h3 className="font-semibold mb-2">Add a business first</h3>
        <p className="text-gray-600 text-sm mb-4">
          You need at least one business to add a coupon. Set up your business from Sponsor Hub.
        </p>
        <Link href="/sponsor-hub/business" className="btn inline-block">
          Add business
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-xl">
      <div>
        <label className="block text-sm font-medium mb-1">Business *</label>
        <select
          value={businessId}
          onChange={(e) => setBusinessId(e.target.value)}
          required
          className="w-full border rounded px-3 py-2"
        >
          <option value="">Select business</option>
          {businesses.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Coupon name *</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="w-full border rounded px-3 py-2"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Discount *</label>
        <input
          type="text"
          value={discount}
          onChange={(e) => setDiscount(e.target.value)}
          placeholder="e.g. 25% off first month"
          required
          className="w-full border rounded px-3 py-2"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Coupon code *</label>
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
          className="w-full border rounded px-3 py-2"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Logo / QR / Barcode image URL</label>
        <input
          type="url"
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          className="w-full border rounded px-3 py-2"
        />
      </div>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <button type="submit" className="btn" disabled={submitting}>
        {submitting ? "Submitting…" : "Add coupon"}
      </button>
    </form>
  );
}
