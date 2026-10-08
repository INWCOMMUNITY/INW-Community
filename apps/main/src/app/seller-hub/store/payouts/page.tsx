"use client";

import { useState, useEffect } from "react";
import { IonIcon } from "@/components/IonIcon";

interface Transaction {
  id: string;
  type: string;
  amountCents: number;
  description: string | null;
  createdAt: string;
  breakdown?: {
    itemAndShippingCents: number;
    salesTaxCents: number;
    salesTaxReserveCents: number;
    processingFeeCents: number;
    stripeTaxProductFeeCents?: number;
    stripeFeesCents?: number;
    optionalPlatformFeeCents: number;
    sellerTransferCents: number;
    note: string;
  } | null;
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

const TRANSACTIONS_PAGE_SIZE = 10;

export default function MyFundsPage() {
  const [data, setData] = useState<FundsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [payoutLoading, setPayoutLoading] = useState(false);
  const [disconnectLoading, setDisconnectLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visibleTransactionCount, setVisibleTransactionCount] = useState(TRANSACTIONS_PAGE_SIZE);
  const [infoOpen, setInfoOpen] = useState(false);
  const [disconnectConfirmOpen, setDisconnectConfirmOpen] = useState(false);

  function fetchFunds() {
    setLoading(true);
    fetch("/api/seller-funds")
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d.error) {
          setError(d.error ?? "Failed to load");
          return;
        }
        setError(null);
        setData(d);
        setVisibleTransactionCount(TRANSACTIONS_PAGE_SIZE);
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
    if (!res.ok) {
      setError(d.error ?? "Payment setup failed");
      return;
    }
    // Existing Express account: reconnect stays on My Funds (no new Stripe onboarding).
    if (d.reused) {
      fetchFunds();
      return;
    }
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

  async function handleDisconnectStripe() {
    setDisconnectConfirmOpen(false);
    setDisconnectLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/me/disconnect-stripe", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? "Could not disconnect");
        return;
      }
      fetchFunds();
    } finally {
      setDisconnectLoading(false);
    }
  }

  const availableCents =
    data?.availableForPayoutCents !== undefined ? data.availableForPayoutCents : data?.balanceCents ?? 0;

  if (loading) return <p className="text-gray-500">Loading…</p>;

  if (error && !data) {
    return (
      <div>
        <h2
          className="text-3xl sm:text-4xl font-bold mb-6"
          style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
        >
          My Funds
        </h2>
        <div className="border rounded-lg p-4 bg-red-50 mb-6">
          <p className="text-red-700">{error}</p>
        </div>
        <button type="button" onClick={fetchFunds} className="btn">
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div>
      <h2
        className="text-3xl sm:text-4xl font-bold mb-6"
        style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
      >
        My Funds
      </h2>
      {!data?.hasStripeConnect ? (
        <div className="border rounded-lg p-4 bg-amber-50">
          <p className="mb-3">Complete Stripe Connect setup to receive payouts from sales.</p>
          <button type="button" onClick={handleSetup} className="btn">
            Complete Payment Setup
          </button>
        </div>
      ) : (
        <>
          <div className="grid md:grid-cols-3 gap-4 mb-6">
            <div className="border rounded-lg p-4 bg-gray-50">
              <p className="text-sm text-gray-500 mb-1">Available for Payout</p>
              <p className="text-2xl font-bold">${(availableCents / 100).toFixed(2)}</p>
              <p className="text-xs text-gray-500 mt-1">Ready to Send to Your Bank</p>
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
              <p className="text-sm text-gray-500 mb-1">Total Earned</p>
              <p className="text-2xl font-bold">${((data?.totalEarnedCents ?? 0) / 100).toFixed(2)}</p>
            </div>
            <div className="border rounded-lg p-4 bg-gray-50">
              <p className="text-sm text-gray-500 mb-1">Total Paid Out</p>
              <p className="text-2xl font-bold">${((data?.totalPaidOutCents ?? 0) / 100).toFixed(2)}</p>
            </div>
          </div>

          <div className="mb-4">
            <button
              type="button"
              onClick={() => setInfoOpen((open) => !open)}
              className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-[var(--color-earth)] transition-colors"
              aria-expanded={infoOpen}
              aria-controls="payout-info-panel"
            >
              <IonIcon name="information-circle-outline" size={20} />
              <span>Payout info</span>
              <IonIcon
                name={infoOpen ? "chevron-up-outline" : "chevron-down-outline"}
                size={16}
                className="opacity-70"
              />
            </button>
            {infoOpen ? (
              <ul
                id="payout-info-panel"
                className="mt-3 space-y-2 text-sm text-gray-600 border border-gray-200 rounded-lg bg-[var(--color-tan-light)] px-4 py-3"
              >
                <li className="flex gap-2">
                  <span className="shrink-0" aria-hidden>
                    •
                  </span>
                  <span>
                    Stripe fees (card processing ~2.9% + $0.30, and Stripe Tax 0.5% when sales tax is collected) and a
                    1% sales tax reserve are withheld from each sale before funds are sent to your Connect account.
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="shrink-0" aria-hidden>
                    •
                  </span>
                  <span>
                    {data?.payoutScheduleDescription ?? "Funds typically available in 2 business days"}
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="shrink-0" aria-hidden>
                    •
                  </span>
                  <span>
                    Once available, Stripe pays out to your linked bank automatically on its schedule — no approval
                    needed in your Stripe dashboard. Funds do not sit in your Connect account forever.
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="shrink-0" aria-hidden>
                    •
                  </span>
                  <span>
                    Send to Bank requests a payout now if you have available balance and do not want to wait for the
                    next automatic transfer. Open Stripe Dashboard to manage bank details and payout history.
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="shrink-0" aria-hidden>
                    •
                  </span>
                  <span>
                    Buyer-paid sales tax stays with the platform for remittance. INW handles submitting all sales tax.
                  </span>
                </li>
              </ul>
            ) : null}
          </div>

          <div className="flex flex-wrap items-start gap-4 mb-6">
            <div className="inline-flex flex-col items-stretch gap-3">
              <button
                type="button"
                onClick={handleManageAccount}
                className="btn border border-gray-300 bg-white hover:!bg-[var(--color-earth)] hover:!text-white"
              >
                Open Stripe Dashboard
              </button>
              <button
                type="button"
                onClick={() => setDisconnectConfirmOpen(true)}
                disabled={disconnectLoading}
                className="w-full rounded px-2.5 py-1 text-xs font-medium text-white bg-[#800020] hover:bg-[#6b001b] disabled:opacity-50 transition-colors"
                title="Disconnect your Stripe account. Your listings will be disabled until you complete payment setup again."
              >
                {disconnectLoading ? "Disconnecting…" : "Disconnect Stripe Account"}
              </button>
            </div>
            <button
              type="button"
              onClick={handlePayout}
              disabled={payoutLoading || availableCents < 100}
              className="btn disabled:opacity-50 hover:!bg-[var(--color-earth)] hover:!text-white disabled:hover:!bg-[var(--color-button)] disabled:hover:!text-[var(--color-button-text)]"
            >
              {payoutLoading ? "Processing…" : "Send to Bank"}
            </button>
          </div>

          {disconnectConfirmOpen ? (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
              role="dialog"
              aria-modal="true"
              aria-labelledby="disconnect-stripe-title"
            >
              <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-lg">
                <h3
                  id="disconnect-stripe-title"
                  className="text-lg font-semibold mb-2"
                  style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
                >
                  Are you sure?
                </h3>
                <p className="text-sm text-gray-600 mb-5">
                  Disconnect your Stripe account? Your listings will be disabled until you complete payment setup
                  again.
                </p>
                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setDisconnectConfirmOpen(false)}
                    disabled={disconnectLoading}
                    className="btn border border-gray-300 bg-white hover:!bg-gray-50 !text-[var(--color-heading)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleDisconnectStripe}
                    disabled={disconnectLoading}
                    className="rounded px-3 py-2 text-sm font-medium text-white bg-[#800020] hover:bg-[#6b001b] disabled:opacity-50 transition-colors"
                  >
                    {disconnectLoading ? "Disconnecting…" : "Yes, Disconnect"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

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
          <h3 className="font-semibold mb-3">Transaction History</h3>
          {data?.transactions && data.transactions.length > 0 ? (
            <>
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
                    {data.transactions.slice(0, visibleTransactionCount).map((t) => (
                      <tr key={t.id} className="border-t align-top">
                        <td className="p-3">{new Date(t.createdAt).toLocaleDateString()}</td>
                        <td className="p-3 capitalize">{t.type}</td>
                        <td className="p-3">
                          <div>{t.description ?? "—"}</div>
                          {t.breakdown ? (
                            <div className="mt-2 text-xs text-gray-600 space-y-0.5">
                              <div>Item + shipping: ${(t.breakdown.itemAndShippingCents / 100).toFixed(2)}</div>
                              {t.breakdown.salesTaxCents > 0 ? (
                                <div>Sales tax (platform keeps): ${(t.breakdown.salesTaxCents / 100).toFixed(2)}</div>
                              ) : null}
                              {t.breakdown.salesTaxReserveCents > 0 ? (
                                <div>1% sales tax reserve: −${(t.breakdown.salesTaxReserveCents / 100).toFixed(2)}</div>
                              ) : null}
                              {((t.breakdown.stripeFeesCents ??
                                t.breakdown.processingFeeCents + (t.breakdown.stripeTaxProductFeeCents ?? 0)) > 0) ? (
                                <div>
                                  Stripe fees: −$
                                  {(
                                    (t.breakdown.stripeFeesCents ??
                                      t.breakdown.processingFeeCents + (t.breakdown.stripeTaxProductFeeCents ?? 0)) /
                                    100
                                  ).toFixed(2)}
                                </div>
                              ) : null}
                              {t.breakdown.optionalPlatformFeeCents > 0 ? (
                                <div>Platform fee: −${(t.breakdown.optionalPlatformFeeCents / 100).toFixed(2)}</div>
                              ) : null}
                              <div className="font-medium text-gray-800">
                                Sent to your Connect account: ${(t.breakdown.sellerTransferCents / 100).toFixed(2)}
                              </div>
                              {t.breakdown.note ? (
                                <div className="pt-1 text-[11px] text-gray-500 leading-snug">{t.breakdown.note}</div>
                              ) : null}
                            </div>
                          ) : null}
                        </td>
                        <td className={`p-3 text-right ${t.amountCents >= 0 ? "" : "text-red-600"}`} style={t.amountCents >= 0 ? { color: "var(--color-primary)" } : undefined}>
                          {t.amountCents >= 0 ? "+" : ""}${(t.amountCents / 100).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {visibleTransactionCount < data.transactions.length ? (
                <div className="mt-4 flex flex-col items-center gap-2">
                  <p className="text-xs text-gray-500">
                    Showing {Math.min(visibleTransactionCount, data.transactions.length)} of{" "}
                    {data.transactions.length}
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      setVisibleTransactionCount((n) =>
                        Math.min(n + TRANSACTIONS_PAGE_SIZE, data.transactions.length)
                      )
                    }
                    className="action-pill action-pill-lg btn-pill-primary"
                  >
                    See More
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-gray-500">No transactions yet.</p>
          )}
        </>
      )}
    </div>
  );
}
