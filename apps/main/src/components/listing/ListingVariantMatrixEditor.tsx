"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  INVENTORY_TRACKING_MADE_TO_ORDER,
  INVENTORY_TRACKING_TRACKED,
  MAX_VARIANT_AXES,
  inferMatrixVaryFlags,
  listingGalleryPhotoChoices,
  combinationEnabledAfterAxisEdit,
  normalizeVariantMatrix,
  optionsEqual,
  rebuildMatrixFromAxes,
  resolveImageAxisName,
  sanitizePriceDraftInput,
  sanitizeQtyDraftInput,
  skuSelectionKey,
  variantPriceCentsToEditable,
  variantPriceDraftToCents,
  formatVariantPriceCents,
  variantQtyDraftToNumber,
  variantQtyToEditable,
  type InventoryTracking,
  type VariantAxisDef,
  type VariantSkuRow,
} from "@/lib/listing-variant-matrix";
import { listingInputClass, listingLabelClass } from "@/components/store-item/listing-form-styles";

const PRESETS = ["Size", "Color", "Material"];

export type EditorSkuRow = VariantSkuRow & { enabled: boolean };

export type FoundationVariantHydrate = {
  id?: string;
  options?: unknown;
  priceCents?: number | null;
  sku?: string | null;
  onHand?: number | null;
  quantity?: number | null;
  mode?: string | null;
};

function parseOptionsRecord(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const name = String(k ?? "").trim();
    const val = v != null ? String(v).trim() : "";
    if (name && val) out[name] = val;
  }
  return out;
}

/** Rebuild matrix from ACTIVE foundation variants when StoreItem.variants is missing/stale. */
export function matrixFromFoundationVariants(
  rows: FoundationVariantHydrate[] | null | undefined
): ReturnType<typeof normalizeVariantMatrix> {
  if (!rows?.length) return null;
  const live = rows
    .map((row) => {
      const options = parseOptionsRecord(row.options);
      const qty =
        typeof row.onHand === "number" && Number.isFinite(row.onHand)
          ? Math.max(0, Math.round(row.onHand))
          : typeof row.quantity === "number" && Number.isFinite(row.quantity)
            ? Math.max(0, Math.round(row.quantity))
            : 0;
      return {
        storeVariantId: typeof row.id === "string" ? row.id : undefined,
        options,
        quantity: qty,
        priceCents:
          typeof row.priceCents === "number" && Number.isFinite(row.priceCents)
            ? Math.max(0, Math.round(row.priceCents))
            : 0,
        sku: typeof row.sku === "string" && row.sku.trim() ? row.sku.trim() : undefined,
      };
    })
    .filter((row) => Object.keys(row.options).length > 0);
  if (live.length < 2) return null;

  const axisNames = new Set<string>();
  for (const row of live) {
    for (const name of Object.keys(row.options)) axisNames.add(name);
  }
  const axes: VariantAxisDef[] = [...axisNames]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({
      name,
      values: [...new Set(live.map((row) => row.options[name]).filter(Boolean))] as string[],
    }));
  if (axes.length === 0) return null;

  return normalizeVariantMatrix({
    axes,
    skus: live.map((row) => ({
      options: row.options,
      quantity: row.quantity,
      priceCents: row.priceCents,
      ...(row.storeVariantId ? { storeVariantId: row.storeVariantId } : {}),
      ...(row.sku ? { sku: row.sku } : {}),
    })),
  });
}

export function initEditorFromVariants(
  raw: unknown,
  foundationVariants?: FoundationVariantHydrate[] | null
): {
  optionsEnabled: boolean;
  axes: VariantAxisDef[];
  skus: EditorSkuRow[];
} {
  // Prefer foundation ACTIVE optioned rows when present — they are inventory truth
  // (Etsy may use "Primary color" while StoreItem.variants still says "Color").
  const matrix =
    matrixFromFoundationVariants(foundationVariants) ?? normalizeVariantMatrix(raw);
  if (!matrix || matrix.axes.length === 0) {
    return { optionsEnabled: false, axes: [], skus: [] };
  }
  const full = rebuildMatrixFromAxes(matrix.axes, matrix.skus, {
    pricesVary: matrix.pricesVary,
    quantitiesVary: matrix.quantitiesVary,
    skusVary: matrix.skusVary,
    imageAxis: matrix.imageAxis,
  });
  const enabledKeys = new Set(matrix.skus.map((s) => skuSelectionKey(s.options)));
  return {
    optionsEnabled: true,
    axes: full.axes,
    skus: full.skus.map((s) => ({
      ...s,
      enabled: enabledKeys.has(skuSelectionKey(s.options)),
    })),
  };
}

export function serializeEditorMatrix(
  optionsEnabled: boolean,
  axes: VariantAxisDef[],
  skus: EditorSkuRow[]
): VariantSkuRow[] | null {
  if (!optionsEnabled) return null;
  const enabled = skus.filter((s) => s.enabled);
  const clean = rebuildMatrixFromAxes(axes, enabled, {
    imageAxis: resolveImageAxisName({ axes, skus: enabled }),
  });
  if (clean.axes.length === 0 || enabled.length === 0) return null;
  return clean.skus.filter((s) => enabled.some((e) => optionsEqual(e.options, s.options)));
}

type Props = {
  inventoryTracking: InventoryTracking;
  onInventoryTrackingChange: (value: InventoryTracking) => void;
  optionsEnabled: boolean;
  onOptionsEnabledChange: (enabled: boolean) => void;
  simpleQuantity: number;
  onSimpleQuantityChange: (qty: number) => void;
  axes: VariantAxisDef[];
  skus: EditorSkuRow[];
  onChange: (axes: VariantAxisDef[], skus: EditorSkuRow[]) => void;
  galleryPhotos: string[];
  channelNotes?: string[];
  /** Notify parent when per-combination prices are enabled (hides listing-level price). */
  onPricesVaryChange?: (pricesVary: boolean) => void;
};

function ChannelNotes({ notes }: { notes?: string[] }) {
  if (!notes?.length) return null;
  return (
    <ul className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 space-y-1">
      {notes.map((note) => (
        <li key={note}>{note}</li>
      ))}
    </ul>
  );
}

type VariantGridCol = "qty" | "price" | "sku";

function focusVariantGridCell(table: HTMLElement, row: number, col: VariantGridCol) {
  const next = table.querySelector<HTMLInputElement>(
    `input[data-variant-col="${col}"][data-variant-row="${row}"]`
  );
  if (!next) return false;
  next.focus();
  requestAnimationFrame(() => next.select());
  return true;
}

function handleVariantGridKeyDown(
  e: KeyboardEvent<HTMLInputElement>,
  rowIndex: number,
  col: VariantGridCol
) {
  const key = e.key;
  if (key !== "ArrowUp" && key !== "ArrowDown" && key !== "ArrowLeft" && key !== "ArrowRight" && key !== "Enter") {
    return;
  }

  const input = e.currentTarget;
  const start = input.selectionStart ?? 0;
  const end = input.selectionEnd ?? 0;
  if (key === "ArrowLeft" || key === "ArrowRight") {
    if (start !== end) return;
    if (key === "ArrowLeft" && start > 0) return;
    if (key === "ArrowRight" && start < input.value.length) return;
  }

  const table = input.closest("table");
  if (!table) return;

  const cols: VariantGridCol[] = [];
  if (table.querySelector('input[data-variant-col="qty"]')) cols.push("qty");
  if (table.querySelector('input[data-variant-col="price"]')) cols.push("price");
  if (table.querySelector('input[data-variant-col="sku"]')) cols.push("sku");
  if (cols.length === 0) return;

  let nextRow = rowIndex;
  let nextColIdx = cols.indexOf(col);
  if (nextColIdx < 0) return;

  if (key === "ArrowUp" || (key === "Enter" && e.shiftKey)) {
    nextRow = rowIndex - 1;
  } else if (key === "ArrowDown" || key === "Enter") {
    nextRow = rowIndex + 1;
  } else if (key === "ArrowLeft") {
    nextColIdx -= 1;
    if (nextColIdx < 0) {
      nextColIdx = cols.length - 1;
      nextRow = rowIndex - 1;
    }
  } else if (key === "ArrowRight") {
    nextColIdx += 1;
    if (nextColIdx >= cols.length) {
      nextColIdx = 0;
      nextRow = rowIndex + 1;
    }
  }

  if (nextRow < 0) return;
  const nextCol = cols[nextColIdx];
  if (!nextCol) return;
  if (key === "Enter") e.preventDefault();
  const moved = focusVariantGridCell(table, nextRow, nextCol);
  if (moved) e.preventDefault();
}

function VariantPriceInput({
  cents,
  onCommitCents,
  className,
  placeholder,
  rowIndex,
}: {
  cents: number | undefined;
  onCommitCents: (cents: number | undefined) => void;
  className: string;
  placeholder?: string;
  rowIndex?: number;
}) {
  const [draft, setDraft] = useState(() => formatVariantPriceCents(cents));
  const focusedRef = useRef(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    if (focusedRef.current) return;
    setDraft(formatVariantPriceCents(cents));
  }, [cents]);

  const commit = (raw: string) => {
    const t = sanitizePriceDraftInput(raw) ?? draftRef.current;
    const next = t === "" ? undefined : variantPriceDraftToCents(t);
    onCommitCents(next);
    const idle = next != null ? formatVariantPriceCents(next) : "";
    draftRef.current = idle;
    setDraft(idle);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      className={className}
      placeholder={placeholder}
      value={draft}
      onFocus={() => {
        focusedRef.current = true;
        const next = variantPriceCentsToEditable(cents);
        draftRef.current = next;
        setDraft(next);
      }}
      onChange={(e) => {
        const t = sanitizePriceDraftInput(e.target.value);
        if (t == null) return;
        draftRef.current = t;
        setDraft(t);
        if (t === "") {
          onCommitCents(undefined);
          return;
        }
        const next = variantPriceDraftToCents(t);
        if (next != null) onCommitCents(next);
      }}
      onKeyDown={
        rowIndex != null
          ? (e) => handleVariantGridKeyDown(e, rowIndex, "price")
          : undefined
      }
      data-variant-col={rowIndex != null ? "price" : undefined}
      data-variant-row={rowIndex}
      onBlur={(e) => {
        const raw = e.currentTarget.value;
        focusedRef.current = false;
        requestAnimationFrame(() => {
          if (focusedRef.current) return;
          commit(raw);
        });
      }}
    />
  );
}

function VariantQtyInput({
  qty,
  onCommitQty,
  className,
  placeholder,
  rowIndex,
}: {
  qty: number;
  onCommitQty: (qty: number) => void;
  className: string;
  placeholder?: string;
  rowIndex?: number;
}) {
  const [draft, setDraft] = useState(() => variantQtyToEditable(qty));
  const focusedRef = useRef(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    if (focusedRef.current) return;
    setDraft(variantQtyToEditable(qty));
  }, [qty]);

  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      autoComplete="off"
      className={className}
      placeholder={placeholder}
      value={draft}
      onFocus={() => {
        focusedRef.current = true;
        const next = variantQtyToEditable(qty);
        draftRef.current = next;
        setDraft(next);
      }}
      onChange={(e) => {
        const t = sanitizeQtyDraftInput(e.target.value);
        draftRef.current = t;
        setDraft(t);
        onCommitQty(variantQtyDraftToNumber(t));
      }}
      onKeyDown={
        rowIndex != null
          ? (e) => handleVariantGridKeyDown(e, rowIndex, "qty")
          : undefined
      }
      data-variant-col={rowIndex != null ? "qty" : undefined}
      data-variant-row={rowIndex}
      onBlur={(e) => {
        const raw = e.currentTarget.value;
        focusedRef.current = false;
        requestAnimationFrame(() => {
          if (focusedRef.current) return;
          const t = sanitizeQtyDraftInput(raw);
          const n = variantQtyDraftToNumber(t);
          onCommitQty(n);
          const idle = variantQtyToEditable(n);
          draftRef.current = idle;
          setDraft(idle);
        });
      }}
    />
  );
}

export function ListingVariantMatrixEditor({
  inventoryTracking,
  onInventoryTrackingChange,
  optionsEnabled,
  onOptionsEnabledChange,
  simpleQuantity,
  onSimpleQuantityChange,
  axes,
  skus,
  onChange,
  galleryPhotos,
  channelNotes,
  onPricesVaryChange,
}: Props) {
  const madeToOrder = inventoryTracking === INVENTORY_TRACKING_MADE_TO_ORDER;
  const inferred = inferMatrixVaryFlags({ axes, skus });
  const [pricesVary, setPricesVary] = useState(inferred.pricesVary);
  const [quantitiesVary, setQuantitiesVary] = useState(true);
  const [skusVary, setSkusVary] = useState(inferred.skusVary);
  const [manageOpen, setManageOpen] = useState(false);
  const [draftAxes, setDraftAxes] = useState<VariantAxisDef[]>([]);
  const [draftNewValues, setDraftNewValues] = useState<Record<number, string>>({});
  const [bulkPrice, setBulkPrice] = useState("");
  const [bulkQty, setBulkQty] = useState("");

  useEffect(() => {
    if (skus.some((s) => s.priceCents != null && s.priceCents > 0)) setPricesVary(true);
    if (skus.some((s) => Boolean(s.sku?.trim()))) setSkusVary(true);
  }, [skus]);

  useEffect(() => {
    onPricesVaryChange?.(optionsEnabled && pricesVary);
  }, [optionsEnabled, pricesVary, onPricesVaryChange]);

  const photoChoices = useMemo(
    () => listingGalleryPhotoChoices(galleryPhotos),
    [galleryPhotos]
  );

  const comboLabel = (row: EditorSkuRow) =>
    axes.map((a) => row.options[a.name] ?? "").filter(Boolean).join(" / ");

  const applyAxes = (nextAxes: VariantAxisDef[], nextSkus = skus) => {
    const full = rebuildMatrixFromAxes(nextAxes, nextSkus, {
      pricesVary,
      quantitiesVary,
      skusVary,
      imageAxis: resolveImageAxisName({ axes: nextAxes, skus: nextSkus }),
    });
    const prevEnabled = new Map(
      nextSkus.map((s) => [skuSelectionKey(s.options), s.enabled])
    );
    onChange(
      full.axes,
      full.skus.map((s) => ({
        ...s,
        enabled: combinationEnabledAfterAxisEdit(skuSelectionKey(s.options), prevEnabled),
        ...(!pricesVary ? { priceCents: undefined } : {}),
        ...(!skusVary ? { sku: undefined } : {}),
      }))
    );
  };

  const patchSku = (key: string, patch: Partial<EditorSkuRow>) => {
    onChange(
      axes,
      skus.map((s) => (skuSelectionKey(s.options) === key ? { ...s, ...patch } : s))
    );
  };

  const openManage = () => {
    setDraftAxes(axes.length ? axes.map((a) => ({ ...a, values: [...a.values] })) : [{ name: "Size", values: [] }]);
    setDraftNewValues({});
    setManageOpen(true);
  };

  const closeManage = () => {
    setManageOpen(false);
    setDraftAxes([]);
    setDraftNewValues({});
  };

  const applyManage = () => {
    applyAxes(draftAxes);
    closeManage();
  };

  const toggleDraftPhoto = (axisIndex: number, value: string, url: string) => {
    setDraftAxes((prev) =>
      prev.map((a, i) => {
        if (i !== axisIndex) return { ...a, photosByValue: undefined };
        const current = a.photosByValue?.[value] ?? [];
        const next = current.includes(url) ? current.filter((u) => u !== url) : [...current, url];
        const photosByValue = { ...(a.photosByValue ?? {}), [value]: next };
        if (next.length === 0) delete photosByValue[value];
        return { ...a, photosByValue };
      })
    );
  };

  const togglePriceVary = (next: boolean) => {
    setPricesVary(next);
    if (!next) {
      onChange(
        axes,
        skus.map((s) => ({ ...s, priceCents: undefined }))
      );
    }
  };

  const toggleQtyVary = (next: boolean) => {
    setQuantitiesVary(next);
    if (!next) {
      const shared = skus.find((s) => s.enabled)?.quantity ?? 0;
      onChange(
        axes,
        skus.map((s) => ({ ...s, quantity: shared }))
      );
    }
  };

  const toggleSkuVary = (next: boolean) => {
    setSkusVary(next);
    if (!next) {
      onChange(
        axes,
        skus.map((s) => ({ ...s, sku: undefined }))
      );
    }
  };

  const applyBulk = () => {
    const priceN = parseFloat(bulkPrice);
    const qtyN = parseInt(bulkQty, 10);
    const priceCents = Number.isFinite(priceN) && priceN > 0 ? Math.round(priceN * 100) : undefined;
    const qty = Number.isFinite(qtyN) && qtyN >= 0 ? qtyN : undefined;
    onChange(
      axes,
      skus.map((s) =>
        s.enabled
          ? {
              ...s,
              ...(pricesVary && priceCents != null ? { priceCents } : {}),
              ...(quantitiesVary && !madeToOrder && qty != null ? { quantity: qty } : {}),
            }
          : s
      )
    );
  };

  const setAllVisible = (enabled: boolean) => {
    onChange(
      axes,
      skus.map((s) => ({ ...s, enabled }))
    );
  };

  const enabledCount = skus.filter((s) => s.enabled).length;
  const allVisible = skus.length > 0 && enabledCount === skus.length;
  const someVisible = enabledCount > 0 && !allVisible;
  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someVisible;
  }, [someVisible]);
  const summary =
    axes.length === 0
      ? "No options yet"
      : `${axes.map((a) => a.name || "Option").join(", ")} · ${enabledCount} combination${enabledCount === 1 ? "" : "s"}`;
  const photoAxisLive = resolveImageAxisName({ axes: draftAxes.length ? draftAxes : axes, skus });
  const firstPhotoAxisIndex = draftAxes.findIndex((a) => a.values.length > 0);

  return (
    <div className="space-y-4">
      <div>
        <p className={`${listingLabelClass} mb-2`}>Inventory mode</p>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input
              type="radio"
              checked={!madeToOrder}
              onChange={() => onInventoryTrackingChange(INVENTORY_TRACKING_TRACKED)}
            />
            Track Inventory
          </label>
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input
              type="radio"
              checked={madeToOrder}
              onChange={() => onInventoryTrackingChange(INVENTORY_TRACKING_MADE_TO_ORDER)}
            />
            Made to Order
          </label>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          {madeToOrder
            ? "Buyers can order without a stock count. Quantity is not decremented after sales."
            : "Each combination has its own quantity. Sales reduce that combination."}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onOptionsEnabledChange(!optionsEnabled)}
          className="w-[22px] h-[22px] rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors"
          style={
            optionsEnabled
              ? { backgroundColor: "var(--color-primary)", borderColor: "var(--color-primary)" }
              : { borderColor: "#ccc" }
          }
        >
          {optionsEnabled && <span className="text-white text-sm font-bold">✓</span>}
        </button>
        <span className="text-sm text-gray-900 font-medium">Enable options (Size, Color, …)</span>
      </div>

      {!optionsEnabled ? (
        madeToOrder ? (
          <p className="text-sm text-gray-500">Quantity is not required for made-to-order listings.</p>
        ) : (
          <>
            <label className={listingLabelClass}>Quantity *</label>
            <VariantQtyInput
              qty={simpleQuantity}
              onCommitQty={onSimpleQuantityChange}
              className={`${listingInputClass} max-w-xs`}
              placeholder="1"
            />
          </>
        )
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-gray-700">{summary}</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                accessKey="v"
                onClick={openManage}
                className="py-2 px-4 border border-gray-300 rounded-lg bg-white text-gray-800 font-semibold text-sm hover:bg-gray-50"
              >
                {axes.length ? "Manage Variations" : "Add Options"}
              </button>
            </div>
          </div>

          <ChannelNotes notes={channelNotes} />

          {skus.length > 0 ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-end gap-2">
                {pricesVary ? (
                  <label className="text-xs text-gray-600">
                    Price
                    <input
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={bulkPrice}
                      onChange={(e) => {
                        const t = sanitizePriceDraftInput(e.target.value);
                        if (t != null) setBulkPrice(t);
                      }}
                      className="mt-1 block w-28 border rounded px-2 py-1.5 text-sm"
                      placeholder="12.00"
                    />
                  </label>
                ) : null}
                {quantitiesVary && !madeToOrder ? (
                  <label className="text-xs text-gray-600">
                    Qty
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      autoComplete="off"
                      value={bulkQty}
                      onChange={(e) => setBulkQty(sanitizeQtyDraftInput(e.target.value))}
                      className="mt-1 block w-24 border rounded px-2 py-1.5 text-sm"
                      placeholder="1"
                    />
                  </label>
                ) : null}
                {(pricesVary || (quantitiesVary && !madeToOrder)) ? (
                  <button
                    type="button"
                    onClick={applyBulk}
                    className="text-sm font-semibold text-[var(--color-primary)]"
                  >
                    Apply to all enabled
                  </button>
                ) : null}
              </div>
              <div className="overflow-x-auto border border-gray-200 rounded-lg">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-left">
                    <tr>
                      <th className="px-2 py-2">Photo</th>
                      {axes.map((a) => (
                        <th key={a.name} className="px-2 py-2">
                          {a.name || "Option"}
                        </th>
                      ))}
                      {quantitiesVary && !madeToOrder ? <th className="px-2 py-2">Qty</th> : null}
                      {pricesVary ? <th className="px-2 py-2">Price</th> : null}
                      {skusVary ? <th className="px-2 py-2">SKU</th> : null}
                      <th className="px-2 py-2">
                        <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                          <input
                            ref={selectAllRef}
                            type="checkbox"
                            checked={allVisible}
                            onChange={(e) => setAllVisible(e.target.checked)}
                            aria-label="Select all variations"
                          />
                          <span>Visible</span>
                        </label>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {skus.map((row, rowIndex) => {
                      const key = skuSelectionKey(row.options);
                      const thumb = row.photos?.[0];
                      return (
                        <tr key={key} className={!row.enabled ? "opacity-50" : undefined}>
                          <td className="px-2 py-2">
                            {thumb ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={thumb} alt="" className="w-8 h-8 rounded object-cover" />
                            ) : (
                              <span className="inline-block w-8 h-8 rounded bg-gray-100" />
                            )}
                          </td>
                          {axes.map((a) => (
                            <td key={a.name} className="px-2 py-2 whitespace-nowrap">
                              {row.options[a.name]}
                            </td>
                          ))}
                          {quantitiesVary && !madeToOrder ? (
                            <td className="px-2 py-2">
                              <VariantQtyInput
                                qty={row.quantity}
                                onCommitQty={(n) => patchSku(key, { quantity: n })}
                                className="w-24 border rounded px-2 py-1.5 text-sm"
                                placeholder="0"
                                rowIndex={rowIndex}
                              />
                            </td>
                          ) : null}
                          {pricesVary ? (
                            <td className="px-2 py-2">
                              <VariantPriceInput
                                cents={row.priceCents}
                                onCommitCents={(cents) => patchSku(key, { priceCents: cents })}
                                className="w-28 border rounded px-2 py-1.5 text-sm"
                                placeholder="Default"
                                rowIndex={rowIndex}
                              />
                            </td>
                          ) : null}
                          {skusVary ? (
                            <td className="px-2 py-2">
                              <input
                                type="text"
                                className="w-32 border rounded px-2 py-1.5 font-mono text-sm"
                                value={row.sku ?? ""}
                                onChange={(e) => patchSku(key, { sku: e.target.value || undefined })}
                                onKeyDown={(e) => handleVariantGridKeyDown(e, rowIndex, "sku")}
                                data-variant-col="sku"
                                data-variant-row={rowIndex}
                              />
                            </td>
                          ) : null}
                          <td className="px-2 py-2">
                            <input
                              type="checkbox"
                              checked={row.enabled}
                              onChange={(e) => patchSku(key, { enabled: e.target.checked })}
                              aria-label={`Visible ${comboLabel(row)}`}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              Add option types and values, then Apply to generate combinations.
            </p>
          )}
        </>
      )}

      {manageOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">Manage Variations</h3>
                <p className="text-sm text-gray-500">
                  Add up to {MAX_VARIANT_AXES} option types. Apply generates every combination.
                </p>
              </div>
              <button type="button" className="text-gray-500" onClick={closeManage}>
                ✕
              </button>
            </div>
            <ChannelNotes notes={channelNotes} />
            {draftAxes.map((axis, ai) => (
              <div key={ai} className="rounded-lg p-3 bg-gray-50 border border-gray-100">
                <div className="flex gap-2 mb-2">
                  <select
                    value={PRESETS.includes(axis.name) ? axis.name : "__custom"}
                    onChange={(e) => {
                      setDraftAxes((prev) =>
                        prev.map((a, i) =>
                          i === ai
                            ? { ...a, name: e.target.value === "__custom" ? axis.name : e.target.value }
                            : a
                        )
                      );
                    }}
                    className="border border-gray-300 rounded px-2 py-1.5 text-sm"
                  >
                    {PRESETS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                    <option value="__custom">Custom</option>
                  </select>
                  {!PRESETS.includes(axis.name) || axis.name === "" ? (
                    <input
                      type="text"
                      value={axis.name}
                      onChange={(e) => {
                        setDraftAxes((prev) =>
                          prev.map((a, i) => (i === ai ? { ...a, name: e.target.value } : a))
                        );
                      }}
                      placeholder="Option name"
                      className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-sm"
                    />
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setDraftAxes((prev) => prev.filter((_, i) => i !== ai))}
                    className="text-red-600 text-sm hover:underline shrink-0"
                  >
                    Remove
                  </button>
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                  {axis.values.map((value, vi) => (
                    <span
                      key={`${value}-${vi}`}
                      className="inline-flex items-center gap-1 bg-white border border-gray-300 rounded px-2 py-1 text-sm"
                    >
                      {value}
                      <button
                        type="button"
                        onClick={() =>
                          setDraftAxes((prev) =>
                            prev.map((a, i) =>
                              i === ai ? { ...a, values: a.values.filter((_, j) => j !== vi) } : a
                            )
                          )
                        }
                        className="text-red-500 hover:text-red-700 font-bold leading-none"
                        aria-label="Remove value"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <input
                    type="text"
                    value={draftNewValues[ai] ?? ""}
                    onChange={(e) => setDraftNewValues((p) => ({ ...p, [ai]: e.target.value }))}
                    placeholder="+ Add value"
                    className="w-28 border rounded px-2 py-1 text-sm"
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      const val = (draftNewValues[ai] ?? "").trim();
                      if (!val) return;
                      setDraftAxes((prev) =>
                        prev.map((a, i) =>
                          i === ai && !a.values.some((v) => v.toLowerCase() === val.toLowerCase())
                            ? { ...a, values: [...a.values, val] }
                            : a
                        )
                      );
                      setDraftNewValues((p) => ({ ...p, [ai]: "" }));
                    }}
                  />
                  <button
                    type="button"
                    className="text-sm font-semibold text-[var(--color-primary)]"
                    onClick={() => {
                      const val = (draftNewValues[ai] ?? "").trim();
                      if (!val) return;
                      setDraftAxes((prev) =>
                        prev.map((a, i) =>
                          i === ai && !a.values.some((v) => v.toLowerCase() === val.toLowerCase())
                            ? { ...a, values: [...a.values, val] }
                            : a
                        )
                      );
                      setDraftNewValues((p) => ({ ...p, [ai]: "" }));
                    }}
                  >
                    Add
                  </button>
                </div>
                {axis.values.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    <p className="text-sm font-semibold text-gray-800">
                      Link photos to {axis.name || "this option"}
                    </p>
                    {photoChoices.length === 0 ? (
                      <p className="text-xs text-gray-500">
                        Add listing photos in the gallery first, then tap them here.
                      </p>
                    ) : (
                      axis.values.map((value) => (
                        <div key={value}>
                          <p className="text-xs font-medium mb-1">{value}</p>
                          <div className="flex flex-wrap gap-2">
                            {photoChoices.map((url) => {
                              const selected = (axis.photosByValue?.[value] ?? []).includes(url);
                              return (
                                <button
                                  key={url}
                                  type="button"
                                  accessKey={
                                    ai === firstPhotoAxisIndex &&
                                    value === axis.values[0] &&
                                    url === photoChoices[0]
                                      ? "p"
                                      : undefined
                                  }
                                  onClick={() => toggleDraftPhoto(ai, value, url)}
                                  className={`w-12 h-12 rounded overflow-hidden border-2 ${
                                    selected ? "border-[var(--color-primary)]" : "border-transparent"
                                  }`}
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={url} alt="" className="w-full h-full object-cover" />
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                ) : null}
              </div>
            ))}
            {draftAxes.length < MAX_VARIANT_AXES ? (
              <button
                type="button"
                onClick={() =>
                  setDraftAxes((prev) => [
                    ...prev,
                    { name: PRESETS[prev.length] ?? "Option", values: [] },
                  ])
                }
                className="py-2 px-4 border border-gray-300 rounded-lg bg-white text-gray-800 font-semibold text-sm hover:bg-gray-50"
              >
                + Add option type
              </button>
            ) : null}

            <div className="space-y-2 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={pricesVary}
                  onChange={(e) => togglePriceVary(e.target.checked)}
                />
                Prices vary
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={quantitiesVary}
                  onChange={(e) => toggleQtyVary(e.target.checked)}
                />
                Quantities vary
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={skusVary}
                  onChange={(e) => toggleSkuVary(e.target.checked)}
                />
                SKUs vary
              </label>
            </div>
            {photoAxisLive ? (
              <p className="text-xs text-gray-500">Photos are linked to {photoAxisLive}.</p>
            ) : null}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                className="px-4 py-2 text-sm"
                onClick={closeManage}
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-4 py-2 text-sm font-semibold rounded-lg text-white bg-[var(--color-primary)]"
                onClick={applyManage}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
