"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { PackingSlipPrint } from "@/components/PackingSlipPrint";
import { formatShippingAddress } from "@/lib/format-address";

interface OrderItem {
  id: string;
  quantity: number;
  priceCentsAtPurchase: number;
  storeItem: { id: string; title: string; slug: string; photos: string[]; description?: string | null };
}

interface StoreOrder {
  id: string;
  totalCents: number;
  subtotalCents?: number;
  shippingCostCents: number;
  status: string;
  shippingAddress: unknown;
  createdAt: string;
  buyer: { firstName: string; lastName: string; email: string };
  items: OrderItem[];
  shipment: { id: string } | null;
  packageWeightOz?: number | null;
  packageLengthIn?: number | null;
  packageWidthIn?: number | null;
  packageHeightIn?: number | null;
}

interface Rate {
  id: string;
  carrier: string;
  service: string;
  rateCents: number;
  nwcFeeCents?: number;
  totalCents?: number;
  shipmentId?: string;
}

interface SellerProfile {
  business: { name: string; phone: string | null; address: string | null; city?: string | null; logoUrl: string | null } | null;
  packingSlipNote?: string | null;
}

const DEFAULT_WEIGHT_OZ = 16;
const DEFAULT_LENGTH = 12;
const DEFAULT_WIDTH = 9;
const DEFAULT_HEIGHT = 6;

export default function ShipItemsPage() {
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [addingTrial, setAddingTrial] = useState(false);
  const [dimensions, setDimensions] = useState<
    Record<string, { weightOz: number; lengthIn: number; widthIn: number; heightIn: number }>
  >({});
  const [rates, setRates] = useState<
    Record<string, { shipmentId: string; rates: Rate[]; loading?: boolean }>
  >({});
  const [selectedRates, setSelectedRates] = useState<Record<string, Rate>>({});
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [sellerProfile, setSellerProfile] = useState<SellerProfile | null>(null);
  const [combineByBuyer, setCombineByBuyer] = useState(false);
  const [shippingConnected, setShippingConnected] = useState<boolean | null>(null);
  const [hasReferralCustomer, setHasReferralCustomer] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);

  useEffect(() => {
    fetch("/api/shipping/status")
      .then((r) => r.json())
      .then((d: { connected?: boolean; easypostReferralCustomerId?: string | null }) => {
        setShippingConnected(d.connected ?? false);
        setHasReferralCustomer(Boolean(d.easypostReferralCustomerId));
      })
      .catch(() => setShippingConnected(false));
  }, []);

  useEffect(() => {
    setFetchError(null);
    fetch("/api/store-orders?mine=1&needsShipment=1")
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          const msg =
            r.status === 401
              ? "Please sign in to view orders."
              : r.status === 403
              ? (data as { error?: string }).error ?? "Seller plan required."
              : (data as { error?: string }).error ?? "Failed to load orders.";
          setFetchError(msg);
          return [];
        }
        return Array.isArray(data) ? data : [];
      })
      .then((data: StoreOrder[]) => {
        setOrders(data);
        const dims: Record<string, { weightOz: number; lengthIn: number; widthIn: number; heightIn: number }> = {};
        data.forEach((o) => {
          dims[o.id] = {
            weightOz: o.packageWeightOz ?? DEFAULT_WEIGHT_OZ,
            lengthIn: o.packageLengthIn ?? DEFAULT_LENGTH,
            widthIn: o.packageWidthIn ?? DEFAULT_WIDTH,
            heightIn: o.packageHeightIn ?? DEFAULT_HEIGHT,
          };
        });
        const byBuyer = new Map<string, StoreOrder[]>();
        data.forEach((o) => {
          const key = o.buyer.email;
          if (!byBuyer.has(key)) byBuyer.set(key, []);
          byBuyer.get(key)!.push(o);
        });
        byBuyer.forEach((group) => {
          if (group.length > 1) {
            const groupKey = group.map((o) => o.id).join("-");
            const first = group[0];
            dims[groupKey] = {
              weightOz: first.packageWeightOz ?? DEFAULT_WEIGHT_OZ * group.length,
              lengthIn: first.packageLengthIn ?? DEFAULT_LENGTH,
              widthIn: first.packageWidthIn ?? DEFAULT_WIDTH,
              heightIn: first.packageHeightIn ?? DEFAULT_HEIGHT,
            };
          }
        });
        setDimensions(dims);
      })
      .catch(() => {
        setFetchError("Connection failed. Make sure the server and PostgreSQL are running.");
        setOrders([]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (orders.length > 0) {
      fetch("/api/seller-profile")
        .then((r) => r.json())
        .then((p: SellerProfile) => setSellerProfile(p))
        .catch(() => setSellerProfile(null));
    } else {
      setSellerProfile(null);
    }
  }, [orders.length]);

  async function addTrialOrder() {
    setAddingTrial(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/store-orders/trial", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFetchError((data as { error?: string }).error ?? "Failed to add trial order.");
        return;
      }
      const order = data as StoreOrder;
      setOrders((prev) => [order, ...prev]);
      setDimensions((prev) => ({
        ...prev,
        [order.id]: {
          weightOz: order.packageWeightOz ?? DEFAULT_WEIGHT_OZ,
          lengthIn: order.packageLengthIn ?? DEFAULT_LENGTH,
          widthIn: order.packageWidthIn ?? DEFAULT_WIDTH,
          heightIn: order.packageHeightIn ?? DEFAULT_HEIGHT,
        },
      }));
    } catch {
      setFetchError("Failed to add trial order.");
    } finally {
      setAddingTrial(false);
    }
  }

  function updateDimensions(
    key: string,
    field: "weightOz" | "lengthIn" | "widthIn" | "heightIn",
    value: number
  ) {
    setDimensions((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] ?? {
          weightOz: DEFAULT_WEIGHT_OZ,
          lengthIn: DEFAULT_LENGTH,
          widthIn: DEFAULT_WIDTH,
          heightIn: DEFAULT_HEIGHT,
        }),
        [field]: value,
      },
    }));
  }

  async function getRates(orderIds: string[]) {
    const key = orderIds.join("-");
    const dim = dimensions[key] ?? {
      weightOz: DEFAULT_WEIGHT_OZ,
      lengthIn: DEFAULT_LENGTH,
      widthIn: DEFAULT_WIDTH,
      heightIn: DEFAULT_HEIGHT,
    };
    setRates((prev) => ({ ...prev, [key]: { ...prev[key], loading: true } }));
    setPurchaseError(null);
    try {
      const res = await fetch("/api/shipping/rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderIds,
          weightOz: dim.weightOz,
          lengthIn: dim.lengthIn,
          widthIn: dim.widthIn,
          heightIn: dim.heightIn,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRates((prev) => ({
          ...prev,
          [key]: { shipmentId: "", rates: [], loading: false },
        }));
        if ((data as { code?: string }).code === "SHIPPING_ACCOUNT_REQUIRED") {
          setShippingConnected(false);
        }
        setPurchaseError(data.error ?? "Failed to get rates");
        return;
      }
      setRates((prev) => ({
        ...prev,
        [key]: {
          shipmentId: data.shipmentId,
          rates: data.rates ?? [],
          loading: false,
        },
      }));
      setSelectedRates((prev) => ({ ...prev, [key]: (data.rates ?? [])[0] ?? null }));
    } catch {
      setRates((prev) => ({
        ...prev,
        [key]: { shipmentId: "", rates: [], loading: false },
      }));
      setPurchaseError("Failed to get rates");
    }
  }

  async function purchaseLabel(orderIds: string[]) {
    const key = orderIds.join("-");
    const rate = selectedRates[key];
    const rateData = rates[key];
    const dim = dimensions[key];
    if (!rate || !rateData?.shipmentId || !dim) return;

    setPurchasing(key);
    setPurchaseError(null);
    try {
      const res = await fetch("/api/shipping/label", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderIds,
          easypostShipmentId: rate.shipmentId ?? rateData.shipmentId,
          rateId: rate.id,
          carrier: rate.carrier,
          service: rate.service,
          rateCents: rate.rateCents,
          weightOz: dim.weightOz,
          lengthIn: dim.lengthIn,
          widthIn: dim.widthIn,
          heightIn: dim.heightIn,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if ((data as { code?: string }).code === "SHIPPING_ACCOUNT_REQUIRED") {
          setShippingConnected(false);
        }
        setPurchaseError(data.message ?? data.error ?? "Failed to purchase label");
        return;
      }
      setOrders((prev) => prev.filter((o) => !orderIds.includes(o.id)));
      setRates((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setSelectedRates((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      if (data.shipment?.labelUrl) {
        window.open(data.shipment.labelUrl, "_blank");
      }
    } catch {
      setPurchaseError("Failed to purchase label");
    } finally {
      setPurchasing(null);
    }
  }

  function getGroupKey(orderGroup: StoreOrder[]) {
    return orderGroup.map((o) => o.id).join("-");
  }

  if (loading) {
    return (
      <section className="py-12 px-4">
        <div className="max-w-[var(--max-width)] mx-auto">
          <p className="text-gray-500">Loading…</p>
        </div>
      </section>
    );
  }

  return (
    <>
    <section className="py-12 px-4 no-print">
      <div className="max-w-[var(--max-width)] mx-auto">
        <Link href="/seller-hub" className="text-sm text-gray-600 hover:underline mb-4 inline-block">
          ← Back to Seller Hub
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold">Ship Items</h1>
            <p className="mt-1 opacity-80">
              Purchase shipping labels for paid orders. Labels are charged to your connected
              shipping account (your card).
            </p>
          </div>
          {orders.length > 0 && sellerProfile && (
            <div className="flex flex-wrap items-center gap-3">
              {new Set(orders.map((o) => o.buyer.email)).size < orders.length && (
                <button
                  type="button"
                  onClick={() => setCombineByBuyer((prev) => !prev)}
                  className={`btn ${combineByBuyer ? "" : ""}`}
                >
                  {combineByBuyer ? "✓ Combine orders for same buyer" : "Combine orders for same buyer"}
                </button>
              )}
              <button
                type="button"
                onClick={() => window.print()}
                className="btn"
              >
                Print Packing Slips
              </button>
              <p className="text-xs text-gray-500 mt-2 no-print">
                Tip: In the print dialog, turn off &quot;Headers and footers&quot; to hide the page URL and page number on the printed slip.
              </p>
            </div>
          )}
        </div>

        {shippingConnected === false && (
          <div className="border rounded-lg p-6 mb-8 bg-amber-50 border-amber-200">
            <h2 className="font-semibold text-amber-900 mb-2">Set up Easy Post</h2>
            <p className="text-amber-800 mb-4">
              To get rates and buy labels, connect your EasyPost account. You pay for labels with
              your own card. Labels are printable from this site.
            </p>
            <Link href="/seller-hub/shipping-setup" className="btn inline-block">
              Set Up Easy Post
            </Link>
          </div>
        )}

        {shippingConnected === true && (
          <div className="flex flex-wrap items-center gap-3 mb-6 p-3 rounded-lg bg-green-50 border border-green-200">
            <span className="text-green-800 font-medium">Shipping account connected</span>
            <Link
              href="/seller-hub/shipping-setup"
              className="text-sm text-green-700 underline hover:no-underline"
            >
              Update API key
            </Link>
            {hasReferralCustomer && (
              <button
                type="button"
                onClick={async () => {
                  setPortalLoading(true);
                  try {
                    const res = await fetch("/api/shipping/portal", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        returnUrl: typeof window !== "undefined" ? `${window.location.origin}/seller-hub/ship?portal=return` : undefined,
                        refreshUrl: typeof window !== "undefined" ? `${window.location.origin}/seller-hub/ship?portal=refresh` : undefined,
                      }),
                    });
                    const data = await res.json().catch(() => ({}));
                    if (data?.url) window.location.href = data.url;
                    else setPurchaseError("Could not open payment settings");
                  } catch {
                    setPurchaseError("Could not open payment settings");
                  } finally {
                    setPortalLoading(false);
                  }
                }}
                disabled={portalLoading}
                className="text-sm text-green-700 underline hover:no-underline"
              >
                {portalLoading ? "Opening…" : "Manage payment method"}
              </button>
            )}
          </div>
        )}

        {fetchError && (
          <div className="border rounded-lg p-6 bg-red-50 mb-8">
            <p className="text-red-700">{fetchError}</p>
            {fetchError.includes("sign in") && (
              <Link href="/login?callbackUrl=/seller-hub/ship" className="btn mt-4 inline-block">
                Sign in
              </Link>
            )}
          </div>
        )}

        {purchaseError && (
          <div className="border rounded-lg p-4 bg-red-50 mb-6">
            <p className="text-red-700">{purchaseError}</p>
          </div>
        )}

        {orders.length === 0 && !fetchError ? (
          <div className="space-y-4">
            <p className="text-gray-500">No orders need shipping. All paid orders have labels.</p>
            <button
              type="button"
              onClick={addTrialOrder}
              disabled={addingTrial}
              className="btn"
            >
              {addingTrial ? "Adding…" : "Add trial order"}
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {(combineByBuyer && new Set(orders.map((o) => o.buyer.email)).size < orders.length
              ? (() => {
                  const byBuyer = new Map<string, StoreOrder[]>();
                  orders.forEach((o) => {
                    const key = o.buyer.email;
                    if (!byBuyer.has(key)) byBuyer.set(key, []);
                    byBuyer.get(key)!.push(o);
                  });
                  return Array.from(byBuyer.values());
                })()
              : orders.map((o) => [o])
            ).map((orderGroup) => {
              const groupKey = getGroupKey(orderGroup);
              const orderIds = orderGroup.map((o) => o.id);
              const dim = dimensions[groupKey] ?? {
                weightOz: DEFAULT_WEIGHT_OZ,
                lengthIn: DEFAULT_LENGTH,
                widthIn: DEFAULT_WIDTH,
                heightIn: DEFAULT_HEIGHT,
              };
              const rateData = rates[groupKey];
              const selectedRate = selectedRates[groupKey];
              const isPurchasing = purchasing === groupKey;
              const firstOrder = orderGroup[0];
              const allItems = orderGroup.flatMap((o) => o.items);

              return (
                <div
                  key={groupKey}
                  className={`border rounded-lg p-6 ${orderGroup.length > 1 ? "border-2" : ""}`}
                  style={orderGroup.length > 1 ? { backgroundColor: "color-mix(in srgb, var(--color-primary) 12%, white)", borderColor: "color-mix(in srgb, var(--color-primary) 25%, white)" } : undefined}
                >
                  {orderGroup.length > 1 && (
                    <div className="mb-4 pb-4 border-b-2 border-[var(--color-primary)]">
                      <p className="font-semibold" style={{ color: "var(--color-heading)" }}>
                        Combined orders for {firstOrder.buyer.firstName} {firstOrder.buyer.lastName} ({orderGroup.length} orders, {allItems.length} items)
                      </p>
                    </div>
                  )}
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <p className="font-semibold">
                        {firstOrder.buyer.firstName} {firstOrder.buyer.lastName}
                      </p>
                      <p className="text-sm text-gray-600">{firstOrder.buyer.email}</p>
                      {orderGroup.length === 1 && (
                        <p className="text-sm text-gray-500 mt-1">
                          {new Date(firstOrder.createdAt).toLocaleString()}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="font-bold">
                        ${(orderGroup.reduce((s, o) => s + o.totalCents, 0) / 100).toFixed(2)}
                      </p>
                    </div>
                  </div>

                  {firstOrder.shippingAddress != null && typeof firstOrder.shippingAddress === "object" && (
                    <div className="text-sm text-gray-600 mb-4">
                      <p className="font-medium">Shipping address</p>
                      <p className="mt-1 font-sans whitespace-pre-wrap">
                        {formatShippingAddress(firstOrder.shippingAddress)}
                      </p>
                    </div>
                  )}

                  <div className="border-t pt-4 mb-4">
                    <p className="font-medium mb-2">Items ({allItems.length})</p>
                    <ul className="space-y-2">
                      {allItems.map((oi) => (
                        <li key={oi.id} className="flex items-center gap-2">
                          {oi.storeItem.photos[0] && (
                            <img
                              src={oi.storeItem.photos[0]}
                              alt=""
                              className="w-10 h-10 object-cover rounded"
                            />
                          )}
                          <span>
                            {oi.storeItem.title} × {oi.quantity}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                    <div>
                      <label className="block text-sm font-medium mb-1">Weight (oz)</label>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={dim.weightOz}
                        onChange={(e) =>
                          updateDimensions(groupKey, "weightOz", parseFloat(e.target.value) || 1)
                        }
                        className="w-full border rounded px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Length (in)</label>
                      <input
                        type="number"
                        min={0.1}
                        step={0.1}
                        value={dim.lengthIn}
                        onChange={(e) =>
                          updateDimensions(groupKey, "lengthIn", parseFloat(e.target.value) || 1)
                        }
                        className="w-full border rounded px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Width (in)</label>
                      <input
                        type="number"
                        min={0.1}
                        step={0.1}
                        value={dim.widthIn}
                        onChange={(e) =>
                          updateDimensions(groupKey, "widthIn", parseFloat(e.target.value) || 1)
                        }
                        className="w-full border rounded px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Height (in)</label>
                      <input
                        type="number"
                        min={0.1}
                        step={0.1}
                        value={dim.heightIn}
                        onChange={(e) =>
                          updateDimensions(groupKey, "heightIn", parseFloat(e.target.value) || 1)
                        }
                        className="w-full border rounded px-3 py-2"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => getRates(orderIds)}
                      disabled={rateData?.loading}
                      className="btn"
                    >
                      {rateData?.loading
                        ? "Getting rates…"
                        : rateData?.rates && rateData.rates.length > 0
                        ? "Refresh"
                        : "Get rates"}
                    </button>

                    {rateData?.rates && rateData.rates.length > 0 && (() => {
                      const rateList = rateData.rates;
                      const cheapestTotal = Math.min(...rateList.map((r) => r.totalCents ?? r.rateCents));
                      return (
                        <>
                          <select
                            value={selectedRate?.id ?? ""}
                            onChange={(e) => {
                              const r = rateData.rates.find((x) => x.id === e.target.value);
                              if (r) setSelectedRates((prev) => ({ ...prev, [groupKey]: r }));
                            }}
                            className="border rounded px-3 py-2"
                          >
                            {rateList.map((r) => {
                              const total = r.totalCents ?? r.rateCents;
                              const isCheapest = total === cheapestTotal;
                              return (
                                <option key={r.id} value={r.id}>
                                  {r.carrier} {r.service} — ${(total / 100).toFixed(2)}
                                  {isCheapest && " (Most Affordable)"}
                                </option>
                              );
                            })}
                            </select>
                            {selectedRate && (selectedRate.totalCents ?? selectedRate.rateCents) === cheapestTotal && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                                Most Affordable
                              </span>
                            )}
                          <button
                            type="button"
                            onClick={() => purchaseLabel(orderIds)}
                            disabled={isPurchasing}
                            className="btn"
                          >
                            {isPurchasing ? "Purchasing…" : "Purchase label"}
                          </button>
                        </>
                      );
                    })()}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
    <PackingSlipPrint orders={orders} sellerProfile={sellerProfile} combined={combineByBuyer} />
    </>
  );
}
