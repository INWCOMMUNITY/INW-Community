"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { carryOuncesIntoPoundsFields, formatShippingOptionPackageSummary } from "@/lib/package-weight";

type ShippingOption = {
  id: string;
  name: string;
  lengthIn: number | null;
  widthIn: number | null;
  heightIn: number | null;
  weightOz: number | null;
  weightLbs: number;
  weightOzRemainder: number;
  shippingCostCents: number | null;
  source: "inw" | "etsy" | "shopify";
  complete: boolean;
  listingCount: number;
};

type PageData = {
  options: ShippingOption[];
  offerFreeShippingOnInw: boolean;
  etsyConnected: boolean;
  shopifyConnected: boolean;
};

const emptyForm = {
  name: "",
  heightIn: "",
  widthIn: "",
  lengthIn: "",
  weightLbs: "",
  weightOz: "",
  shippingPrice: "",
};

function formatOptionPrice(cents: number | null | undefined): string {
  if (cents == null) return "No shipping price";
  if (cents === 0) return "Free";
  return `$${(cents / 100).toFixed(2)}`;
}

function dollarsToCents(raw: string): number {
  const trimmed = String(raw).trim();
  if (!trimmed) throw new Error("Shipping price is required");
  const n = Number(trimmed.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || n < 0) throw new Error("Enter a valid shipping price");
  return Math.round(n * 100);
}

function optionMetaLine(opt: ShippingOption): string {
  return [formatShippingOptionPackageSummary(opt), formatOptionPrice(opt.shippingCostCents)]
    .filter(Boolean)
    .join(" · ");
}

function ShippingPageInner() {
  const searchParams = useSearchParams();
  const [shippoError, setShippoError] = useState<string | null>(null);
  const [shippoSuccess, setShippoSuccess] = useState(false);
  const [shippoConnected, setShippoConnected] = useState<boolean | null>(null);

  const [data, setData] = useState<PageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState<"etsy" | "shopify" | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ShippingOption | null>(null);

  useEffect(() => {
    if (!searchParams) return;
    if (searchParams.get("nwAutoOAuth") === "1" && typeof window !== "undefined") {
      window.location.replace("/api/shipping/oauth-start");
    }
  }, [searchParams]);

  useEffect(() => {
    if (!searchParams) return;
    const oauthError = searchParams.get("oauth_error");
    if (oauthError) setShippoError(decodeURIComponent(oauthError));
    if (searchParams.get("connected") === "shippo") {
      setShippoSuccess(true);
      setShippoConnected(true);
      setShippoError(null);
    }
  }, [searchParams]);

  useEffect(() => {
    if (searchParams?.get("connected") === "shippo") return;
    fetch("/api/shipping/status", { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) return;
        const body = (await r.json().catch(() => ({}))) as { connected?: boolean };
        if (typeof body.connected === "boolean") setShippoConnected(body.connected);
      })
      .catch(() => {});
  }, [searchParams]);

  const load = useCallback(async () => {
    const res = await fetch("/api/shipping-options", { credentials: "include" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Could not load shipping options");
    setData(json as PageData);
  }, []);

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
  }, [load]);

  async function patchPrefs(patch: Partial<PageData>) {
    setError(null);
    const res = await fetch("/api/shipping-options", {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error || "Could not save");
      return;
    }
    setData(json as PageData);
  }

  async function createOption(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const shippingCostCents = dollarsToCents(form.shippingPrice);
      const weight = carryOuncesIntoPoundsFields(form.weightLbs, form.weightOz);
      const res = await fetch("/api/shipping-options", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          heightIn: Number(form.heightIn),
          widthIn: Number(form.widthIn),
          lengthIn: Number(form.lengthIn),
          weightLbs: Number(weight.weightLbs || 0),
          weightOz: Number(weight.weightOz || 0),
          shippingCostCents,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not create option");
      setForm(emptyForm);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create option");
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      const shippingCostCents = dollarsToCents(form.shippingPrice);
      const weight = carryOuncesIntoPoundsFields(form.weightLbs, form.weightOz);
      const res = await fetch(`/api/shipping-options/${editing.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          heightIn: Number(form.heightIn),
          widthIn: Number(form.widthIn),
          lengthIn: Number(form.lengthIn),
          weightLbs: Number(weight.weightLbs || 0),
          weightOz: Number(weight.weightOz || 0),
          shippingCostCents,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not update option");
      setEditing(null);
      setForm(emptyForm);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update option");
    } finally {
      setSaving(false);
    }
  }

  async function archive(id: string) {
    setMenuId(null);
    const res = await fetch(`/api/shipping-options/${id}`, { method: "DELETE", credentials: "include" });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error || "Could not remove option");
      return;
    }
    await load();
  }

  function startEdit(opt: ShippingOption) {
    setEditing(opt);
    setCreateOpen(true);
    setForm({
      name: opt.name,
      heightIn: opt.heightIn != null ? String(opt.heightIn) : "",
      widthIn: opt.widthIn != null ? String(opt.widthIn) : "",
      lengthIn: opt.lengthIn != null ? String(opt.lengthIn) : "",
      weightLbs: String(opt.weightLbs || 0),
      weightOz: String(opt.weightOzRemainder || 0),
      shippingPrice: opt.shippingCostCents != null ? (opt.shippingCostCents / 100).toFixed(2) : "",
    });
    setMenuId(null);
  }

  const sourceLabel = (source: string) =>
    source === "etsy" ? "Etsy" : source === "shopify" ? "Shopify" : "INW";

  function marketplaceShippingUrl(source: "etsy" | "shopify") {
    return source === "etsy"
      ? "https://www.etsy.com/your/shops/me/tools/shipping"
      : "https://admin.shopify.com/store";
  }

  async function importFrom(provider: "etsy" | "shopify") {
    setError(null);
    setImporting(provider);
    try {
      const res = await fetch("/api/shipping-options/import", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Could not import from ${sourceLabel(provider)}`);
      if (Array.isArray(json.options)) {
        setData((prev) =>
          prev
            ? {
                ...prev,
                options: json.options as ShippingOption[],
              }
            : prev
        );
      } else {
        await load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(null);
    }
  }

  function carryWeightFields(weightLbs: string, weightOz: string) {
    if (weightOz.endsWith(".")) return { weightLbs, weightOz };
    return carryOuncesIntoPoundsFields(weightLbs, weightOz);
  }

  const showConnected = shippoSuccess || shippoConnected === true;

  return (
    <section className="py-6 w-full max-md:px-4">
      <div className="w-full max-w-[var(--max-width)]">
        <Link href="/seller-hub" className="text-sm text-gray-600 hover:underline mb-4 inline-block">
          ← Back to Seller Hub
        </Link>
        <h1 className="text-3xl font-bold mb-2">Shipping</h1>
        <p className="text-gray-600 mb-8">
          Connect Shippo for labels, then manage named packages (size, weight, and INW shipping price) used for
          checkout, labels, and listing sync. Add at least one address to your Shippo{" "}
          <strong>Address Book</strong> (Settings → Addresses) so rates and labels work.
        </p>

        {showConnected ? (
          <div className="border rounded-lg p-4 bg-green-50 border-green-200 mb-6 w-full">
            <p className="text-green-800 font-medium">Shippo is connected.</p>
            <p className="text-green-700 text-sm mt-1">
              Select orders and click <strong>Purchase Labels</strong> to buy and print on the site.
            </p>
            <Link href="/seller-hub/orders?tab=ship" className="btn mt-4 inline-block">
              Go to My Orders
            </Link>
            <p className="text-sm text-gray-500 mt-4">
              Need to use a different Shippo account?{" "}
              <Link href="/api/shipping/oauth-start" className="underline">
                Reconnect with Shippo
              </Link>
            </p>
          </div>
        ) : (
          <div className="border-2 rounded-lg p-6 mb-8 border-[var(--color-primary)] bg-white w-full">
            <h2 className="font-semibold text-lg mb-2">Connect with Shippo</h2>
            <p className="text-gray-600 mb-4">
              {shippoConnected === null
                ? "Checking your shipping connection…"
                : "Sign in or create a Shippo account and connect it to Northwest Community in one step."}
            </p>
            {shippoConnected === false ? (
              <Link href="/api/shipping/oauth-start" className="btn inline-block">
                Connect with Shippo
              </Link>
            ) : null}
          </div>
        )}

        {shippoError ? (
          <div className="border rounded-lg p-4 bg-red-50 border-red-200 mb-6 w-full">
            <p className="text-red-700">{shippoError}</p>
          </div>
        ) : null}

        <h2 className="text-xl font-semibold mb-2" style={{ color: "var(--color-heading)" }}>
          Shipping options
        </h2>
        <p className="text-gray-600 mb-6">
          Create packages for listings, or import from connected marketplaces.
        </p>

        {error ? (
          <div className="border rounded-lg p-4 bg-red-50 border-red-200 mb-6">
            <p className="text-red-700">{error}</p>
          </div>
        ) : null}

        <div className="flex flex-col gap-3 mb-8">
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="btn"
              disabled={!data?.etsyConnected || importing != null}
              onClick={() => void importFrom("etsy")}
              title={data?.etsyConnected ? undefined : "Connect Etsy in Sync Airport first"}
            >
              {importing === "etsy" ? "Importing Etsy…" : "Import from Etsy"}
            </button>
            <button
              type="button"
              className="btn"
              disabled={!data?.shopifyConnected || importing != null}
              onClick={() => void importFrom("shopify")}
              title={data?.shopifyConnected ? undefined : "Connect Shopify in Sync Airport first"}
            >
              {importing === "shopify" ? "Importing Shopify…" : "Import from Shopify"}
            </button>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="rounded"
              checked={Boolean(data?.offerFreeShippingOnInw)}
              onChange={(e) => void patchPrefs({ offerFreeShippingOnInw: e.target.checked })}
            />
            <span>Offer free shipping on INW (Recommended)</span>
          </label>
        </div>

        <div className="border-2 rounded-lg p-6 mb-8 border-[var(--color-primary)] bg-white">
          <button
            type="button"
            className="font-semibold text-lg mb-4 flex items-center gap-2"
            onClick={() => setCreateOpen((v) => !v)}
          >
            <span>{editing ? "Edit Shipping Option" : "Create Shipping Option"}</span>
            <span aria-hidden>{createOpen ? "▾" : "▸"}</span>
          </button>
          {createOpen && (
            <form onSubmit={editing ? saveEdit : createOption} className="grid gap-4 max-w-xl">
              <label className="block">
                <span className="text-sm font-medium">Name of option</span>
                <input
                  className="mt-1 w-full border rounded px-3 py-2"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  required
                />
              </label>
              <div>
                <span className="text-sm font-medium">Dimensions (in)</span>
                <div className="mt-1 grid grid-cols-3 gap-2">
                  <input
                    className="border rounded px-3 py-2"
                    placeholder="Height (in)"
                    inputMode="decimal"
                    value={form.heightIn}
                    onChange={(e) => setForm((f) => ({ ...f, heightIn: e.target.value }))}
                    required
                  />
                  <input
                    className="border rounded px-3 py-2"
                    placeholder="Width (in)"
                    inputMode="decimal"
                    value={form.widthIn}
                    onChange={(e) => setForm((f) => ({ ...f, widthIn: e.target.value }))}
                    required
                  />
                  <input
                    className="border rounded px-3 py-2"
                    placeholder="Length (in)"
                    inputMode="decimal"
                    value={form.lengthIn}
                    onChange={(e) => setForm((f) => ({ ...f, lengthIn: e.target.value }))}
                    required
                  />
                </div>
              </div>
              <div>
                <span className="text-sm font-medium">Weight</span>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  <input
                    className="border rounded px-3 py-2"
                    placeholder="lbs"
                    inputMode="numeric"
                    value={form.weightLbs}
                    onChange={(e) => setForm((f) => ({ ...f, weightLbs: e.target.value }))}
                    onBlur={() =>
                      setForm((f) => ({ ...f, ...carryWeightFields(f.weightLbs, f.weightOz) }))
                    }
                  />
                  <input
                    className="border rounded px-3 py-2"
                    placeholder="oz"
                    inputMode="decimal"
                    value={form.weightOz}
                    onChange={(e) => {
                      const weightOz = e.target.value;
                      setForm((f) => ({ ...f, ...carryWeightFields(f.weightLbs, weightOz) }));
                    }}
                    onBlur={() =>
                      setForm((f) => ({ ...f, ...carryWeightFields(f.weightLbs, f.weightOz) }))
                    }
                  />
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  16 ounces = 1 pound. Extra ounces are added to lbs automatically.
                </p>
              </div>
              <label className="block">
                <span className="text-sm font-medium">Shipping price (USD)</span>
                <input
                  className="mt-1 w-full border rounded px-3 py-2"
                  placeholder="e.g. 5.99"
                  inputMode="decimal"
                  value={form.shippingPrice}
                  onChange={(e) => setForm((f) => ({ ...f, shippingPrice: e.target.value }))}
                  required
                />
                <span className="block text-xs text-gray-500 mt-0.5">
                  INW checkout shipping price. Use 0 for free.
                </span>
              </label>
              <div className="flex gap-2">
                <button type="submit" className="btn" disabled={saving}>
                  {saving ? "Saving…" : editing ? "Save" : "Add Option"}
                </button>
                {editing && (
                  <button
                    type="button"
                    className="text-sm underline"
                    onClick={() => {
                      setEditing(null);
                      setForm(emptyForm);
                    }}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>
          )}
        </div>

        <ol className="space-y-3">
          {(data?.options ?? []).map((opt, idx) => (
            <li
              key={opt.id}
              className="border rounded-lg px-4 py-3 bg-white flex items-center gap-3 relative"
            >
              <span className="text-sm text-gray-500 w-6">{idx + 1}.</span>
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{opt.name}</p>
                {optionMetaLine(opt) ? (
                  <p className="text-xs text-gray-500">{optionMetaLine(opt)}</p>
                ) : null}
              </div>
              {opt.source !== "inw" && (
                <span className="text-xs rounded-full px-2 py-0.5 bg-gray-100 border">
                  {sourceLabel(opt.source)}
                </span>
              )}
              <button
                type="button"
                className="px-2 py-1 text-lg leading-none"
                aria-label="More"
                onClick={() => setMenuId((id) => (id === opt.id ? null : opt.id))}
              >
                ⋯
              </button>
              {menuId === opt.id && (
                <div className="absolute right-3 top-12 z-10 border rounded-md bg-white shadow-md py-1 min-w-[12rem]">
                  <button
                    type="button"
                    className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                    onClick={() => startEdit(opt)}
                  >
                    Edit
                  </button>
                  {opt.source === "etsy" || opt.source === "shopify" ? (
                    <a
                      className="block px-3 py-2 text-sm hover:bg-gray-50"
                      href={marketplaceShippingUrl(opt.source)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open {sourceLabel(opt.source)}
                    </a>
                  ) : null}
                  <button
                    type="button"
                    className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                    onClick={() => void archive(opt.id)}
                  >
                    {opt.source === "inw" ? "Remove" : "Hide on INW"}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ol>
        {data && data.options.length === 0 && (
          <p className="text-sm text-gray-500">
            No shipping options yet. Create one above or import from Etsy/Shopify.
          </p>
        )}
      </div>
    </section>
  );
}

export default function ShippingPage() {
  return (
    <Suspense fallback={<p className="p-8 text-gray-500 text-center">Loading…</p>}>
      <ShippingPageInner />
    </Suspense>
  );
}
