"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface Transaction {
  id: string;
  type: string;
  amountCents: number;
  description: string | null;
  createdAt: string;
}

interface FundsData {
  balanceCents: number;
  totalEarnedCents: number;
  totalPaidOutCents: number;
  transactions: Transaction[];
  hasStripeConnect: boolean;
  availableForPayoutCents?: number;
  pendingCents?: number;
  payoutScheduleDescription?: string;
}

export default function MyFundsPage() {
  const [data, setData] = useState<FundsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [payoutLoading, setPayoutLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function fetchFunds() {
    setLoading(true);
    fetch("/api/seller-funds")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch(() => setError("Failed to load"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchFunds();
  }, []);

  async function handleSetup() {
    const res = await fetch("/api/stripe/connect/onboard", { method: "POST" });
    const d = await res.json().catch(() => ({}));
    if (d.url) window.location.href = d.url;
  }

  async function handlePayout() {
    setPayoutLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/seller-funds", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? "Payout failed");
        return;
      }
      fetchFunds();
    } finally {
      setPayoutLoading(false);
    }
  }

  async function handleManageAccount() {
    try {
      const res = await fetch("/api/stripe/connect/express-dashboard");
      const d = await res.json().catch(() => ({}));
      if (d.url) window.open(d.url, "_blank", "noopener,noreferrer");
      else setError(d.error ?? "Could not open payment account");
    } catch {
      setError("Could not open payment account");
    }
  }

  const availableCents =
    data?.availableForPayoutCents !== undefined ? data.availableForPayoutCents : data?.balanceCents ?? 0;

  if (loading) return <p className="text-gray-500">Loading…</p>;

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">My Funds</h2>
      {!data?.hasStripeConnect ? (
        <div className="border rounded-lg p-4 bg-amber-50">
          <p className="mb-3">Complete Stripe Connect setup to receive payouts from sales.</p>
          <button type="button" onClick={handleSetup} className="btn">
            Complete payment setup
          </button>
        </div>
      ) : (
        <>
          <div className="grid md:grid-cols-3 gap-4 mb-6">
            <div className="border rounded-lg p-4 bg-gray-50">
              <p className="text-sm text-gray-500 mb-1">Available for payout</p>
              <p className="text-2xl font-bold">${(availableCents / 100).toFixed(2)}</p>
              <p className="text-xs text-gray-500 mt-1">Ready to send to your bank</p>
            </div>
            {(data?.pendingCents ?? 0) > 0 && (
              <div className="border rounded-lg p-4 bg-gray-50">
                <p className="text-sm text-gray-500 mb-1">Pending</p>
                <p className="text-2xl font-bold">${((data?.pendingCents ?? 0) / 100).toFixed(2)}</p>
                {data?.payoutScheduleDescription && (
                  <p className="text-xs text-gray-500 mt-1">{data.payoutScheduleDescription}</p>
                )}
              </div>
            )}
            <div className="border rounded-lg p-4 bg-gray-50">
              <p className="text-sm text-gray-500 mb-1">Total earned</p>
              <p className="text-2xl font-bold">${((data?.totalEarnedCents ?? 0) / 100).toFixed(2)}</p>
            </div>
            <div className="border rounded-lg p-4 bg-gray-50">
              <p className="text-sm text-gray-500 mb-1">Total paid out</p>
              <p className="text-2xl font-bold">${((data?.totalPaidOutCents ?? 0) / 100).toFixed(2)}</p>
            </div>
          </div>

          {data?.payoutScheduleDescription && (data?.pendingCents ?? 0) === 0 && (
            <p className="text-sm text-gray-500 mb-4">{data.payoutScheduleDescription}</p>
          )}

          <p className="text-gray-600 mb-4">
            Send available funds to your bank account or manage your payment account in Stripe.
          </p>

          <div className="flex flex-wrap gap-4 mb-6">
            <button
              type="button"
              onClick={handlePayout}
              disabled={payoutLoading || availableCents < 100}
              className="btn disabled:opacity-50"
            >
              {payoutLoading ? "Processing…" : "Send to bank"}
            </button>
            <button
              type="button"
              onClick={handleManageAccount}
              className="btn border border-gray-300 bg-white hover:bg-gray-50"
            >
              Manage payment account
            </button>
            <Link href="/seller-hub/ship" className="btn border border-gray-300 bg-white hover:bg-gray-50">
              Ship items
            </Link>
            <Link href="/seller-hub/store/returns" className="btn border border-gray-300 bg-white hover:bg-gray-50">
              Requested returns
            </Link>
          </div>

          {availableCents < 100 && (
            <p className="text-sm text-gray-500 mb-4">Minimum payout is $1.00</p>
          )}

          {error && (
            <div className="border rounded-lg p-4 bg-red-50 mb-6">
              <p className="text-red-700">{error}</p>
            </div>
          )}

          <p className="text-sm text-gray-500 mb-2">
            View full payout history and bank details in your{" "}
            <button type="button" onClick={handleManageAccount} className="underline hover:no-underline">
              payment account
            </button>
            .
          </p>
          <h3 className="font-semibold mb-3">Transaction history</h3>
          {data?.transactions && data.transactions.length > 0 ? (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left p-3">Date</th>
                    <th className="text-left p-3">Type</th>
                    <th className="text-left p-3">Description</th>
                    <th className="text-right p-3">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {data.transactions.map((t) => (
                    <tr key={t.id} className="border-t">
                      <td className="p-3">{new Date(t.createdAt).toLocaleDateString()}</td>
                      <td className="p-3 capitalize">{t.type}</td>
                      <td className="p-3">{t.description ?? "—"}</td>
                      <td className={`p-3 text-right ${t.amountCents >= 0 ? "" : "text-red-600"}`} style={t.amountCents >= 0 ? { color: "var(--color-primary)" } : undefined}>
                        {t.amountCents >= 0 ? "+" : ""}${(t.amountCents / 100).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-gray-500">No transactions yet.</p>
          )}
        </>
      )}
    </div>
  );
}
