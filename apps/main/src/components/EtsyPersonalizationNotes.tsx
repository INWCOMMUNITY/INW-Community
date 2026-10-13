"use client";

import { useEffect, useState } from "react";

type Answer = { questionId?: string | null; name?: string; value?: string };

type Sale = {
  id: string;
  etsyReceiptId: string;
  personalizationJson: Answer[] | null;
};

export function EtsyPersonalizationNotes() {
  const [sales, setSales] = useState<Sale[]>([]);

  useEffect(() => {
    fetch("/api/etsy/order-personalization")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { sales?: Sale[] } | null) => {
        setSales(Array.isArray(data?.sales) ? data.sales : []);
      })
      .catch(() => setSales([]));
  }, []);

  if (sales.length === 0) return null;
  return (
    <div className="mb-4 p-3 rounded-lg border border-gray-200 bg-white text-sm">
      <p className="font-medium mb-2">Etsy custom options</p>
      <ul className="space-y-2">
        {sales.map((sale) => (
          <li key={sale.id}>
            <span className="text-gray-500">Receipt {sale.etsyReceiptId}</span>
            {(sale.personalizationJson ?? []).map((answer, index) => (
              <p key={`${sale.id}-${index}`}>
                {answer.name || "Answer"}: {answer.value || "—"}
              </p>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
