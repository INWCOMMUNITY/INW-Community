"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface Offer {
  id: string;
  amountCents: number;
  message: string | null;
  status: string;
  sellerResponse: string | null;
  createdAt: string;
  storeItem: { id: string; title: string; slug: string; priceCents: number };
  buyer: { id: string; firstName: string; lastName: string };
}

export default function SellerHubOffersPage() {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/resale-offers?role=seller")
      .then((r) => r.json())
      .then((data) => setOffers(Array.isArray(data) ? data : []))
      .catch(() => setOffers([]))
      .finally(() => setLoading(false));
  }, []);

  async function respond(offerId: string, status: "accepted" | "declined", sellerResponse?: string) {
    const res = await fetch(`/api/resale-offers/${offerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, sellerResponse: sellerResponse || undefined }),
    });
    if (res.ok) {
      setOffers((prev) =>
        prev.map((o) => (o.id === offerId ? { ...o, status, sellerResponse: sellerResponse ?? null } : o))
      );
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data.error ?? "Failed to update offer");
    }
  }

  if (loading) return <p className="text-gray-500">Loading…</p>;

  const pending = offers.filter((o) => o.status === "pending");
  const responded = offers.filter((o) => o.status !== "pending");

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">New Offers</h1>
      <p className="text-gray-600 mb-6">
        Offers on your resale items. Accept or decline and add an optional message.
      </p>
      {pending.length === 0 && responded.length === 0 ? (
        <p className="text-gray-500">No offers yet.</p>
      ) : (
        <div className="space-y-6">
          {pending.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold mb-3">Pending</h2>
              <ul className="space-y-4">
                {pending.map((o) => (
                  <li key={o.id} className="border rounded-lg p-4 bg-gray-50">
                    <div className="flex flex-wrap justify-between gap-2">
                      <div>
                        <Link
                          href={`/resale/${o.storeItem.slug}`}
                          className="font-medium text-[var(--color-link)] hover:underline"
                        >
                          {o.storeItem.title}
                        </Link>
                        <p className="text-sm text-gray-600 mt-1">
                          ${(o.amountCents / 100).toFixed(2)} from {o.buyer.firstName} {o.buyer.lastName}
                        </p>
                        {o.message && (
                          <p className="text-sm text-gray-700 mt-2 whitespace-pre-wrap">{o.message}</p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => respond(o.id, "accepted")}
                          className="btn text-sm"
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          onClick={() => respond(o.id, "declined")}
                          className="btn border border-gray-300 bg-white hover:bg-gray-50 text-sm"
                        >
                          Decline
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {responded.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold mb-3">Responded</h2>
              <ul className="space-y-2">
                {responded.map((o) => (
                  <li key={o.id} className="border rounded p-3 text-sm">
                    <Link href={`/resale/${o.storeItem.slug}`} className="text-[var(--color-link)] hover:underline">
                      {o.storeItem.title}
                    </Link>
                    {" — "}
                    ${(o.amountCents / 100).toFixed(2)} from {o.buyer.firstName} {o.buyer.lastName}
                    {" — "}
                    <span className={o.status === "accepted" ? "text-green-600" : "text-gray-600"}>
                      {o.status}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
