"use client";

import {
  PACKING_SLIP_FOOTER,
  PACKING_SLIP_THANKS,
  packingSlipContactLine,
  packingSlipOrderMetaLine,
  packingSlipTotalRows,
  type PackingSlipGroup,
  type PackingSlipSellerProfile,
} from "@/lib/packing-slip-shared";
import { formatShippingAddress } from "@/lib/format-address";

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
  taxCents?: number;
  status: string;
  shippingAddress: unknown;
  createdAt: string;
  stripePaymentIntentId?: string | null;
  orderKind?: string | null;
  buyer: { firstName: string; lastName: string; email: string };
  items: OrderItem[];
}

interface PackingSlipPrintProps {
  orders: StoreOrder[];
  sellerProfile: PackingSlipSellerProfile | null;
  combined?: boolean;
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

function shipToBlock(buyer: { firstName: string; lastName: string }, shippingAddress: unknown): string {
  const name = `${buyer.firstName} ${buyer.lastName}`.trim();
  const addr =
    shippingAddress && typeof shippingAddress === "object"
      ? ({ ...(shippingAddress as object), name } as Record<string, unknown>)
      : ({ name } as Record<string, unknown>);
  return formatShippingAddress(addr);
}

function toPrintGroup(order: StoreOrder): PackingSlipGroup {
  return {
    buyer: order.buyer,
    orders: [
      {
        id: order.id,
        shippingAddress: order.shippingAddress,
        createdAt: order.createdAt,
        stripePaymentIntentId: order.stripePaymentIntentId,
        orderKind: order.orderKind,
      },
    ],
    combinedItems: order.items.map((oi) => ({ ...oi, orderId: order.id })),
    totalCents: order.totalCents,
    subtotalCents: order.subtotalCents ?? order.totalCents - order.shippingCostCents,
    shippingCostCents: order.shippingCostCents,
    taxCents: order.taxCents,
  };
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
  const bizName = biz?.name?.trim() || "Packing slip";
  const contact = packingSlipContactLine(biz);
  const note = sellerProfile.packingSlipNote?.trim() ?? "";

  const ordersToPrint: PackingSlipGroup[] = combined
    ? (() => {
        const byBuyer = new Map<string, StoreOrder[]>();
        orders.forEach((o) => {
          const key = o.buyer.email;
          if (!byBuyer.has(key)) byBuyer.set(key, []);
          byBuyer.get(key)!.push(o);
        });
        return Array.from(byBuyer.values()).map((group) => ({
          buyer: group[0].buyer,
          orders: group.map((o) => ({
            id: o.id,
            shippingAddress: o.shippingAddress,
            createdAt: o.createdAt,
            stripePaymentIntentId: o.stripePaymentIntentId,
            orderKind: o.orderKind,
          })),
          combinedItems: group.flatMap((o) => o.items.map((oi) => ({ ...oi, orderId: o.id }))),
          totalCents: group.reduce((s, o) => s + o.totalCents, 0),
          subtotalCents: group.reduce(
            (s, o) => s + (o.subtotalCents ?? o.totalCents - o.shippingCostCents),
            0
          ),
          shippingCostCents: group.reduce((s, o) => s + o.shippingCostCents, 0),
          taxCents: group.reduce((s, o) => s + (o.taxCents ?? 0), 0),
        }));
      })()
    : orders.map(toPrintGroup);

  const returnAddress =
    sellerProfile.returnAddressFormatted?.trim() ||
    (biz ? [biz.name, biz.phone, formatSellerAddress(biz.address, biz.city)].filter(Boolean).join("\n") : "") ||
    "—";

  return (
    <div className="print-only packing-slip-container packing-slip-print-root">
      {ordersToPrint.map((group, idx) => (
        <div key={idx} className="packing-slip flex flex-col">
          <header className="flex items-start gap-4 mb-3">
            {biz?.logoUrl ? (
              <img
                src={biz.logoUrl}
                alt=""
                className="w-16 h-16 rounded-md object-contain border border-black shrink-0"
              />
            ) : null}
            <div className="min-w-0 flex-1">
              <p className="text-base font-bold leading-tight text-black">{bizName}</p>
              {contact ? <p className="text-xs text-black mt-1">{contact}</p> : null}
              {note ? <p className="text-xs italic text-black mt-2 whitespace-pre-wrap">{note}</p> : null}
            </div>
          </header>

          <p className="text-xs text-black mb-2">{packingSlipOrderMetaLine(group)}</p>
          <div className="border-t border-black" />

          <div className="grid grid-cols-2 gap-8 my-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-black mb-1">
                Return address
              </p>
              <pre className="text-xs whitespace-pre-wrap font-sans text-black">{returnAddress}</pre>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-black mb-1">Ship to</p>
              <pre className="text-xs whitespace-pre-wrap font-sans text-black">
                {shipToBlock(group.buyer, group.orders[0].shippingAddress) || "—"}
              </pre>
            </div>
          </div>

          <div className="border-t border-black" />

          <div className="mb-3 flex-1 flex flex-col">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-black">
                  <th className="text-left py-1.5 font-semibold w-10 text-black">Qty</th>
                  <th className="text-left py-1.5 font-semibold text-black">Item</th>
                  <th className="text-right py-1.5 font-semibold w-20 text-black">Unit price</th>
                  <th className="text-right py-1.5 font-semibold w-20 text-black">Line total</th>
                </tr>
              </thead>
              <tbody>
                {group.combinedItems.map((oi) => (
                  <tr key={oi.id} className="border-b border-black/40">
                    <td className="py-1.5 text-black align-top">{oi.quantity}</td>
                    <td className="py-1.5 text-black">{oi.storeItem.title}</td>
                    <td className="text-right py-1.5 text-black align-top">
                      ${(oi.priceCentsAtPurchase / 100).toFixed(2)}
                    </td>
                    <td className="text-right py-1.5 text-black align-top">
                      ${((oi.priceCentsAtPurchase * oi.quantity) / 100).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="ml-auto mt-3 w-52 text-xs">
              {packingSlipTotalRows(group).map((row) => (
                <div
                  key={row.label}
                  className={`flex justify-between ${
                    row.emphasis ? "border-t border-black pt-1.5 mt-1.5 font-bold text-sm" : "py-0.5"
                  } text-black`}
                >
                  <span>{row.label}</span>
                  <span>{row.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex-1" />

          <footer className="border-t border-black text-center pt-2 pb-1">
            <p className="text-xs text-black">{PACKING_SLIP_THANKS}</p>
            <p className="text-[10px] text-black mt-0.5">{PACKING_SLIP_FOOTER}</p>
          </footer>
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
            margin: 0.5in;
            size: letter;
          }
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            background: white !important;
          }
          body * {
            visibility: hidden !important;
          }
          .packing-slip-print-root,
          .packing-slip-print-root * {
            visibility: visible !important;
          }
          .packing-slip-print-root {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
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
          .packing-slip {
            width: 100% !important;
            max-width: none !important;
            margin: 0 !important;
            padding: 0 !important;
            min-height: calc(11in - 1in);
            box-sizing: border-box;
            page-break-after: always;
            font-size: 11pt;
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
