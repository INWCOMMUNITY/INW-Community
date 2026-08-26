"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ETSY_WHEN_MADE_OPTIONS, ETSY_WHO_MADE_OPTIONS } from "@/lib/etsy-listing-options";

type Field = {
  key: string;
  label: string;
  type: "select" | "boolean" | "zip" | "category" | "text";
  value: string | boolean | number | null;
  helpText?: string;
  options?: { value: string; label: string }[];
};

type Item = {
  id: string;
  kind: "listing" | "shop";
  storeItemId: string | null;
  title: string;
  photo: string | null;
  provider: string;
  summary: string;
  fields: Field[];
  action: "fill" | "ebay_condition" | "retry_only";
};

const PROVIDER_NAMES: Record<string, string> = {
  etsy: "Etsy",
  ebay: "eBay",
  shopify: "Shopify",
  wix: "Wix",
};

function FieldInputs({
  item,
  values,
  setValues,
}: {
  item: Item;
  values: Record<string, string | boolean | number | null>;
  setValues: React.Dispatch<React.SetStateAction<Record<string, string | boolean | number | null>>>;
}) {
  const [catQuery, setCatQuery] = useState("");
  const [catResults, setCatResults] = useState<{ taxonomyId: number; categoryName: string; categoryPath?: string }[]>(
    []
  );
  const [catLabel, setCatLabel] = useState("");

  useEffect(() => {
    const q = catQuery.trim();
    if (q.length < 2) {
      setCatResults([]);
      return;
    }
    const t = setTimeout(() => {
      void fetch(`/api/channels/etsy/categories?q=${encodeURIComponent(q)}`, { credentials: "include" })
        .then((r) => r.json())
        .then((d) => setCatResults(Array.isArray(d.categories) ? d.categories : []))
        .catch(() => setCatResults([]));
    }, 280);
    return () => clearTimeout(t);
  }, [catQuery]);

  return (
    <>
      {item.fields.map((field) => {
        if (field.type === "select") {
          const options = field.options?.length
            ? field.options
            : field.key === "etsyWhoMade"
              ? [...ETSY_WHO_MADE_OPTIONS]
              : field.key === "etsyWhenMade"
                ? [...ETSY_WHEN_MADE_OPTIONS]
                : [];
          return (
            <label key={field.key} className="block mb-3">
              <span className="text-sm font-medium text-gray-700 block mb-1">{field.label}</span>
              <select
                className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm"
                value={String(values[field.key] ?? "")}
                onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
              >
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {field.helpText ? <span className="text-xs text-gray-500 mt-1 block">{field.helpText}</span> : null}
            </label>
          );
        }
        if (field.type === "boolean") {
          return (
            <label key={field.key} className="flex items-start gap-2 mb-3">
              <input
                type="checkbox"
                className="mt-1"
                checked={values[field.key] === true}
                onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.checked }))}
              />
              <span>
                <span className="text-sm font-medium text-gray-700">{field.label}</span>
                {field.helpText ? <span className="block text-xs text-gray-500">{field.helpText}</span> : null}
              </span>
            </label>
          );
        }
        if (field.type === "text") {
          return (
            <label key={field.key} className="block mb-3">
              <span className="text-sm font-medium text-gray-700 block mb-1">{field.label}</span>
              <input
                className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm"
                value={String(values[field.key] ?? "")}
                onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
              />
              {field.helpText ? <span className="text-xs text-gray-500 mt-1 block">{field.helpText}</span> : null}
            </label>
          );
        }
        if (field.type === "zip") {
          return (
            <label key={field.key} className="block mb-3">
              <span className="text-sm font-medium text-gray-700 block mb-1">{field.label}</span>
              <input
                className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm"
                value={String(values[field.key] ?? "")}
                onChange={(e) =>
                  setValues((prev) => ({
                    ...prev,
                    [field.key]: e.target.value.replace(/\D/g, "").slice(0, 5),
                  }))
                }
                placeholder="99201"
                inputMode="numeric"
              />
              {field.helpText ? <span className="text-xs text-gray-500 mt-1 block">{field.helpText}</span> : null}
            </label>
          );
        }
        if (field.type === "category") {
          return (
            <div key={field.key} className="mb-3">
              <span className="text-sm font-medium text-gray-700 block mb-1">{field.label}</span>
              {typeof values.etsyTaxonomyId === "number" && catLabel ? (
                <p className="text-sm text-[var(--color-primary)] mb-1">{catLabel}</p>
              ) : null}
              <input
                className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm"
                value={catQuery}
                onChange={(e) => setCatQuery(e.target.value)}
                placeholder="Search Etsy categories"
              />
              {catResults.map((c) => (
                <button
                  key={c.taxonomyId}
                  type="button"
                  className="block w-full text-left text-sm py-2 border-b border-gray-100"
                  onClick={() => {
                    setValues((prev) => ({ ...prev, etsyTaxonomyId: c.taxonomyId }));
                    setCatLabel(c.categoryPath || c.categoryName);
                    setCatQuery("");
                    setCatResults([]);
                  }}
                >
                  {c.categoryPath || c.categoryName}
                </button>
              ))}
            </div>
          );
        }
        return null;
      })}
    </>
  );
}

function AttentionCard({
  item,
  onSaved,
}: {
  item: Item;
  onSaved: (items: Item[]) => void;
}) {
  const [values, setValues] = useState<Record<string, string | boolean | number | null>>(() => {
    const next: Record<string, string | boolean | number | null> = {};
    for (const f of item.fields) next[f.key] = f.value;
    return next;
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (retryOnly: boolean) => {
    setBusy(true);
    setMessage(null);
    try {
      const fields: Record<string, unknown> = {};
      if (!retryOnly) {
        if (typeof values.etsyWhoMade === "string") fields.etsyWhoMade = values.etsyWhoMade;
        if (typeof values.etsyWhenMade === "string") fields.etsyWhenMade = values.etsyWhenMade;
        if (typeof values.etsyIsSupply === "boolean") fields.etsyIsSupply = values.etsyIsSupply;
        if (typeof values.etsyTaxonomyId === "number") fields.etsyTaxonomyId = values.etsyTaxonomyId;
        if (typeof values.etsyOriginPostalCode === "string") {
          fields.etsyOriginPostalCode = values.etsyOriginPostalCode;
        }
        const aspects: Record<string, string> = {};
        for (const [key, value] of Object.entries(values)) {
          if (key.startsWith("aspect:") && typeof value === "string" && value.trim()) {
            aspects[key.slice("aspect:".length)] = value.trim();
          }
        }
        if (Object.keys(aspects).length > 0) fields.aspects = aspects;
      }
      const res = await fetch("/api/seller/needs-attention", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, kind: item.kind, fields, retry: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage((data as { error?: string }).error ?? "Could not save.");
        return;
      }
      onSaved((data as { items: Item[] }).items ?? []);
      const err =
        (data as { retryResult?: { error?: string } }).retryResult?.error ??
        (data as { retryResults?: { error?: string }[] }).retryResults?.find((r) => r.error)?.error;
      if (err) setMessage(err);
    } catch {
      setMessage("Could not save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border-2 border-amber-200 bg-amber-50/40 p-4 mb-4">
      <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-primary)]">
        {PROVIDER_NAMES[item.provider] ?? item.provider}
      </p>
      <h3 className="font-semibold text-gray-900 mt-1">{item.title}</h3>
      <p className="text-sm text-gray-700 mt-2">{item.summary}</p>
      <div className="mt-3">
        {item.action !== "retry_only" && item.action !== "ebay_condition" ? (
          <FieldInputs item={item} values={values} setValues={setValues} />
        ) : null}
      </div>
      {message ? <p className="text-sm text-amber-900 mb-2">{message}</p> : null}
      <div className="flex flex-col gap-2">
        {item.action === "ebay_condition" && item.storeItemId ? (
          <Link
            href={`/seller-hub/store/${item.storeItemId}?fixEbayCondition=1`}
            className="inline-flex items-center justify-center rounded-lg py-2.5 text-sm font-semibold text-white"
            style={{ backgroundColor: "var(--color-primary)" }}
          >
            Open listing and choose New or Used
          </Link>
        ) : item.action === "retry_only" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit(true)}
            className="rounded-lg py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: "var(--color-primary)" }}
          >
            {busy ? "Retrying…" : "Retry sync"}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit(false)}
            className="rounded-lg py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: "var(--color-primary)" }}
          >
            {busy ? "Saving…" : "Save and retry"}
          </button>
        )}
        {item.storeItemId ? (
          <Link href={`/seller-hub/store/${item.storeItemId}`} className="text-sm text-center font-medium text-[var(--color-primary)]">
            Open listing
          </Link>
        ) : null}
      </div>
    </div>
  );
}

export function NeedsAttentionPanel({
  onCountChange,
}: {
  onCountChange?: (count: number) => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/seller/needs-attention", { credentials: "include" });
      const data = await res.json();
      const next = Array.isArray(data.items) ? data.items : [];
      setItems(next);
      onCountChange?.(next.length);
    } catch {
      setItems([]);
      onCountChange?.(0);
    } finally {
      setLoading(false);
    }
  }, [onCountChange]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <p className="text-gray-500 text-center py-8">Loading listings that need attention…</p>;
  }
  if (items.length === 0) {
    return (
      <p className="text-gray-600 text-sm py-6">
        Nothing needs attention. When Etsy or eBay asks for origin, category, item specifics, or ship-from ZIP, those
        listings show up here so you can fill them in without opening every item.
      </p>
    );
  }

  return (
    <div>
      <p className="text-sm text-gray-600 mb-4">
        Fill in what the marketplace still needs, then save. INW retries that store only — it will not
        rewrite your other connected shops.
      </p>
      {items.map((item) => (
        <AttentionCard
          key={item.id}
          item={item}
          onSaved={(next) => {
            setItems(next);
            onCountChange?.(next.length);
          }}
        />
      ))}
    </div>
  );
}
