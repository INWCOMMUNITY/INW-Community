"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { PackingSlipPrint } from "@/components/PackingSlipPrint";
import { formatShippingAddress } from "@/lib/format-address";
import { getOrderStatusLabel } from "@/lib/order-status";

interface OrderItem {
  id: string;
  quantity: number;
  priceCentsAtPurchase: number;
  storeItem: { id: string; title: string; slug: string; photos: string[] };
}

interface Shipment {
  id: string;
  carrier: string;
  service: string;
  trackingNumber: string | null;
  labelUrl: string | null;
}

interface StoreOrder {
  id: string;
  orderNumber?: string;
  totalCents: number;
  shippingCostCents: number;
  status: string;
  stripePaymentIntentId?: string | null;
  shippingAddress: unknown;
  createdAt: string;
  buyer: { firstName: string; lastName: string; email: string };
  items: OrderItem[];
  shipment?: Shipment | null;
}

interface Rate {
  id: string;
  carrier: string;
  service: string;
  rateCents: number;
  totalCents: number;
  shipmentId: string;
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
  returnAddressFormatted?: string | null;
  packingSlipNote?: string | null;
}

const ORDER_TABS = [
  { key: "to_ship", label: "To ship", param: "mine=1&needsShipment=1" },
  { key: "shipped", label: "Shipped", param: "mine=1&shipped=1" },
  { key: "canceled", label: "Canceled", param: "mine=1&canceled=1" },
] as const;

type TabKey = (typeof ORDER_TABS)[number]["key"];

const DEFAULT_WEIGHT_OZ = 16;
const DEFAULT_LENGTH_IN = 12;
const DEFAULT_WIDTH_IN = 12;
const DEFAULT_HEIGHT_IN = 12;

function getTrackingUrl(carrier: string, trackingNumber: string): string {
  if (carrier === "USPS") return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingNumber}`;
  if (carrier === "UPS") return `https://www.ups.com/track?tracknum=${trackingNumber}`;
  if (carrier === "FedEx") return `https://www.fedex.com/fedextrack/?trknbr=${trackingNumber}`;
  return `https://www.google.com/search?q=track+${trackingNumber}`;
}

function initDimensionsFromOrders(
  _orders: StoreOrder[],
  setDimensions: (d: { weightOz: number; lengthIn: number; widthIn: number; heightIn: number }) => void
) {
  setDimensions({
    weightOz: DEFAULT_WEIGHT_OZ,
    lengthIn: DEFAULT_LENGTH_IN,
    widthIn: DEFAULT_WIDTH_IN,
    heightIn: DEFAULT_HEIGHT_IN,
  });
}

export function StorefrontOrdersContent(props: {
  backHref: string;
  backLabel: string;
  title: string;
  ordersBasePath: string;
  shippingSetupHref: string;
  loginCallbackUrl: string;
}) {
  const [tab, setTab] = useState<TabKey>("to_ship");
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [dimensions, setDimensions] = useState({
    weightOz: DEFAULT_WEIGHT_OZ,
    lengthIn: DEFAULT_LENGTH_IN,
    widthIn: DEFAULT_WIDTH_IN,
    heightIn: DEFAULT_HEIGHT_IN,
  });
  const [rates, setRates] = useState<Rate[]>([]);
  const [ratesLoading, setRatesLoading] = useState(false);
  const [ratesError, setRatesError] = useState<string | null>(null);
  const [purchaseLabelLoading, setPurchaseLabelLoading] = useState(false);
  const [purchaseLabelError, setPurchaseLabelError] = useState<string | null>(null);
  const [sellerProfile, setSellerProfile] = useState<SellerProfile | null>(null);

  useEffect(() => {
    setFetchError(null);
    setLoading(true);
    const param = ORDER_TABS.find((t) => t.key === tab)?.param ?? "mine=1";
    fetch(`/api/store-orders?${param}`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          const err = (data as { error?: string }).error ?? "Failed to load orders.";
          setFetchError(err);
          return [];
        }
        return Array.isArray(data) ? data : [];
      })
      .then(setOrders)
      .catch(() => {
        setFetchError("Connection failed.");
        setOrders([]);
      })
      .finally(() => setLoading(false));
  }, [tab]);

  useEffect(() => {
    if (tab !== "to_ship") return;
    fetch("/api/seller-profile")
      .then((r) => r.json())
      .then((data) => {
        const biz = data.business;
        setSellerProfile({
          business: biz
            ? {
                name: biz.name ?? null,
                phone: biz.phone ?? null,
                address: biz.address ?? null,
                city: biz.city ?? null,
                logoUrl: biz.logoUrl ?? null,
                website: biz.website ?? null,
                email: biz.email ?? null,
              }
            : null,
          returnAddressFormatted: data.returnAddressFormatted ?? null,
          packingSlipNote: data.packingSlipNote ?? null,
        });
      })
      .catch(() => setSellerProfile(null));
  }, [tab]);

  function toggleOrderSelection(orderId: string) {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }

  function selectAllToShip() {
    const toShip = orders.filter((o) => o.status === "paid" && !o.shipment && !(o as { shippedWithOrderId?: string }).shippedWithOrderId);
    setSelectedOrderIds(new Set(toShip.map((o) => o.id)));
    initDimensionsFromOrders(toShip, setDimensions);
  }

  async function getRates() {
    const ids = Array.from(selectedOrderIds);
    if (ids.length === 0) {
      setRatesError("Select at least one order.");
      return;
    }
    setRatesError(null);
    setRatesLoading(true);
    setRates([]);
    try {
      const res = await fetch("/api/shipping/rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderIds: ids,
          weightOz: dimensions.weightOz,
          lengthIn: dimensions.lengthIn,
          widthIn: dimensions.widthIn,
          heightIn: dimensions.heightIn,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = (data as { code?: string }).code;
        if (code === "SHIPPING_ACCOUNT_REQUIRED") {
          setRatesError("Connect your shipping account to get rates.");
          return;
        }
        setRatesError((data as { error?: string }).error ?? "Failed to get rates.");
        return;
      }
      setRates((data as { rates?: Rate[] }).rates ?? []);
    } catch {
      setRatesError("Connection failed.");
    } finally {
      setRatesLoading(false);
    }
  }

  async function purchaseLabel(rate: Rate) {
    const ids = Array.from(selectedOrderIds);
    if (ids.length === 0) return;
    setPurchaseLabelError(null);
    setPurchaseLabelLoading(true);
    try {
      const res = await fetch("/api/shipping/label", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderIds: ids,
          rateId: rate.id,
          carrier: rate.carrier,
          service: rate.service,
          rateCents: rate.rateCents,
          weightOz: dimensions.weightOz,
          lengthIn: dimensions.lengthIn,
          widthIn: dimensions.widthIn,
          heightIn: dimensions.heightIn,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = (data as { code?: string }).code;
        if (code === "SHIPPING_ACCOUNT_REQUIRED") {
          setPurchaseLabelError("Connect your shipping account to purchase labels.");
          return;
        }
        setPurchaseLabelError((data as { error?: string }).error ?? "Failed to purchase label.");
        return;
      }
      setRates([]);
      setSelectedOrderIds(new Set());
      setOrders((prev) =>
        prev.map((o) => {
          if (!ids.includes(o.id)) return o;
          const ship = (data as { shipment?: { id: string; trackingNumber?: string; carrier?: string; service?: string } }).shipment;
          return {
            ...o,
            status: "shipped",
            shipment: ship
              ? {
                  id: ship.id,
                  carrier: ship.carrier ?? "",
                  service: ship.service ?? "",
                  trackingNumber: ship.trackingNumber ?? null,
                  labelUrl: null,
                }
              : undefined,
          };
        })
      );
    } catch {
      setPurchaseLabelError("Connection failed.");
    } finally {
      setPurchaseLabelLoading(false);
    }
  }

  const toShipOrders = orders.filter(
    (o) => o.status === "paid" && !o.shipment && !(o as { shippedWithOrderId?: string }).shippedWithOrderId
  );
  const selectedOrders = orders.filter((o) => selectedOrderIds.has(o.id));
  const sameBuyer =
    selectedOrders.length <= 1 ||
    selectedOrders.every((o) => o.buyer.email === selectedOrders[0].buyer.email);

  return (
    <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-[var(--max-width)] mx-auto">
        <Link href={props.backHref} className="text-sm text-gray-600 hover:underline mb-4 inline-block">
          {props.backLabel}
        </Link>
        <h1 className="text-2xl font-bold mb-4">{props.title}</h1>

        {fetchError && (
          <div className="border rounded-lg p-6 bg-red-50 mb-6">
            <p className="text-red-700">{fetchError}</p>
            {fetchError.toLowerCase().includes("sign in") && (
              <Link
                href={`/login?callbackUrl=${encodeURIComponent(props.loginCallbackUrl)}`}
                className="btn mt-4 inline-block"
              >
                Sign in
              </Link>
            )}
          </div>
        )}

        <div className="flex gap-2 mb-6 border-b border-gray-200">
          {ORDER_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                tab === t.key
                  ? "border-[var(--color-primary)] text-[var(--color-primary)]"
                  : "border-transparent text-gray-600 hover:text-gray-900"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-gray-500">Loading…</p>
        ) : tab === "to_ship" ? (
          <>
            {toShipOrders.length === 0 ? (
              <p className="text-gray-500">No orders to ship.</p>
            ) : (
              <>
                <p className="text-sm text-gray-600 mb-4">
                  Connect your shipping account at{" "}
                  <Link href={props.shippingSetupHref} className="underline" style={{ color: "var(--color-link)" }}>
                    shipping setup
                  </Link>{" "}
                  to get rates and buy labels.
                </p>

                {ratesError && (
                  <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded text-amber-800 text-sm">
                    {ratesError}
                    {ratesError.includes("Connect your shipping") && (
                      <Link href={props.shippingSetupHref} className="ml-2 underline">
                        Go to shipping setup
                      </Link>
                    )}
                  </div>
                )}
                {purchaseLabelError && (
                  <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
                    {purchaseLabelError}
                  </div>
                )}

                <div className="mb-6 flex flex-wrap gap-4 items-center">
                  <button
                    type="button"
                    onClick={selectAllToShip}
                    className="text-sm font-medium text-gray-700 hover:underline"
                  >
                    Select all to ship
                  </button>
                  <div className="flex gap-4 items-center flex-wrap">
                    <label className="flex items-center gap-2 text-sm">
                      <span>Weight (oz)</span>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={dimensions.weightOz}
                        onChange={(e) => setDimensions((d) => ({ ...d, weightOz: Number(e.target.value) || 1 }))}
                        className="border rounded px-2 py-1 w-20"
                      />
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <span>L×W×H (in)</span>
                      <input
                        type="number"
                        min={1}
                        step={0.5}
                        value={dimensions.lengthIn}
                        onChange={(e) => setDimensions((d) => ({ ...d, lengthIn: Number(e.target.value) || 1 }))}
                        className="border rounded px-2 py-1 w-16"
                      />
                      <span>×</span>
                      <input
                        type="number"
                        min={1}
                        step={0.5}
                        value={dimensions.widthIn}
                        onChange={(e) => setDimensions((d) => ({ ...d, widthIn: Number(e.target.value) || 1 }))}
                        className="border rounded px-2 py-1 w-16"
                      />
                      <span>×</span>
                      <input
                        type="number"
                        min={1}
                        step={0.5}
                        value={dimensions.heightIn}
                        onChange={(e) => setDimensions((d) => ({ ...d, heightIn: Number(e.target.value) || 1 }))}
                        className="border rounded px-2 py-1 w-16"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={getRates}
                      disabled={ratesLoading || selectedOrderIds.size === 0}
                      className="btn text-sm py-2 px-4 disabled:opacity-50"
                    >
                      {ratesLoading ? "Getting rates…" : "Get rates"}
                    </button>
                  </div>
                </div>

                {rates.length > 0 && (
                  <div className="mb-6 border rounded-lg p-4 bg-gray-50">
                    <p className="font-medium mb-2">Select a rate to purchase label</p>
                    <ul className="space-y-2">
                      {rates.map((r) => (
                        <li key={r.id} className="flex items-center justify-between gap-4">
                          <span className="text-sm">
                            {r.carrier} {r.service} — ${(r.rateCents / 100).toFixed(2)}
                          </span>
                          <button
                            type="button"
                            onClick={() => purchaseLabel(r)}
                            disabled={purchaseLabelLoading}
                            className="btn text-sm py-1.5 px-3 disabled:opacity-50"
                          >
                            {purchaseLabelLoading ? "Purchasing…" : "Purchase label"}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {selectedOrders.length > 0 && sellerProfile && (
                  <div className="mb-6">
                    <PackingSlipPrint
                      orders={selectedOrders}
                      sellerProfile={sellerProfile}
                      combined={selectedOrders.length > 1 && sameBuyer}
                    />
                    <button
                      type="button"
                      onClick={() => window.print()}
                      className="btn text-sm py-2 px-4 no-print"
                    >
                      Print packing slip
                    </button>
                  </div>
                )}

                <ul className="space-y-4">
                  {toShipOrders.map((order) => (
                    <li key={order.id} className="border rounded-lg p-4">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="flex items-start gap-3 min-w-0">
                          <input
                            type="checkbox"
                            checked={selectedOrderIds.has(order.id)}
                            onChange={() => toggleOrderSelection(order.id)}
                            className="mt-1"
                          />
                          <div>
                            <Link
                              href={props.ordersBasePath + "/" + order.id}
                              className="font-medium hover:underline"
                              style={{ color: "var(--color-link)" }}
                            >
                              Order #{order.orderNumber ?? order.id.slice(-8).toUpperCase()}
                            </Link>
                            <p className="text-sm text-gray-600">
                              {order.buyer.firstName} {order.buyer.lastName} — {new Date(order.createdAt).toLocaleString()}
                            </p>
                            <p className="text-sm text-gray-500 mt-1">
                              {formatShippingAddress(order.shippingAddress) || "—"}
                            </p>
                            <p className="font-semibold mt-1">${(order.totalCents / 100).toFixed(2)}</p>
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        ) : (
          <>
            {orders.length === 0 ? (
              <p className="text-gray-500">
                {tab === "shipped" ? "No shipped orders." : "No canceled orders."}
              </p>
            ) : (
              <ul className="space-y-4">
                {orders.map((order) => (
                  <li key={order.id} className="border rounded-lg p-4">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <Link
                          href={props.ordersBasePath + "/" + order.id}
                          className="font-medium hover:underline"
                          style={{ color: "var(--color-link)" }}
                        >
                          Order #{order.orderNumber ?? order.id.slice(-8).toUpperCase()}
                        </Link>
                        <p className="text-sm text-gray-600">
                          {order.buyer.firstName} {order.buyer.lastName} — {new Date(order.createdAt).toLocaleString()}
                        </p>
                        <span
                          className="inline-block mt-1 px-2 py-0.5 rounded text-sm"
                          style={{ backgroundColor: "var(--color-section-alt)", color: "var(--color-primary)" }}
                        >
                          {getOrderStatusLabel(order.status)}
                        </span>
                        {order.shipment?.trackingNumber && (
                          <p className="text-sm mt-1">
                            <a
                              href={getTrackingUrl(order.shipment.carrier, order.shipment.trackingNumber)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:underline"
                              style={{ color: "var(--color-link)" }}
                            >
                              {order.shipment.carrier} {order.shipment.trackingNumber}
                            </a>
                          </p>
                        )}
                      </div>
                      <p className="font-semibold">${(order.totalCents / 100).toFixed(2)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}
