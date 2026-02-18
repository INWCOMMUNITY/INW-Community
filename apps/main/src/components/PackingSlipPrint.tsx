"use client";

import { PACKING_SLIP_FOOTER } from "@/lib/packing-slip";

interface OrderItem {
  id: string;
  quantity: number;
  priceCentsAtPurchase: number;
  storeItem: {
    id: string;
    title: string;
    slug: string;
    photos: string[];
    description?: string | null;
  };
}

interface StoreOrder {
  id: string;
  subtotalCents?: number;
  shippingCostCents: number;
  totalCents: number;
  status: string;
  shippingAddress: unknown;
  createdAt: string;
  buyer: { firstName: string; lastName: string; email: string };
  items: OrderItem[];
}

interface SellerProfile {
  business: {
    name: string;
    phone: string | null;
    address: string | null;
    city?: string | null;
    logoUrl: string | null;
    website?: string | null;
    email?: string | null;
  } | null;
  packingSlipNote?: string | null;
}

interface PackingSlipPrintProps {
  orders: StoreOrder[];
  sellerProfile: SellerProfile | null;
  combined?: boolean; // When true, group by buyer
}

function formatSellerAddress(addr: string | null, city?: string | null): string {
  if (!addr?.trim()) return "";
  const lines: string[] = [];
  addr.split(/\n/).forEach((line) => {
    const t = line.trim();
    if (t) lines.push(t);
  });
  if (city?.trim()) {
    lines.push(city.trim());
  }
  return lines.join("\n");
}

function formatShipToAddress(addr: unknown): string {
  if (!addr || typeof addr !== "object") return "";
  const a = addr as Record<string, string>;
  const parts: string[] = [];
  if (a.name) parts.push(a.name);
  if (a.street ?? a.address) parts.push((a.street ?? a.address) as string);
  if (a.street2) parts.push(a.street2);
  const cityStateZip = [a.city, a.state, a.zip].filter(Boolean).join(", ");
  if (cityStateZip) parts.push(cityStateZip);
  if (a.country && a.country !== "US") parts.push(a.country);
  return parts.join("\n");
}

export function PackingSlipPrint({
  orders,
  sellerProfile,
  combined = false,
}: PackingSlipPrintProps) {
  if (orders.length === 0 || !sellerProfile) {
    return null;
  }

  const biz = sellerProfile.business;

  const ordersToPrint = combined
    ? (() => {
        const byBuyer = new Map<string, StoreOrder[]>();
        orders.forEach((o) => {
          const key = o.buyer.email;
          if (!byBuyer.has(key)) byBuyer.set(key, []);
          byBuyer.get(key)!.push(o);
        });
        return Array.from(byBuyer.values()).map((group) => ({
          buyer: group[0].buyer,
          orders: group,
          combinedItems: group.flatMap((o) =>
            o.items.map((oi) => ({ ...oi, orderId: o.id }))
          ),
          totalCents: group.reduce((s, o) => s + o.totalCents, 0),
          subtotalCents: group.reduce(
            (s, o) => s + (o.subtotalCents ?? o.totalCents - o.shippingCostCents),
            0
          ),
          shippingCostCents: group.reduce((s, o) => s + o.shippingCostCents, 0),
          taxCents: (group as StoreOrder[]).reduce((s, o) => s + ((o as { taxCents?: number }).taxCents ?? 0), 0),
        }));
      })()
    : orders.map((order) => ({
        buyer: order.buyer,
        orders: [order],
        combinedItems: order.items.map((oi) => ({ ...oi, orderId: order.id })),
        totalCents: order.totalCents,
        subtotalCents: order.subtotalCents ?? order.totalCents - order.shippingCostCents,
        shippingCostCents: order.shippingCostCents,
        taxCents: (order as { taxCents?: number }).taxCents,
      }));

  const returnAddress = biz
    ? [biz.name, biz.phone, formatSellerAddress(biz.address, biz.city)].filter(Boolean).join("\n")
    : "";

  return (
    <div className="print-only packing-slip-container">
      {ordersToPrint.map((group, idx) => (
        <div key={idx} className="packing-slip break-inside-avoid flex flex-col">
          {/* Top header: Logo left aligned with note/website/email boxes on right */}
          <div className="flex justify-between items-start gap-6 mb-4">
            <div className="shrink-0">
              {biz?.logoUrl ? (
                <img src={biz.logoUrl} alt="" className="w-[120px] h-[120px] rounded-full object-cover border-2 border-black" />
              ) : (
                <div className="w-[120px] h-[120px] rounded-full border-2 border-black flex items-center justify-center text-xs text-center px-1 text-black">Business Logo</div>
              )}
            </div>
            <div className="flex-1 min-w-0 space-y-2">
              <div className="border border-black rounded p-3 pt-4 min-h-[4rem]">
                <p className="text-sm font-medium text-black">A Note from {biz?.name ?? "Business"}</p>
                {sellerProfile.packingSlipNote ? (
                  <p className="text-sm mt-2 whitespace-pre-wrap text-black">{sellerProfile.packingSlipNote}</p>
                ) : (
                  <p className="text-sm mt-2 text-black">—</p>
                )}
              </div>
              <div className="flex gap-2">
                <div className="flex-1 border border-black rounded p-2 pt-4 flex flex-col gap-0.5">
                  <p className="text-xs font-bold text-black">Sellers Website</p>
                  <p className="text-sm truncate text-black">{biz?.website ?? "—"}</p>
                </div>
                <div className="flex-1 border border-black rounded p-2 pt-4 flex flex-col gap-0.5">
                  <p className="text-xs font-bold text-black">Sellers Email</p>
                  <p className="text-sm truncate text-black">{biz?.email ?? "—"}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t-2 border-black my-4" />

          {/* Return Address | Shipping Address - titles same line, content aligned, left-aligned, symmetrical */}
          <div className="grid grid-cols-2 gap-6 mb-4 [&>div]:min-h-[5rem] [&>div]:border-2 [&>div]:border-black [&>div]:rounded [&>div]:p-4 [&>div]:pt-7">
            <div>
              <p className="text-xs font-semibold uppercase text-black mb-2">RETURN ADDRESS</p>
              <pre className="text-sm whitespace-pre-wrap font-sans text-black">{returnAddress || "—"}</pre>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-black mb-2">SHIPPING ADDRESS</p>
              <p className="font-medium text-sm text-black">{group.buyer.firstName} {group.buyer.lastName}</p>
              <pre className="text-sm whitespace-pre-wrap font-sans mt-2 text-black">{formatShipToAddress(group.orders[0].shippingAddress) || "—"}</pre>
            </div>
          </div>

          <div className="border-t-2 border-black my-4" />

          {/* Item details: full-width table; Shipping Cost & Total below */}
          <div className="mb-4 flex-1 flex flex-col">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-black">
                  <th className="text-left py-2 font-semibold w-20 text-black">Quantity</th>
                  <th className="text-left py-2 font-semibold text-black">Item Name</th>
                  <th className="text-right py-2 font-semibold w-24 text-black">Price Per Item</th>
                </tr>
              </thead>
              <tbody>
                {group.combinedItems.map((oi) => (
                  <tr key={oi.id} className="border-b border-black">
                    <td className="py-2 text-black">{oi.quantity}</td>
                    <td className="py-2 text-black">{oi.storeItem.title}</td>
                    <td className="text-right py-2 text-black">${(oi.priceCentsAtPurchase / 100).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex gap-4 mt-3 justify-end">
              <div className="border-2 border-black rounded p-2 min-w-[7rem] text-right">
                <p className="text-xs font-semibold text-black">Shipping Cost</p>
                <p className="text-sm font-medium text-black mt-2">${(group.shippingCostCents / 100).toFixed(2)}</p>
              </div>
              {(group as { taxCents?: number }).taxCents ? (
                <div className="border-2 border-black rounded p-2 min-w-[7rem] text-right">
                  <p className="text-xs font-semibold text-black">Tax</p>
                  <p className="text-sm font-medium text-black mt-2">${(((group as { taxCents: number }).taxCents) / 100).toFixed(2)}</p>
                </div>
              ) : null}
              <div className="border-2 border-black rounded p-2 min-w-[7rem] text-right">
                <p className="text-xs font-semibold text-black">Total</p>
                <p className="text-sm font-bold text-black mt-2">${(group.totalCents / 100).toFixed(2)}</p>
              </div>
            </div>
          </div>

          <div className="flex-1" />

          {group.orders.length > 1 && (
            <p className="text-xs text-black mb-2">
              Combined orders: {group.orders.map((o) => `#${o.id.slice(-8).toUpperCase()}`).join(", ")}
            </p>
          )}

          {/* Footer: line just above thank you message */}
          <div className="border-t-2 border-black text-center pt-4 pb-4">
            <p className="text-lg font-semibold text-black">Thank you for Supporting Locally Owned Businesses!</p>
            <p className="text-sm text-black mt-1">{PACKING_SLIP_FOOTER}</p>
          </div>
        </div>
      ))}
      <style jsx global>{`
        @media screen {
          .print-only {
            display: none !important;
          }
        }
        @media print {
          @page {
            margin: 0.25in;
            size: letter;
          }
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            background: white !important;
          }
          .no-print {
            display: none !important;
          }
          .seller-hub-layout {
            padding: 0 !important;
            gap: 0 !important;
          }
          .print-only {
            display: block !important;
            width: 100% !important;
            max-width: none !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          .packing-slip-container {
            min-height: 100vh;
          }
          .packing-slip {
            width: 100% !important;
            max-width: none !important;
            margin: 0 !important;
            padding: 0.25in !important;
            min-height: 100vh;
            box-sizing: border-box;
            page-break-after: always;
            font-size: 14pt;
            color: #000;
          }
          .packing-slip * {
            color: #000;
            box-shadow: none !important;
          }
          .packing-slip {
            box-shadow: none !important;
          }
          .packing-slip:last-child {
            page-break-after: auto;
          }
        }
      `}</style>
    </div>
  );
}
