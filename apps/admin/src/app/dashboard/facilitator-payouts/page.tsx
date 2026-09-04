"use client";

import { adminFetch } from "@/lib/admin-fetch";

import { useEffect, useState } from "react";

const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_SITE_URL || "http://localhost:3000";

interface FacilitatorRow {
  orderId: string;
  createdAt: string;
  status: string;
  sellerEmail: string;
  sellerName: string;
  connectAccountId: string | null;
  totalCents: number;
  taxCents: number;
  salesTaxReserveCents: number;
  platformFeeCents: number;
  expectedTransferCents: number;
  stripeSellerTransferId: string | null;
  transferMissing: boolean;
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function FacilitatorPayoutsPage() {
  const [rows, setRows] = useState<FacilitatorRow[]>([]);
  const [summary, setSummary] = useState<{
    count: number;
    missingTransferCount: number;
    taxCentsOnPlatform: number;
    reserveCentsOnPlatform: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [missingOnly, setMissingOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const params = missingOnly ? "?missingTransfer=1&limit=100" : "?limit=100";
    adminFetch(`${MAIN_URL}/api/admin/facilitator-payouts${params}`, {
      })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) {
          setError(d.error);
          setRows([]);
          return;
        }
        setError(null);
        setRows(Array.isArray(d.orders) ? d.orders : []);
        setSummary(d.summary ?? null);
      })
      .catch(() => setError("Failed to load"))
      .finally(() => setLoading(false));
  }, [missingOnly]);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Facilitator Payouts</h1>
      <p className="text-sm text-gray-600 mb-4">
        Sales tax and the 1% reserve stay on the NORTHWEST COMMUNITY LLC Stripe account.
        Seller proceeds should have a Connect transfer id. LLC Payouts in Stripe are not seller bank payouts.
      </p>
      <label className="flex items-center gap-2 text-sm mb-4">
        <input
          type="checkbox"
          checked={missingOnly}
          onChange={(e) => setMissingOnly(e.target.checked)}
        />
        Show only orders missing a Connect transfer
      </label>
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="border rounded p-3">
            <p className="text-xs text-gray-500">Orders</p>
            <p className="text-xl font-bold">{summary.count}</p>
          </div>
          <div className="border rounded p-3">
            <p className="text-xs text-gray-500">Missing Transfer</p>
            <p className="text-xl font-bold">{summary.missingTransferCount}</p>
          </div>
          <div className="border rounded p-3">
            <p className="text-xs text-gray-500">Tax on Platform</p>
            <p className="text-xl font-bold">{money(summary.taxCentsOnPlatform)}</p>
          </div>
          <div className="border rounded p-3">
            <p className="text-xs text-gray-500">Reserve on Platform</p>
            <p className="text-xl font-bold">{money(summary.reserveCentsOnPlatform)}</p>
          </div>
        </div>
      )}
      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : error ? (
        <p className="text-red-600">{error}</p>
      ) : (
        <div className="overflow-x-auto border rounded">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-2">Date</th>
                <th className="text-left p-2">Seller</th>
                <th className="text-left p-2">Status</th>
                <th className="text-right p-2">Total</th>
                <th className="text-right p-2">Tax</th>
                <th className="text-right p-2">Reserve</th>
                <th className="text-right p-2">Seller Transfer</th>
                <th className="text-left p-2">Transfer Id</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.orderId} className="border-t">
                  <td className="p-2 whitespace-nowrap">{new Date(r.createdAt).toLocaleDateString()}</td>
                  <td className="p-2">{r.sellerName || r.sellerEmail}</td>
                  <td className="p-2">{r.status}</td>
                  <td className="p-2 text-right">{money(r.totalCents)}</td>
                  <td className="p-2 text-right">{money(r.taxCents)}</td>
                  <td className="p-2 text-right">{money(r.salesTaxReserveCents)}</td>
                  <td className="p-2 text-right">{money(r.expectedTransferCents)}</td>
                  <td className={`p-2 font-mono text-xs ${r.transferMissing ? "text-red-600" : ""}`}>
                    {r.stripeSellerTransferId ?? "MISSING"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="p-4 text-gray-500">No orders found.</p>}
        </div>
      )}
    </div>
  );
}
